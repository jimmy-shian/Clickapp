package com.jimmyshian.click;

import android.content.ComponentName;
import android.content.Intent;
import android.provider.Settings;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "OmniClickMainActivity";
    private static final long CHECK_DELAY_MS = 500;
    private Handler checkHandler;
    private Runnable checkRunnable;

    @Override
    public void onStart() {
        super.onStart();
        Log.d(TAG, "onStart called");
        startPeriodicCheck();
    }

    @Override
    public void onStop() {
        super.onStop();
        Log.d(TAG, "onStop called");
        stopPeriodicCheck();
    }

    private void startPeriodicCheck() {
        if (checkHandler == null) {
            checkHandler = new Handler(Looper.getMainLooper());
        }
        
        checkRunnable = () -> {
            Log.d(TAG, "Checking accessibility service status...");
            if (isAccessibilityServiceEnabled()) {
                Log.d(TAG, "Accessibility service is enabled, moving to background");
                // 服務已啟用，移到背景讓 overlay 顯示
                moveTaskToBack(true);
                stopPeriodicCheck();
            } else {
                Log.d(TAG, "Accessibility service is NOT enabled, showing settings");
                // 服務未啟用，帶使用者去開啟
                Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                startActivity(intent);
                // 繼續檢查，直到服務啟用
                checkHandler.postDelayed(checkRunnable, CHECK_DELAY_MS);
            }
        };
        
        checkHandler.post(checkRunnable);
    }

    private void stopPeriodicCheck() {
        if (checkHandler != null && checkRunnable != null) {
            checkHandler.removeCallbacks(checkRunnable);
        }
    }

    private boolean isAccessibilityServiceEnabled() {
        try {
            int enabled = Settings.Secure.getInt(
                    getContentResolver(),
                    Settings.Secure.ACCESSIBILITY_ENABLED
            );
            if (enabled != 1) {
                Log.d(TAG, "Accessibility is not enabled globally");
                return false;
            }

            String enabledServices = Settings.Secure.getString(
                    getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            if (enabledServices == null) {
                Log.d(TAG, "No accessibility services enabled");
                return false;
            }

            String target = new ComponentName(this, OmniClickAccessibilityService.class)
                    .flattenToString();
            Log.d(TAG, "Target service: " + target);
            Log.d(TAG, "Enabled services: " + enabledServices);

            for (String s : enabledServices.split(":")) {
                if (s.equalsIgnoreCase(target)) {
                    Log.d(TAG, "Found our service in enabled list");
                    return true;
                }
            }
            Log.d(TAG, "Our service not found in enabled list");
        } catch (Settings.SettingNotFoundException e) {
            Log.e(TAG, "Settings not found", e);
            return false;
        }
        return false;
    }
}
