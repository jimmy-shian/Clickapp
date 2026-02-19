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

    /**
     * 共用：將 canvas CSS 座標轉換為螢幕 pixel 座標。
     * 回傳 float[2]，[0]=xPx, [1]=yPx
     */
    private float[] mapCanvasToScreen(float canvasX, float canvasY) {
        float xPx, yPx;
        if (canvasWidthCss > 0 && canvasHeightCss > 0 &&
                canvasWidthPx > 0 && canvasHeightPx > 0) {
            float xRatio = Math.max(0f, Math.min(1f, canvasX / canvasWidthCss));
            float yRatio = Math.max(0f, Math.min(1f, canvasY / canvasHeightCss));
            xPx = canvasOffsetXPx + (xRatio * canvasWidthPx);
            yPx = canvasOffsetYPx + (yRatio * canvasHeightPx);
        } else {
            xPx = canvasX * density;
            yPx = canvasY * density;
        }
        return new float[]{xPx, yPx};
    }

    /**
     * 隱藏 touchView（錄製穿透用）
     */
    private void hideTouchOverlay() {
        if (touchView == null || touchLayoutParams == null || windowManager == null) return;
        try {
            touchLayoutParams.width = 0;
            touchLayoutParams.height = 0;
            windowManager.updateViewLayout(touchView, touchLayoutParams);
        } catch (Exception e) {
            Log.e(TAG, "hideTouchOverlay failed", e);
        }
    }

    /**
     * 同時隱藏 touchView 與 webView（讓原生手勢可以穿透到底層 App）
     */
    private void hideAllOverlays() {
        if (windowManager == null) return;
        // 隱藏 touchView
        hideTouchOverlay();
        // 讓 webView 不可觸控且不佔位，但不移除（保留 JS 執行環境）
        if (webView != null && webViewLayoutParams != null) {
            try {
                webViewLayoutParams.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                // 移到螢幕外，避免遮擋手勢
                webViewLayoutParams.x = -10000;
                windowManager.updateViewLayout(webView, webViewLayoutParams);
            } catch (Exception e) {
                Log.e(TAG, "hideAllOverlays webView failed", e);
            }
        }
    }

    /**
     * 恢復所有 overlay（錄製穿透用，在手勢完成後呼叫）
     */
    private void restoreAllOverlays() {
        if (windowManager == null) return;
        // 恢復 webView
        if (webView != null && webViewLayoutParams != null) {
            try {
                webViewLayoutParams.x = 0;
                // 仍維持 NOT_FOCUSABLE + NOT_TOUCHABLE（overlay 模式，由 touchView 轉發觸控）
                webViewLayoutParams.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                windowManager.updateViewLayout(webView, webViewLayoutParams);
            } catch (Exception e) {
                Log.e(TAG, "restoreAllOverlays webView failed", e);
            }
        }
        // 恢復 touchView（使用目前 overlay 矩形）
        updateTouchOverlayLayout();
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
            float[] mapped = mapCanvasToScreen(x, y);
            Log.d(TAG, "performClick from JS -> canvas(x=" + x + ", y=" + y + ") mappedPx(x=" + mapped[0] + ", y=" + mapped[1] + ")");
            performTapGesture(mapped[0], mapped[1]);
        }

        // Alias that matches your spec: Android.tap(x, y)
        @JavascriptInterface
        public void tap(float x, float y) {
            performTapGesture(x, y);
        }

        /**
         * 播放時的 swipe：JS 傳入 canvas CSS 座標，這裡做比例換算後呼叫原生 swipe。
         */
        @JavascriptInterface
        public void performSwipe(float x1, float y1, float x2, float y2, float durationMs) {
            float[] start = mapCanvasToScreen(x1, y1);
            float[] end = mapCanvasToScreen(x2, y2);
            Log.d(TAG, "performSwipe from JS -> canvas(" + x1 + "," + y1 + ")->(" + x2 + "," + y2 + ") mapped(" + start[0] + "," + start[1] + ")->(" + end[0] + "," + end[1] + ")");
            performSwipeGesture(start[0], start[1], end[0], end[1], (long) Math.max(100, durationMs));
        }

        // 直接 pixel 的 swipe（舊版相容）
        @JavascriptInterface
        public void swipe(float x1, float y1, float x2, float y2, float durationMs) {
            performSwipeGesture(x1, y1, x2, y2, (long) Math.max(100, durationMs));
        }

        /**
         * 錄製時的穿透 tap：JS 在錄完一個 click step 後呼叫，
         * 先隱藏所有 overlay → 執行原生 tap → 完成後恢復 overlay。
         */
        @JavascriptInterface
        public void dispatchRecordedGesture(float canvasX, float canvasY) {
            float[] mapped = mapCanvasToScreen(canvasX, canvasY);
            Log.d(TAG, "dispatchRecordedGesture canvas(" + canvasX + "," + canvasY + ") -> px(" + mapped[0] + "," + mapped[1] + ")");

            new Handler(Looper.getMainLooper()).post(() -> {
                hideAllOverlays();

                // 短暫延遲讓 WindowManager 移除 overlay，確保手勢不會被攔截
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    dispatchTapWithCallback(mapped[0], mapped[1], () -> {
                        // 手勢完成後恢復 overlay
                        new Handler(Looper.getMainLooper()).post(() -> restoreAllOverlays());
                    });
                }, 50);
            });
        }

        /**
         * 錄製時的穿透 swipe：JS 在錄完一個 swipe step 後呼叫。
         */
        @JavascriptInterface
        public void dispatchRecordedSwipe(float x1, float y1, float x2, float y2, float durationMs) {
            float[] start = mapCanvasToScreen(x1, y1);
            float[] end = mapCanvasToScreen(x2, y2);
            long dur = (long) Math.max(100, durationMs);
            Log.d(TAG, "dispatchRecordedSwipe canvas(" + x1 + "," + y1 + ")->(" + x2 + "," + y2 + ") -> px(" + start[0] + "," + start[1] + ")->(" + end[0] + "," + end[1] + ")");

            new Handler(Looper.getMainLooper()).post(() -> {
                hideAllOverlays();

                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    dispatchSwipeWithCallback(start[0], start[1], end[0], end[1], dur, () -> {
                        new Handler(Looper.getMainLooper()).post(() -> restoreAllOverlays());
                    });
                }, 50);
            });
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

                // 隱藏 touchView，避免它攔截鍵盤觸控事件
                // TYPE_ACCESSIBILITY_OVERLAY 層級高於軟鍵盤，touchView 會吃掉鍵盤的觸控
                if (touchView != null && touchLayoutParams != null) {
                    try {
                        touchLayoutParams.width = 0;
                        touchLayoutParams.height = 0;
                        windowManager.updateViewLayout(touchView, touchLayoutParams);
                        Log.d(TAG, "requestInputFocus: touchView hidden (0x0)");
                    } catch (Exception e) {
                        Log.e(TAG, "requestInputFocus hide touchView failed", e);
                    }
                }
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

                // 恢復 touchView 到上次的 overlay 矩形
                if (touchView != null && touchLayoutParams != null) {
                    try {
                        updateTouchOverlayLayout();
                        Log.d(TAG, "clearInputFocus: touchView restored");
                    } catch (Exception e) {
                        Log.e(TAG, "clearInputFocus restore touchView failed", e);
                    }
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

    private void performSwipeGesture(float x1, float y1, float x2, float y2, long durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return;
        }

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Path path = new Path();
                path.moveTo(x1, y1);
                path.lineTo(x2, y2);

                GestureDescription.StrokeDescription stroke =
                        new GestureDescription.StrokeDescription(path, 0, durationMs);

                GestureDescription.Builder builder = new GestureDescription.Builder();
                builder.addStroke(stroke);

                Log.d(TAG, "Dispatching swipe gesture from (" + x1 + ", " + y1 + ") to (" + x2 + ", " + y2 + ") duration=" + durationMs + "ms");

                boolean dispatched = dispatchGesture(builder.build(), new GestureResultCallback() {
                    @Override
                    public void onCompleted(GestureDescription gestureDescription) {
                        Log.d(TAG, "Swipe gesture completed");
                    }

                    @Override
                    public void onCancelled(GestureDescription gestureDescription) {
                        Log.e(TAG, "Swipe gesture cancelled");
                    }
                }, null);

                if (!dispatched) {
                    Log.e(TAG, "dispatchGesture for swipe returned false (system rejected)");
                }
            } catch (Exception e) {
                Log.e(TAG, "Exception in performSwipeGesture", e);
            }
        });
    }

    /**
     * 帶完成回呼的 tap 手勢（供錄製穿透使用）
     */
    private void dispatchTapWithCallback(float x, float y, Runnable onDone) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            if (onDone != null) onDone.run();
            return;
        }
        try {
            Path path = new Path();
            path.moveTo(x, y);
            path.lineTo(x, y);
            GestureDescription.StrokeDescription stroke =
                    new GestureDescription.StrokeDescription(path, 0, 100);
            GestureDescription.Builder builder = new GestureDescription.Builder();
            builder.addStroke(stroke);

            Log.d(TAG, "dispatchTapWithCallback at (" + x + ", " + y + ")");
            boolean ok = dispatchGesture(builder.build(), new GestureResultCallback() {
                @Override
                public void onCompleted(GestureDescription g) {
                    Log.d(TAG, "Recorded tap completed at (" + x + ", " + y + ")");
                    if (onDone != null) onDone.run();
                }
                @Override
                public void onCancelled(GestureDescription g) {
                    Log.e(TAG, "Recorded tap cancelled at (" + x + ", " + y + ")");
                    if (onDone != null) onDone.run();
                }
            }, null);
            if (!ok && onDone != null) onDone.run();
        } catch (Exception e) {
            Log.e(TAG, "Exception in dispatchTapWithCallback", e);
            if (onDone != null) onDone.run();
        }
    }

    /**
     * 帶完成回呼的 swipe 手勢（供錄製穿透使用）
     */
    private void dispatchSwipeWithCallback(float x1, float y1, float x2, float y2, long durationMs, Runnable onDone) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            if (onDone != null) onDone.run();
            return;
        }
        try {
            Path path = new Path();
            path.moveTo(x1, y1);
            path.lineTo(x2, y2);
            GestureDescription.StrokeDescription stroke =
                    new GestureDescription.StrokeDescription(path, 0, durationMs);
            GestureDescription.Builder builder = new GestureDescription.Builder();
            builder.addStroke(stroke);

            Log.d(TAG, "dispatchSwipeWithCallback (" + x1 + "," + y1 + ")->(" + x2 + "," + y2 + ") dur=" + durationMs);
            boolean ok = dispatchGesture(builder.build(), new GestureResultCallback() {
                @Override
                public void onCompleted(GestureDescription g) {
                    Log.d(TAG, "Recorded swipe completed");
                    if (onDone != null) onDone.run();
                }
                @Override
                public void onCancelled(GestureDescription g) {
                    Log.e(TAG, "Recorded swipe cancelled");
                    if (onDone != null) onDone.run();
                }
            }, null);
            if (!ok && onDone != null) onDone.run();
        } catch (Exception e) {
            Log.e(TAG, "Exception in dispatchSwipeWithCallback", e);
            if (onDone != null) onDone.run();
        }
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
