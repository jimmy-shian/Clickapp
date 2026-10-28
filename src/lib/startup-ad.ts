import { Capacitor, registerPlugin } from '@capacitor/core';
import adConfig from '../../admob-config.json';

interface StartupAdPlugin {
  showAppOpen(options: { adUnitId: string }): Promise<{ shown: boolean }>;
}

const StartupAd = registerPlugin<StartupAdPlugin>('StartupAd');

export function showStartupAppOpenAd(): void {
  const adUnitId = adConfig.units.splash;
  if (!Capacitor.isNativePlatform() || !adUnitId?.startsWith('ca-app-pub-')) return;
  void StartupAd.showAppOpen({ adUnitId }).catch((error) => {
    console.warn('[AdMob] App open ad was skipped:', error);
  });
}
