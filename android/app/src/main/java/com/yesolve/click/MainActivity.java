package com.yesolve.click;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

import java.io.File;

/**
 * App 畫面（桌機/手機 launcher 圖示開啟時唯一的可見介面）。
 *
 * ★ 行為變更：不再於開啟時強制跳「無障礙設定」或自行退到背景。
 *   開啟 App 即可直接操作腳本編輯、匯入匯出、批次管理；懸浮 HUD 模式
 *   由前端選單的「懸浮模式」按鈕（enterOverlayMode）主動切換。
 *
 * HostBridge 透過 addJavascriptInterface("Android") 與服務層的 overlay WebView
 * 使用相同名稱，讓同一份前端在兩個 WebView 都能運作，並用 getContext()
 * 辨識目前所在語境。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "OmniClickMainActivity";

    /** App 畫面是否在前台（服務層會在前台時隱藏懸浮 HUD，避免兩份 HUD 疊在畫面上） */
    private static volatile boolean hostResumed = false;

    public static boolean isHostResumed() {
        return hostResumed;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StartupAdPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Capacitor 於 load() 內建立 WebView 並 loadUrl；覆寫以便註冊 host 橋接後重載一次，確保注入生效 */
    @Override
    protected void load() {
        super.load();
        try {
            if (bridge != null && bridge.getWebView() != null) {
                // 與服務層 overlay 相同的 "Android" 介面名稱；host 只提供
                // 服務狀態／懸浮切換／原生另存／退出功能，不提供手勢分派
                // （手勢一律由無障礙服務的懸浮 HUD 執行）。
                bridge.getWebView().addJavascriptInterface(new HostBridge(), "Android");
                // 註冊後重新載入一次，確保 window.Android 在頁面載入前就緒
                bridge.getWebView().post(bridge.getWebView()::reload);
            }
        } catch (Exception e) {
            Log.e(TAG, "addJavascriptInterface failed", e);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        hostResumed = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        hostResumed = false;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // App 畫面聚焦 → 隱藏服務層懸浮 HUD；切到其他 App（含「進入懸浮模式」）→ 自動恢復，
        // 讓畫面上任何時刻都只出現一份 HUD。
        OmniClickAccessibilityService service = OmniClickAccessibilityService.getInstance();
        if (service != null) {
            service.setOverlaysHiddenForHost(hasFocus);
        }
    }

    private class HostBridge {

        @JavascriptInterface
        public String getContext() {
            return "host";
        }

        @JavascriptInterface
        public boolean isAccessibilityEnabled() {
            return isAccessibilityServiceEnabled();
        }

        /** 開啟系統無障礙設定（讓使用者手動開啟服務，不做強制導覽） */
        @JavascriptInterface
        public void openAccessibilitySettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                startActivity(intent);
            } catch (Exception e) {
                Log.e(TAG, "openAccessibilitySettings failed", e);
            }
        }

        /**
         * 切換到懸浮模式：App 畫面退到背景，讓服務層的懸浮 HUD 顯示在該開的 App 上。
         * 回傳 false 代表服務未啟用，前端會先帶使用者去開啟無障礙設定。
         */
        @JavascriptInterface
        public boolean enterOverlayMode() {
            if (!isAccessibilityServiceEnabled()) {
                Log.d(TAG, "enterOverlayMode: service not enabled");
                return false;
            }
            OmniClickAccessibilityService service = OmniClickAccessibilityService.getInstance();
            if (service != null) {
                // 切換前讓 overlay WebView 重載，同步取回共用的本地腳本清單
                service.prepareHandoffToOverlay();
            }
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    moveTaskToBack(true);
                } catch (Exception e) {
                    Log.e(TAG, "moveTaskToBack failed", e);
                }
            });
            return true;
        }

        /** 原生另存新檔（ACTION_CREATE_DOCUMENT），比瀏覽器下載在 Capacitor WebView 中可靠。
         * 內容先寫入快取暫存檔再由 FileSaveActivity 讀取，避免大型腳本包超出 Intent 限制。 */
        @JavascriptInterface
        public void saveFile(String fileName, String content) {
            try {
                String tempPath = writeTempFile(fileName, content);
                Intent intent = new Intent(MainActivity.this, FileSaveActivity.class);
                if (fileName != null) intent.putExtra("fileName", fileName);
                if (tempPath == null && content != null) {
                    intent.putExtra("content", content); // 暫存檔寫入失敗才退回舊流程
                } else if (tempPath != null) {
                    intent.putExtra("tempPath", tempPath);
                }
                startActivity(intent);
            } catch (Exception e) {
                Log.e(TAG, "saveFile failed", e);
            }
        }

        private String writeTempFile(String fileName, String content) {
            if (content == null) return null;
            try {
                File cacheDir = new File(getCacheDir(), "saves");
                if (!cacheDir.exists()) cacheDir.mkdirs();
                File temp = File.createTempFile("omniclick_save_", ".json", cacheDir);
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(temp)) {
                    out.write(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    out.flush();
                }
                return temp.getAbsolutePath();
            } catch (Exception e) {
                Log.e(TAG, "writeTempFile failed", e);
                return null;
            }
        }

        /** 結束 App 畫面 */
        @JavascriptInterface
        public void exitApp() {
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    finishAndRemoveTask();
                } catch (Exception e) {
                    Log.e(TAG, "exitApp failed", e);
                }
            });
        }
    }

    private boolean isAccessibilityServiceEnabled() {
        try {
            int enabled = Settings.Secure.getInt(
                    getContentResolver(),
                    Settings.Secure.ACCESSIBILITY_ENABLED
            );
            if (enabled != 1) {
                return false;
            }

            String enabledServices = Settings.Secure.getString(
                    getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            if (enabledServices == null) {
                return false;
            }

            String target = new ComponentName(this, OmniClickAccessibilityService.class)
                    .flattenToString();
            for (String s : enabledServices.split(":")) {
                if (s.equalsIgnoreCase(target)) {
                    return true;
                }
            }
        } catch (Settings.SettingNotFoundException e) {
            Log.e(TAG, "Settings not found", e);
        } catch (Exception e) {
            Log.e(TAG, "isAccessibilityServiceEnabled error", e);
        }
        return false;
    }
}
