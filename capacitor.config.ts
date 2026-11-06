import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yesolve.click',
  appName: 'omniclick-designer',
  webDir: 'dist',
  server: {
    // ★ App 畫面與 OmniClickAccessibilityService 的 overlay WebView 使用相同 origin
    //   （https://appassets.androidplatform.net），localStorage 互通：
    //   在 App 畫面新增/匯入的腳本，懸浮 HUD 立即看得到。
    hostname: 'appassets.androidplatform.net',
  },
};

export default config;
