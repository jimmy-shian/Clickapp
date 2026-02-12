package com.jimmyshian.click;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.content.Intent;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;

public class OmniClickAccessibilityService extends AccessibilityService {

    private static final String TAG = "OmniClickAccessibilityService";
    private static OmniClickAccessibilityService instance;
    private WindowManager windowManager;
    private WebView webView;
    private WindowManager.LayoutParams webViewLayoutParams;
    private WebViewAssetLoader assetLoader;
    private TouchOverlayView touchView;
    private WindowManager.LayoutParams touchLayoutParams;

    // 錄製模式旗標（由 JS bridge 控制），只在錄製時才需要穿透 tap
    private volatile boolean isRecordingMode = false;

    // 錄製時排除 HUD 區域的原生 tap（避免點 HUD 也點到底層 App）
    // 座標為螢幕 px
    private float hudRectPxX = -1f;
    private float hudRectPxY = -1f;
    private float hudRectPxW = 0f;
    private float hudRectPxH = 0f;

    // clearInputFocus debounce 用的 Handler 與 Runnable
    private final Handler clearFocusHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingClearFocusRunnable = null;

    // HUD / overlay 矩形（以 JS 回報的 canvas 座標系，單位為 CSS px）
    private float overlayX = 0f;
    private float overlayY = 0f;
    private float overlayWidth = 0f;
    private float overlayHeight = 0f;

    // 顯示密度與系統狀態列高度（px）
    private float density = 1f;
    private int statusBarHeightPx = 0;

    // 實際螢幕像素尺寸
    private int screenWidthPx = 0;
    private int screenHeightPx = 0;

    // 錄製使用的「全螢幕 canvas」尺寸（JS 端的座標系）
    private float canvasWidthCss = 0f;
    private float canvasHeightCss = 0f;

    // 對應的實際螢幕可點擊區域（px）與偏移
    private int canvasWidthPx = 0;
    private int canvasHeightPx = 0;
    private int canvasOffsetXPx = 0;
    private int canvasOffsetYPx = 0;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        Log.d(TAG, "onServiceConnected called!");
        density = getResources().getDisplayMetrics().density;

        // 讀取系統狀態列高度，之後在座標轉換時一併補上，避免受瀏海 / 狀態列影響
        int resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resId > 0) {
            statusBarHeightPx = getResources().getDimensionPixelSize(resId);
        }

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        // 讀取實際螢幕像素尺寸，之後在錄製全螢幕時使用這個尺寸對應 canvas
        if (windowManager != null) {
            DisplayMetrics dm = new DisplayMetrics();
            windowManager.getDefaultDisplay().getRealMetrics(dm);
            screenWidthPx = dm.widthPixels;
            screenHeightPx = dm.heightPixels;
        }

        Log.d(TAG, "Screen density=" + density + ", statusBarHeightPx=" + statusBarHeightPx
                + ", screenPx=" + screenWidthPx + "x" + screenHeightPx);
        createWebViewOverlay();
        createTouchOverlay();
        Log.d(TAG, "Overlay created successfully");
    }

    public static OmniClickAccessibilityService getInstance() {
        return instance;
    }

    // 由 FilePickerActivity 在選檔完成後呼叫，將檔案內容回傳給前端 JS
    public void onFilePickedFromActivity(String slot, String fileName, String content) {
        if (webView == null) {
            Log.w(TAG, "onFilePickedFromActivity called but webView is null");
            return;
        }

        Log.d(TAG, "onFilePickedFromActivity slot=" + slot + ", fileName=" + fileName);

        final String safeSlot = slot == null ? "" : slot;
        final String safeName = fileName == null ? "" : fileName.replace("\\", "\\\\").replace("\"", "\\\"");
        final String safeContent = content == null ? "" : content
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n");

        String js = "window.__omniclickOnFilePicked && window.__omniclickOnFilePicked(\"" + safeSlot + "\",\"" + safeName + "\",\"" + safeContent + "\")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void createWebViewOverlay() {
        if (windowManager == null) return;

        webView = new WebView(this);
        // 最終行為：WebView 本身完全透明，讓底下 App 可見
        webView.setBackgroundColor(0x00000000);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // Configure WebView / asset loader
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.addJavascriptInterface(new JsBridge(), "Android");

        // Map https://appassets.androidplatform.net/assets/... -> /android_asset/...
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        // Log 載入狀態與 JS console，並透過 WebViewAssetLoader 服務請求
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Log.d(TAG, "WebView onPageFinished: " + url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    Log.e(TAG, "WebView onReceivedError (main frame): " + error.getDescription());
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(TAG, "JS console: " + consoleMessage.message()
                        + " @" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber());
                return true;
            }
        });

        // Load the same built web assets that Capacitor uses
        // 透過 WebViewAssetLoader 使用 https://appassets.androidplatform.net/assets/... 來對應 /android_asset
        webView.loadUrl("https://appassets.androidplatform.net/assets/public/index.html");

        int type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;

        webViewLayoutParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );

        windowManager.addView(webView, webViewLayoutParams);
    }

    private void createTouchOverlay() {
        if (windowManager == null) return;

        touchView = new TouchOverlayView(this);

        int type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;

        touchLayoutParams = new WindowManager.LayoutParams(
                0,
                0,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        touchLayoutParams.gravity = Gravity.TOP | Gravity.START;

        windowManager.addView(touchView, touchLayoutParams);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Not used for now
    }

    @Override
    public void onInterrupt() {
        // Not used
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        if (windowManager != null) {
            if (webView != null) {
                windowManager.removeView(webView);
                webView = null;
            }
            if (touchView != null) {
                windowManager.removeView(touchView);
                touchView = null;
            }
        }
    }

    private class TouchOverlayView extends View {

        TouchOverlayView(Context context) {
            super(context);
            setBackgroundColor(0x00000000);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            float rawX = event.getRawX();
            float rawY = event.getRawY();

            if (webView != null) {
                MotionEvent copy = MotionEvent.obtain(event);
                int[] loc = new int[2];
                webView.getLocationOnScreen(loc);
                float localX = rawX - loc[0];
                float localY = rawY - loc[1];
                copy.setLocation(localX, localY);
                webView.dispatchTouchEvent(copy);
                copy.recycle();
            }

            // 錄製模式下，僅記錄座標到腳本（由 WebView 的 ClickCanvas 處理），
            // 不對底層 App 發送原生 tap，避免雙重操作。
            if (isRecordingMode && event.getAction() == MotionEvent.ACTION_UP) {
                Log.d(TAG, "onTouchEvent: recording mode, only capture (no native tap) at rawXY=(" + rawX + "," + rawY + ")");
            }

            return true;
        }
    }

    private class JsBridge {

        @JavascriptInterface
        public void updateOverlayRect(float x, float y, float width, float height) {
            overlayX = x;
            overlayY = y;
            overlayWidth = width;
            overlayHeight = height;
            Log.d(TAG, "updateOverlayRect from JS: x=" + x + ", y=" + y + ", w=" + width + ", h=" + height);
            updateTouchOverlayLayout();
        }

        // Alias that matches your spec: Android.reportPos(x, y, w, h)
        @JavascriptInterface
        public void reportPos(float x, float y, float width, float height) {
            updateOverlayRect(x, y, width, height);
        }

        @JavascriptInterface
        public void performClick(float x, float y) {
            // JS 傳入的是錄製時的 canvas 座標（CSS px），這裡依照「全螢幕 canvas」與實際螢幕的比例換算
            float xPx = x;
            float yPx = y;

            if (canvasWidthCss > 0 && canvasHeightCss > 0 &&
                    canvasWidthPx > 0 && canvasHeightPx > 0) {

                float xRatio = x / canvasWidthCss;
                float yRatio = y / canvasHeightCss;

                // Clamp to [0, 1] 避免超出邊界
                xRatio = Math.max(0f, Math.min(1f, xRatio));
                yRatio = Math.max(0f, Math.min(1f, yRatio));

                xPx = canvasOffsetXPx + (xRatio * canvasWidthPx);
                yPx = canvasOffsetYPx + (yRatio * canvasHeightPx);
            } else {
                // 後備：尚未取得完整 canvas 資訊時，退回 density-based 換算（不再額外加上狀態列偏移）
                xPx = x * density;
                yPx = y * density;
            }

            Log.d(TAG, "performClick from JS -> canvas(x=" + x + ", y=" + y + ") mappedPx(x=" + xPx + ", y=" + yPx + ")");
            tap(xPx, yPx);
        }

        // Alias that matches your spec: Android.tap(x, y)
        @JavascriptInterface
        public void tap(float x, float y) {
            performTapGesture(x, y);
        }

        // 從 overlay 內開啟原生檔案選擇器。slot 用來區分要填到哪一個輸入框（如 "import", "song", "layout"）。
        @JavascriptInterface
        public void openFilePicker(String slot) {
            Log.d(TAG, "openFilePicker from JS, slot=" + slot);
            try {
                Intent intent = new Intent(OmniClickAccessibilityService.this, FilePickerActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.putExtra("slot", slot);
                startActivity(intent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start FilePickerActivity", e);
            }
        }

        // 從 overlay 內觸發原生儲存流程，使用者可選擇資料夾與檔名。
        @JavascriptInterface
        public void saveFile(String fileName, String content) {
            Log.d(TAG, "saveFile from JS, fileName=" + fileName);
            try {
                Intent intent = new Intent(OmniClickAccessibilityService.this, FileSaveActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.putExtra("fileName", fileName);
                intent.putExtra("content", content);
                startActivity(intent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start FileSaveActivity", e);
            }
        }

        /**
         * 當前端 input 取得焦點時呼叫，移除 FLAG_NOT_FOCUSABLE 與 FLAG_NOT_TOUCHABLE
         * 讓軟鍵盤可以彈出，且 WebView 可直接接收觸控事件（避免被 touch overlay 攔截）。
         */
        @JavascriptInterface
        public void requestInputFocus() {
            Log.d(TAG, "requestInputFocus");
            new Handler(Looper.getMainLooper()).post(() -> {
                // 取消任何待執行的 clearFocus，避免 focus/blur 快速切換造成鍵盤閃退
                if (pendingClearFocusRunnable != null) {
                    clearFocusHandler.removeCallbacks(pendingClearFocusRunnable);
                    pendingClearFocusRunnable = null;
                }
                if (webView == null || windowManager == null || webViewLayoutParams == null) return;
                webViewLayoutParams.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                webViewLayoutParams.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                try {
                    windowManager.updateViewLayout(webView, webViewLayoutParams);
                } catch (Exception e) {
                    Log.e(TAG, "requestInputFocus updateViewLayout failed", e);
                }
                webView.requestFocus();
            });
        }

        /**
         * 當前端 input 失去焦點時呼叫。使用 300ms debounce 避免誤關鍵盤：
         * 如使用者只是誤觸 overlay 或切換 input，requestInputFocus 會取消待執行的 clear。
         * 同時恢復 FLAG_NOT_TOUCHABLE，讓 touch overlay 重新接管觸控事件。
         */
        @JavascriptInterface
        public void clearInputFocus() {
            Log.d(TAG, "clearInputFocus (debounced 300ms)");
            pendingClearFocusRunnable = () -> {
                pendingClearFocusRunnable = null;
                if (webView == null || windowManager == null || webViewLayoutParams == null) return;
                webViewLayoutParams.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                webViewLayoutParams.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                try {
                    windowManager.updateViewLayout(webView, webViewLayoutParams);
                } catch (Exception e) {
                    Log.e(TAG, "clearInputFocus updateViewLayout failed", e);
                }
            };
            clearFocusHandler.postDelayed(pendingClearFocusRunnable, 300);
        }

        /**
         * 由前端在開始/結束錄製時呼叫，控制是否允許 touch overlay 穿透 tap。
         */
        @JavascriptInterface
        public void setRecordingMode(boolean recording) {
            isRecordingMode = recording;
            Log.d(TAG, "setRecordingMode: " + recording + " [thread=" + Thread.currentThread().getName() + "]");
        }

        /**
         * 由前端回報 HUD 的螢幕 px 矩形，錄製時排除此區域不穿透 tap。
         */
        @JavascriptInterface
        public void setHudRect(float x, float y, float width, float height) {
            hudRectPxX = x;
            hudRectPxY = y;
            hudRectPxW = width;
            hudRectPxH = height;
            Log.d(TAG, "setHudRect: (" + x + "," + y + "," + width + "," + height + ")");
        }

        @JavascriptInterface
        public void close() {
            Handler mainHandler = new Handler(Looper.getMainLooper());
            mainHandler.post(() -> {
                if (windowManager != null) {
                    try {
                        if (webView != null) {
                            windowManager.removeView(webView);
                            webView = null;
                        }
                        if (touchView != null) {
                            windowManager.removeView(touchView);
                            touchView = null;
                        }
                    } catch (IllegalArgumentException e) {
                        Log.e(TAG, "Error removing overlay views in close()", e);
                    }
                }

                // 請求系統停用並關閉此無障礙服務，等同於在設定中將服務關閉
                disableSelf();
            });
        }
    }

    private void performTapGesture(float x, float y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return;
        }

        // 確保在主執行緒執行 dispatchGesture (提升穩定性，避免部分裝置線程問題)
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Path path = new Path();
                path.moveTo(x, y);
                // 使用 lineTo 確保路徑非空，雖然原地不動
                path.lineTo(x, y);

                // 增加持續時間至 100ms (50ms 有時會被視為誤觸或無效)
                GestureDescription.StrokeDescription stroke =
                        new GestureDescription.StrokeDescription(path, 0, 100);

                GestureDescription.Builder builder = new GestureDescription.Builder();
                builder.addStroke(stroke);

                Log.d(TAG, "Dispatching tap gesture at (" + x + ", " + y + ")");

                boolean displayed = dispatchGesture(builder.build(), new GestureResultCallback() {
                    @Override
                    public void onCompleted(GestureDescription gestureDescription) {
                        Log.d(TAG, "Gesture completed at (" + x + ", " + y + ")");
                    }

                    @Override
                    public void onCancelled(GestureDescription gestureDescription) {
                        Log.e(TAG, "Gesture cancelled at (" + x + ", " + y + ")");
                    }
                }, null);

                if (!displayed) {
                     Log.e(TAG, "dispatchGesture passed but returned false (system rejected)");
                }
            } catch (Exception e) {
                Log.e(TAG, "Exception in performTapGesture", e);
            }
        });
    }

    private void updateTouchOverlayLayout() {
        if (windowManager == null || touchView == null || touchLayoutParams == null) {
            return;
        }
        // JS 回報的是 dp / CSS px，這裡換成實際像素後更新 overlay 位置與大小
        Handler mainHandler = new Handler(Looper.getMainLooper());
        mainHandler.post(() -> {
            int xPx = (int) (overlayX * density);
            int yPx = (int) (overlayY * density);
            int wPx = (int) (overlayWidth * density);
            int hPx = (int) (overlayHeight * density);

            // 當 overlayX/Y 為 0 代表目前 overlay 佈滿整個錄製 canvas
            // 直接使用 overlay 的 dp * density 作為 canvas 的實際像素高度，
            // 這樣 JS canvas 座標 (0..overlayHeight) 會等比例對應到實際可點擊區域，
            // 不再被整個實體螢幕高度放大，避免垂直偏移。
            if (overlayX == 0f && overlayY == 0f) {
                canvasWidthCss = overlayWidth;
                canvasHeightCss = overlayHeight;
                canvasWidthPx = wPx;
                canvasHeightPx = hPx;
                canvasOffsetXPx = xPx;
                canvasOffsetYPx = yPx;

                Log.d(TAG, "Full canvas metrics -> css(" + canvasWidthCss + "x" + canvasHeightCss
                        + ") px(" + canvasWidthPx + "x" + canvasHeightPx + ") offset(" + canvasOffsetXPx
                        + ", " + canvasOffsetYPx + ")");
            }

            // 將像素值套用到觸控 overlay
            touchLayoutParams.width = wPx;
            touchLayoutParams.height = hPx;
            touchLayoutParams.x = xPx;
            touchLayoutParams.y = yPx;

            Log.d(TAG, "updateTouchOverlayLayout -> dp(x=" + overlayX + ", y=" + overlayY +
                    ", w=" + overlayWidth + ", h=" + overlayHeight + ") px(x=" + xPx +
                    ", y=" + yPx + ", w=" + wPx + ", h=" + hPx + ")");

            try {
                windowManager.updateViewLayout(touchView, touchLayoutParams);
            } catch (IllegalArgumentException | IllegalStateException e) {
                Log.e(TAG, "updateViewLayout failed", e);
            }
        });
    }
}
