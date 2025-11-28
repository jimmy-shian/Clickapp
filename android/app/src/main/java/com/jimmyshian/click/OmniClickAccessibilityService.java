package com.jimmyshian.click;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
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
    private WindowManager windowManager;
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private TouchOverlayView touchView;
    private WindowManager.LayoutParams touchLayoutParams;

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

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );

        windowManager.addView(webView, params);
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
            if (webView != null) {
                MotionEvent copy = MotionEvent.obtain(event);
                float rawX = event.getRawX();
                float rawY = event.getRawY();
                int[] loc = new int[2];
                webView.getLocationOnScreen(loc);
                float localX = rawX - loc[0];
                float localY = rawY - loc[1];
                copy.setLocation(localX, localY);
                webView.dispatchTouchEvent(copy);
                copy.recycle();
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

                // 結束本 AccessibilityService 執行個體，視覺上等同「關閉 App」，但不會把服務從系統設定中取消勾選
                stopSelf();
            });
        }
    }

    private void performTapGesture(float x, float y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return;
        }

        Path path = new Path();
        path.moveTo(x, y);
        path.lineTo(x, y);

        GestureDescription.StrokeDescription stroke =
                new GestureDescription.StrokeDescription(path, 0, 50);

        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(stroke);

        final float fx = x;
        final float fy = y;

        dispatchGesture(builder.build(), new GestureResultCallback() {
            @Override
            public void onCompleted(GestureDescription gestureDescription) {
                Log.d(TAG, "Gesture completed at (" + fx + ", " + fy + ")");
            }

            @Override
            public void onCancelled(GestureDescription gestureDescription) {
                Log.e(TAG, "Gesture cancelled at (" + fx + ", " + fy + ")");
            }
        }, null);
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
