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
    /** 網頁未提供廣告槽高度時的預設卡片高度（dp） */
    private static final float DEFAULT_AD_HEIGHT_DP = 220f;

    private FrameLayout overlayRoot;
    private NativeAd currentAd;
    /** 目前顯示中的原生廣告卡片（供 updateNativeAt 重新定位，不需重新載入廣告） */
    private NativeAdView currentAdView;

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
        // 廣告槽高度（css px = dp）：原生卡片依此縮排，確保不超出設計版位
        double h = call.getDouble("height", 0d);
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
                    float heightDp = h > 0f ? (float) h : DEFAULT_AD_HEIGHT_DP;
                    NativeAdView adView = buildNativeAdView(activity, ad, widthDp, heightDp);
                    boolean placed = attachOverlay(activity, ad, adView, (float) x, (float) y, widthDp);
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

    /**
     * 版面變動（例如旋轉、系統列 inset 變化）時只重新定位既有廣告卡片，
     * 不重新載入廣告，避免曝光計數被重複計算。
     */
    @PluginMethod
    public void updateNativeAt(PluginCall call) {
        double x = call.getDouble("x", 0d);
        double y = call.getDouble("y", 0d);
        double w = call.getDouble("width", 320d);
        Activity activity = getActivity();
        NativeAdView adView = currentAdView;
        if (activity == null || adView == null) {
            call.resolve();
            return;
        }
        float density = activity.getResources().getDisplayMetrics().density;
        activity.runOnUiThread(() -> {
            ViewGroup.LayoutParams raw = adView.getLayoutParams();
            if (!(raw instanceof FrameLayout.LayoutParams)) return;
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) raw;
            lp.leftMargin = Math.round((float) x * density);
            lp.topMargin = Math.round((float) y * density);
            lp.width = Math.round((float) Math.max(200f, w) * density);
            adView.setLayoutParams(lp);
        });
        call.resolve();
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

    private boolean attachOverlay(Activity activity, NativeAd ad, NativeAdView adView, float xDp, float yDp, float widthDp) {
        hideOverlayInternal();
        ViewGroup content = activity.findViewById(android.R.id.content);
        if (content == null || adView.getParent() != null) {
            ad.destroy();
            return false;
        }
        float density = activity.getResources().getDisplayMetrics().density;
        // adView 尚未掛上父層、沒有 LayoutParams，必須自行建立（直接取會是 null 而崩潰）
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            Math.round(widthDp * density), ViewGroup.LayoutParams.WRAP_CONTENT);
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
        currentAdView = adView;
        return true;
    }

    private void hideOverlayInternal() {
        if (currentAd != null) {
            NativeAd ad = currentAd;
            currentAd = null;
            try { ad.destroy(); } catch (Exception ignored) {}
        }
        currentAdView = null;
        if (overlayRoot != null) {
            ViewGroup parent = (ViewGroup) overlayRoot.getParent();
            if (parent != null) parent.removeView(overlayRoot);
            overlayRoot = null;
        }
    }

    /**
     * 程式化建立 NativeAdView 卡片（深色面板，貼合 6 個 App 的深色調性）。
     * 必須先註冊 asset views 再 setNativeAd，Google 才會記錄曝光與點擊。
     *
     * maxHeightDp ＝ 網頁設計好的廣告槽高度：卡片版面依此預算縮排，
     * 確保原生廣告不會超出版位、蓋住下方的 HUD 元素（步驟列／頁尾）。
     */
    private NativeAdView buildNativeAdView(Activity activity, NativeAd ad, float widthDp, float maxHeightDp) {
        float density = activity.getResources().getDisplayMetrics().density;

        // ---- 版面高度預算（dp）----
        int budgetDp = (int) Math.max(0f, Math.floor(maxHeightDp));
        boolean roomy = budgetDp >= 180;
        int padDp = roomy ? 10 : 6;
        int badgeDp = roomy ? 18 : 16;
        int gapDp = roomy ? 8 : 6;
        int gapCtaDp = roomy ? 10 : 8;
        int gapBodyDp = 6;
        int gapStarsDp = 6;
        int headlineDp = roomy ? 40 : 20;  // 寬版位標題最多兩行，窄版位限一行
        int bodyDp = 34;                  // 內文最多兩行
        int starsDp = 16;
        int ctaDp = roomy ? 40 : 32;

        int fixedDp = padDp * 2 + badgeDp + gapDp + gapDp + headlineDp + gapCtaDp + ctaDp;
        int freeDp = budgetDp - fixedDp;
        // 媒體至少留 56dp，否則先捨棄內文／評星，把空間留給媒體
        boolean showBody = freeDp - (gapBodyDp + bodyDp) >= 56 && !TextUtils.isEmpty(ad.getBody());
        boolean showStars = showBody && ad.getStarRating() != null && ad.getStarRating() > 0
                && freeDp - (gapBodyDp + bodyDp) - (gapStarsDp + starsDp) >= 56;
        int mediaDp = freeDp
                - (showBody ? gapBodyDp + bodyDp : 0)
                - (showStars ? gapStarsDp + starsDp : 0);
        mediaDp = Math.max(0, Math.min(mediaDp, 180));

        int pad = dp(density, padDp);

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

        // 媒體視覺（高度取自版位預算，確保整張卡片不超出廣告槽）
        MediaView mediaView = null;
        TextView headlineView = null;
        TextView bodyView = null;
        MediaContent mediaContent = ad.getMediaContent();
        if (mediaContent != null && mediaDp > 0) {
            mediaView = new MediaView(activity);
            LinearLayout.LayoutParams mediaLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(density, mediaDp));
            mediaLp.topMargin = dp(density, gapDp);
            mediaView.setLayoutParams(mediaLp);
            card.addView(mediaView);
        }

        if (!TextUtils.isEmpty(ad.getHeadline())) {
            headlineView = new TextView(activity);
            headlineView.setText(ad.getHeadline());
            headlineView.setTextColor(Color.WHITE);
            headlineView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 15);
            headlineView.setTypeface(Typeface.DEFAULT_BOLD);
            headlineView.setMaxLines(roomy ? 2 : 1);
            headlineView.setEllipsize(TextUtils.TruncateAt.END);
            headlineView.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams hLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(density, headlineDp));
            hLp.topMargin = dp(density, gapDp);
            headlineView.setLayoutParams(hLp);
            card.addView(headlineView);
        }

        if (showBody) {
            bodyView = new TextView(activity);
            bodyView.setText(ad.getBody());
            bodyView.setTextColor(Color.parseColor("#D1D5DB"));
            bodyView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12);
            bodyView.setMaxLines(2);
            bodyView.setEllipsize(TextUtils.TruncateAt.END);
            bodyView.setGravity(Gravity.CENTER_VERTICAL);
            bodyView.setLineSpacing(dp(density, 2), 1f);
            LinearLayout.LayoutParams bLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(density, bodyDp));
            bLp.topMargin = dp(density, gapBodyDp);
            bodyView.setLayoutParams(bLp);
            card.addView(bodyView);
        }

        if (showStars) {
            TextView stars = new TextView(activity);
            stars.setText("★ " + ad.getStarRating());
            stars.setTextColor(Color.parseColor("#FBBF24"));
            stars.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12);
            LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, dp(density, starsDp));
            sLp.topMargin = dp(density, gapStarsDp);
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
            LinearLayout.LayoutParams.MATCH_PARENT, dp(density, ctaDp));
        ctaLp.topMargin = dp(density, gapCtaDp);
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
