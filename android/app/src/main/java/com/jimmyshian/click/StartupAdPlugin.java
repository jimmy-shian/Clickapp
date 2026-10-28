package com.jimmyshian.click;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.appopen.AppOpenAd;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "StartupAd")
public class StartupAdPlugin extends Plugin {
    @PluginMethod
    public void showAppOpen(PluginCall call) {
        String adUnitId = call.getString("adUnitId", "").trim();
        Activity activity = getActivity();
        if (adUnitId.isEmpty() || activity == null || activity.isFinishing()) {
            resolve(call, false);
            return;
        }

        call.setKeepAlive(true);
        Handler handler = new Handler(Looper.getMainLooper());
        AtomicBoolean settled = new AtomicBoolean(false);
        Runnable timeout = () -> finish(call, handler, settled, null, false);
        handler.postDelayed(timeout, 2500L);

        activity.runOnUiThread(() -> MobileAds.initialize(activity, status -> {
            if (settled.get() || activity.isFinishing()) return;
            AppOpenAd.load(activity, adUnitId, new AdRequest.Builder().build(),
                new AppOpenAd.AppOpenAdLoadCallback() {
                    @Override
                    public void onAdLoaded(@NonNull AppOpenAd ad) {
                        if (settled.get() || activity.isFinishing()) return;
                        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                            @Override
                            public void onAdDismissedFullScreenContent() {
                                finish(call, handler, settled, timeout, true);
                            }

                            @Override
                            public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                                finish(call, handler, settled, timeout, false);
                            }
                        });
                        ad.show(activity);
                    }

                    @Override
                    public void onAdFailedToLoad(@NonNull LoadAdError error) {
                        finish(call, handler, settled, timeout, false);
                    }
                });
        }));
    }

    private void finish(PluginCall call, Handler handler, AtomicBoolean settled,
                        Runnable timeout, boolean shown) {
        if (!settled.compareAndSet(false, true)) return;
        if (timeout != null) handler.removeCallbacks(timeout);
        resolve(call, shown);
    }

    private void resolve(PluginCall call, boolean shown) {
        JSObject result = new JSObject();
        result.put("shown", shown);
        call.resolve(result);
    }
}
