package com.yesolve.click;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MediaContent;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.nativead.MediaView;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdView;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 原生進階 (Native Advanced) 開場廣告。
 *
 * 網頁 SplashAd 先畫好自己的設計畫面，量出廣告槽的位置（css px = dp），
 * 再呼叫 showNativeAt 通知本 plugin；本 plugin 以 AdLoader 載入 NativeAd，
 * 在該位置上方放一顆原生 NativeAdView 卡片，讓「設計畫面」與
 * 「真正的 Google 廣告」合為同一層、同一個體驗（不再有第二層全螢幕蓋版）。
 */
@CapacitorPlugin(name = "StartupAd")
public class StartupAdPlugin extends Plugin {

    private static final long LOAD_TIMEOUT_MS = 8000L;

    private FrameLayout overlayRoot;
    private NativeAd currentAd;

    /**
     * 每次 showNativeAt／hideNative 遞增；用來作廢仍在載入中的請求，
     * 避免開場已關閉後才填入的廣告自行放上畫面。
     */
    private final AtomicInteger loadGeneration = new AtomicInteger(0);

    @PluginMethod
    public void showNativeAt(PluginCall call) {
        String adUnitId = call.getString("adUnitId", "").trim();
        double x = call.getDouble("x", 0d);
        double y = call.getDouble("y", 0d);
        double w = call.getDouble("width", 320d);
        Activity activity = getActivity();
        if (adUnitId.isEmpty() || activity == null || activity.isFinishing()) {
            resolveLoaded(call, false);
            return;
        }

        call.setKeepAlive(true);
        final int generation = loadGeneration.incrementAndGet();
        Handler handler = new Handler(Looper.getMainLooper());
        AtomicBoolean settled = new AtomicBoolean(false);
        Runnable timeout = () -> {
            if (settled.compareAndSet(false, true)) {
                resolveLoaded(call, false);
            }
        };
        handler.postDelayed(timeout, LOAD_TIMEOUT_MS);

        activity.runOnUiThread(() -> MobileAds.initialize(activity, status -> {
            if (settled.get() || generation != loadGeneration.get() || activity.isFinishing()) return;

            AdLoader loader = new AdLoader.Builder(activity, adUnitId)
                .forNativeAd(ad -> {
                    if (!settled.compareAndSet(false, true)) { ad.destroy(); return; }
                    handler.removeCallbacks(timeout);
                    if (generation != loadGeneration.get()) { ad.destroy(); resolveLoaded(call, false); return; }
                    if (activity.isFinishing()) { ad.destroy(); resolveLoaded(call, false); return; }
                    float widthDp = (float) Math.max(200f, w);
                    NativeAdView adView = buildNativeAdView(activity, ad, widthDp);
                    boolean placed = attachOverlay(activity, ad, adView, (float) x, (float) y);
                    resolveLoaded(call, placed);
                })
                .withAdListener(new AdListener() {
                    @Override
                    public void onAdFailedToLoad(@NonNull LoadAdError error) {
                        if (settled.compareAndSet(false, true)) {
                            resolveLoaded(call, false);
                        }
                    }
                })
                .build();
            loader.loadAd(new AdRequest.Builder().build());
        }));
    }

    @PluginMethod
    public void hideNative(PluginCall call) {
        // 作廢仍在載入中的請求：開場已關閉時，延遲填入的廣告不可再自行放上畫面。
        loadGeneration.incrementAndGet();
        Activity activity = getActivity();
        if (activity != null && !activity.isFinishing()) {
            activity.runOnUiThread(this::hideOverlayInternal);
        }
        call.resolve();
    }

    /** 舊 API：保留相容（開場已改為原生進階合一，此方法不再被呼叫）。 */
    @PluginMethod
    public void showAppOpen(PluginCall call) {
        resolveShown(call, false);
    }

    // ------------------------------------------------------------------ //

    private boolean attachOverlay(Activity activity, NativeAd ad, NativeAdView adView, float xDp, float yDp) {
        hideOverlayInternal();
        ViewGroup content = activity.findViewById(android.R.id.content);
        if (content == null || adView.getParent() != null) {
            ad.destroy();
            return false;
        }
        float density = activity.getResources().getDisplayMetrics().density;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) adView.getLayoutParams();
        lp.leftMargin = Math.round(xDp * density);
        lp.topMargin = Math.round(yDp * density);
        adView.setLayoutParams(lp);

        FrameLayout root = new FrameLayout(activity);
        root.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(adView);
        content.addView(root);

        overlayRoot = root;
        currentAd = ad;
        return true;
    }

    private void hideOverlayInternal() {
        if (currentAd != null) {
            NativeAd ad = currentAd;
            currentAd = null;
            try { ad.destroy(); } catch (Exception ignored) {}
        }
        if (overlayRoot != null) {
            ViewGroup parent = (ViewGroup) overlayRoot.getParent();
            if (parent != null) parent.removeView(overlayRoot);
            overlayRoot = null;
        }
    }

    /**
     * 程式化建立 NativeAdView 卡片（深色面板，貼合 6 個 App 的深色調性）。
     * 必須先註冊 asset views 再 setNativeAd，Google 才會記錄曝光與點擊。
     */
    private NativeAdView buildNativeAdView(Activity activity, NativeAd ad, float widthDp) {
        float density = activity.getResources().getDisplayMetrics().density;
        int pad = dp(density, 12);

        LinearLayout card = new LinearLayout(activity);
        card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#111827"));
        bg.setCornerRadius(dp(density, 14));
        card.setBackground(bg);
        card.setPadding(pad, pad, pad, pad);

        // 「廣告」標示列（Google 原生廣告政策：必須讓使用者明確辨識）+
        // advertiser（登錄為 AdChoice 區域外的次要資訊，不註冊亦可）
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView badge = new TextView(activity);
        badge.setText("廣告");
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 10);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(Color.parseColor("#374151"));
        badgeBg.setCornerRadius(dp(density, 4));
        badge.setBackground(badgeBg);
        badge.setPadding(dp(density, 6), dp(density, 2), dp(density, 6), dp(density, 2));
        badge.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        row.addView(badge);

        if (!TextUtils.isEmpty(ad.getAdvertiser())) {
            TextView advertiser = new TextView(activity);
            advertiser.setText(ad.getAdvertiser());
            advertiser.setTextColor(Color.parseColor("#9CA3AF"));
            advertiser.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 11);
            advertiser.setMaxLines(1);
            advertiser.setEllipsize(TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams advLp = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            advLp.leftMargin = dp(density, 8);
            advertiser.setLayoutParams(advLp);
            row.addView(advertiser);
        }
        card.addView(row);

        // 媒體視覺
        MediaView mediaView = null;
        TextView headlineView = null;
        TextView bodyView = null;
        MediaContent mediaContent = ad.getMediaContent();
        if (mediaContent != null) {
            float inner = widthDp - 24f;
            float ratio = mediaContent.getAspectRatio() > 0f ? mediaContent.getAspectRatio() : 1.2f;
            int mediaHeight = (int) Math.max(dp(density, 120), Math.min(dp(density, 220), inner / ratio));
            mediaView = new MediaView(activity);
            LinearLayout.LayoutParams mediaLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, mediaHeight);
            mediaLp.topMargin = dp(density, 10);
            mediaView.setLayoutParams(mediaLp);
            card.addView(mediaView);
        }

        if (!TextUtils.isEmpty(ad.getHeadline())) {
            headlineView = new TextView(activity);
            headlineView.setText(ad.getHeadline());
            headlineView.setTextColor(Color.WHITE);
            headlineView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 15);
            headlineView.setTypeface(Typeface.DEFAULT_BOLD);
            headlineView.setMaxLines(2);
            headlineView.setEllipsize(TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams hLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            hLp.topMargin = dp(density, 10);
            headlineView.setLayoutParams(hLp);
            card.addView(headlineView);
        }

        if (!TextUtils.isEmpty(ad.getBody())) {
            bodyView = new TextView(activity);
            bodyView.setText(ad.getBody());
            bodyView.setTextColor(Color.parseColor("#D1D5DB"));
            bodyView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12);
            bodyView.setMaxLines(3);
            bodyView.setEllipsize(TextUtils.TruncateAt.END);
            bodyView.setLineSpacing(dp(density, 2), 1f);
            LinearLayout.LayoutParams bLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            bLp.topMargin = dp(density, 6);
            bodyView.setLayoutParams(bLp);
            card.addView(bodyView);
        }

        if (ad.getStarRating() != null && ad.getStarRating() > 0) {
            TextView stars = new TextView(activity);
            stars.setText("★ " + ad.getStarRating());
            stars.setTextColor(Color.parseColor("#FBBF24"));
            stars.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12);
            LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            sLp.topMargin = dp(density, 6);
            stars.setLayoutParams(sLp);
            card.addView(stars);
        }

        Button cta = new Button(activity);
        cta.setText(TextUtils.isEmpty(ad.getCallToAction()) ? "瞭解更多" : ad.getCallToAction());
        cta.setTextColor(Color.WHITE);
        cta.setAllCaps(false);
        cta.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 13);
        cta.setTypeface(Typeface.DEFAULT_BOLD);
        cta.setStateListAnimator(null);
        GradientDrawable ctaBg = new GradientDrawable();
        ctaBg.setColor(Color.parseColor("#2563EB"));
        ctaBg.setCornerRadius(dp(density, 10));
        cta.setBackground(ctaBg);
        LinearLayout.LayoutParams ctaLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(density, 42));
        ctaLp.topMargin = dp(density, 12);
        cta.setLayoutParams(ctaLp);
        card.addView(cta);

        NativeAdView adView = new NativeAdView(activity);
        card.setLayoutParams(new LinearLayout.LayoutParams(
            Math.round(widthDp * density), ViewGroup.LayoutParams.WRAP_CONTENT));
        adView.addView(card);

        // 註冊資產 views（曝光/點擊歸因必需），順序：先註冊後 setNativeAd
        if (mediaView != null) adView.setMediaView(mediaView);
        if (headlineView != null) adView.setHeadlineView(headlineView);
        if (bodyView != null) adView.setBodyView(bodyView);
        adView.setCallToActionView(cta);
        adView.setNativeAd(ad);
        return adView;
    }

    private int dp(float density, int value) {
        return Math.round(value * density);
    }

    private void resolveLoaded(PluginCall call, boolean loaded) {
        JSObject result = new JSObject();
        result.put("loaded", loaded);
        call.resolve(result);
    }

    private void resolveShown(PluginCall call, boolean shown) {
        JSObject result = new JSObject();
        result.put("shown", shown);
        call.resolve(result);
    }
}
