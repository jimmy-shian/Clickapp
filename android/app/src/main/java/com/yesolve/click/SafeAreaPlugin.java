package com.yesolve.click;

import android.app.Activity;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系統列安全區（safe area）inset 量測。
 *
 * 問題背景：Android targetSdk 35 預設 edge-to-edge，Capacitor WebView 會延伸到
 * 狀態列／導覽列（手勢列）底下，而 Chromium 的 env(safe-area-inset-*) 只回報瀏海海缺口，
 * 不含系統列高度 → 純 CSS 無法避開上下導覽列。
 *
 * 本 plugin 以 WindowInsets 實測「WebView 實際被系統列蓋住多少」，
 * 回傳 CSS px（= dp）給前端，讓開場廣告等全螢幕畫面能把內容排進安全區內。
 *
 * 判定方式：
 * - edge-to-edge：WebView 貼齊視窗上下緣 → 重疊量 = 系統列高度（需要避開）。
 * - 非 edge-to-edge：系統已把內容排到狀態列下方／導覽列上方 → 重疊量 = 0（不重複留白）。
 */
@CapacitorPlugin(name = "SafeArea")
public class SafeAreaPlugin extends Plugin {

    /** 回傳 { top, bottom, left, right }，單位為 CSS px（= dp） */
    @PluginMethod
    public void getInsets(PluginCall call) {
        Activity activity = getActivity();
        float density = 1f;
        int top = 0;
        int bottom = 0;
        int left = 0;
        int right = 0;

        if (activity != null) {
            density = activity.getResources().getDisplayMetrics().density;
            View webView = getBridge() != null ? getBridge().getWebView() : null;
            View decor = activity.getWindow() != null ? activity.getWindow().getDecorView() : null;

            if (webView != null && decor != null) {
                WindowInsetsCompat rootInsets = ViewCompat.getRootWindowInsets(webView);
                if (rootInsets != null) {
                    // 系統列 + 瀏海海缺口（取聯集，不重疊加總）
                    Insets bars = rootInsets.getInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                    );

                    int[] location = new int[2];
                    webView.getLocationInWindow(location);
                    int viewRight = location[0] + webView.getWidth();
                    int viewBottom = location[1] + webView.getHeight();
                    int windowWidth = decor.getWidth();
                    int windowHeight = decor.getHeight();

                    // 只取「WebView 真的被系統列蓋住」的重疊範圍
                    top = Math.max(0, bars.top - location[1]);
                    bottom = Math.max(0, viewBottom - (windowHeight - bars.bottom));
                    left = Math.max(0, bars.left - location[0]);
                    right = Math.max(0, viewRight - (windowWidth - bars.right));
                }
            }
        }

        JSObject result = new JSObject();
        result.put("top", top / density);
        result.put("bottom", bottom / density);
        result.put("left", left / density);
        result.put("right", right / density);
        call.resolve(result);
    }
}
