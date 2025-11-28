package com.jimmyshian.click;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;

public class OmniClickAccessibilityService extends AccessibilityService {

    private WindowManager windowManager;
    private WebView webView;
    private TouchOverlayView touchView;
    private WindowManager.LayoutParams touchLayoutParams;

    private float overlayX = 0f;
    private float overlayY = 0f;
    private float overlayWidth = 0f;
    private float overlayHeight = 0f;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createWebViewOverlay();
        createTouchOverlay();
    }

    private void createWebViewOverlay() {
        if (windowManager == null) return;

        webView = new WebView(this);
        webView.setBackgroundColor(0x00000000);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.addJavascriptInterface(new JsBridge(), "Android");

        // Load the same built web assets that Capacitor uses
        webView.loadUrl("file:///android_asset/public/index.html");

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
                copy.setLocation(rawX, rawY);
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
            updateTouchOverlayLayout();
        }

        // Alias that matches your spec: Android.reportPos(x, y, w, h)
        @JavascriptInterface
        public void reportPos(float x, float y, float width, float height) {
            updateOverlayRect(x, y, width, height);
        }

        @JavascriptInterface
        public void performClick(float x, float y) {
            tap(x, y);
        }

        // Alias that matches your spec: Android.tap(x, y)
        @JavascriptInterface
        public void tap(float x, float y) {
            performTapGesture(x, y);
        }

        @JavascriptInterface
        public void close() {
            stopSelf();
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

        dispatchGesture(builder.build(), null, null);
    }

    private void updateTouchOverlayLayout() {
        if (windowManager == null || touchView == null || touchLayoutParams == null) {
            return;
        }

        touchLayoutParams.width = (int) overlayWidth;
        touchLayoutParams.height = (int) overlayHeight;
        touchLayoutParams.x = (int) overlayX;
        touchLayoutParams.y = (int) overlayY;

        windowManager.updateViewLayout(touchView, touchLayoutParams);
    }
}
