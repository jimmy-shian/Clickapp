import adResetConfig from '../ad-reset-config.json';
import React, { useState, useEffect, useRef } from 'react';
import { showNativeAdInSlot, hideNativeAdInSlot } from '../src/lib/startup-ad';
import { AdSenseSlot } from './AdSenseSlot';
import { ChevronsUp } from 'lucide-react';

interface SplashAdProps {
  onFinish: () => void;
  appName?: string;
}

/** 統一倒數長度（秒） */
const AD_DURATION = 5;
/** 後門略過：5 秒內累計 5 次點擊 */
const BACKDOOR_WINDOW = 5000;
const BACKDOOR_CLICKS = 5;

/**
 * 開場廣告：長成 OmniClick 自己的畫面。
 * 上半是 ClickCanvas 的座標網格 + 十字瞄準器，下半是 FloatingHUD 的底部面板，
 * 步驟列沿用 StepEditor 的輸入框樣式。主色 blue（對齊 StepEditor / FloatingHUD）。
 */
export const SplashAd: React.FC<SplashAdProps> = ({ onFinish, appName = 'OmniClick Designer' }) => {
  if (typeof window !== 'undefined' && adResetConfig.token && localStorage.getItem('yesolve_ad_bypass_reset_token') !== adResetConfig.token) {
    localStorage.setItem('yesolve_ad_bypass', 'false');
    localStorage.setItem('yesolve_ad_bypass_reset_token', adResetConfig.token);
  }
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';

  const [countdown, setCountdown] = useState(AD_DURATION);
  const clickTimestampsRef = useRef<number[]>([]);
  /** 廣告槽：原生平台上由 StartupAdPlugin 在這個位置放真正的 AdMob 原生進階廣告 */
  const adSlotRef = useRef<HTMLDivElement | null>(null);

  // 原生平台：廣告槽位置由 StartupAdPlugin 放真正的 AdMob 原生進階廣告。
  // 只在略過狀態變更時掛載／卸載，不隨父層重繪重新請求廣告。
  useEffect(() => {
    if (isBypassed) return;
    showNativeAdInSlot(adSlotRef.current);
    return () => hideNativeAdInSlot();
  }, [isBypassed]);

  useEffect(() => {
    if (isBypassed) {
      onFinish();
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onFinish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onFinish, isBypassed]);

  if (isBypassed) return null;

  // 後門略過：5 秒內累計 5 次點擊（HUD 標頭 / 畫布瞄準器）
  const handleBackdoorClick = () => {
    const now = Date.now();
    clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t <= BACKDOOR_WINDOW);
    clickTimestampsRef.current.push(now);

    if (clickTimestampsRef.current.length >= BACKDOOR_CLICKS) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yesolve_ad_bypass', 'true');
      }
      onFinish();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[999999] pointer-events-auto flex flex-col bg-[#0B1220] text-slate-200 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 上半：ClickCanvas 的座標網格 + 十字瞄準器 */}
      <div
        onClick={handleBackdoorClick}
        className="relative flex-1 min-h-0 cursor-default"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(96,165,250,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(96,165,250,0.09) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        {/* 座標刻度 */}
        <div className="absolute left-2 top-2 font-mono text-[10px] text-blue-400/50">X 0</div>
        <div className="absolute left-2 bottom-2 font-mono text-[10px] text-blue-400/50">Y max</div>
        <div className="absolute right-2 top-2 font-mono text-[10px] text-blue-400/50">GRID 28px</div>

        {/* 十字瞄準器（= ClickCanvas 的選取標記） */}
        <div className="absolute inset-0 flex items-center justify-center">
          <svg viewBox="0 0 120 120" className="h-32 w-32 text-blue-400" aria-hidden="true">
            <circle cx="60" cy="60" r="34" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
            <circle cx="60" cy="60" r="14" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="60" cy="60" r="3.5" fill="currentColor" />
            <line x1="60" y1="6" x2="60" y2="40" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="60" y1="80" x2="60" y2="114" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="6" y1="60" x2="40" y2="60" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="80" y1="60" x2="114" y2="60" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* 下半：FloatingHUD 底部面板 */}
      <div className="shrink-0 rounded-t-xl border-t border-blue-500/30 bg-[#1e293b]/95 backdrop-blur-sm overflow-hidden shadow-[0_-8px_30px_rgba(0,0,0,0.45)]">
        {/* HUD 標頭 + 倒數 */}
        <div
          onClick={handleBackdoorClick}
          className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-slate-700/70 cursor-default"
        >
          <div className="flex items-center gap-2">
            <span className="bg-blue-500/10 rounded px-1 py-0.5"><ChevronsUp size={10} className="text-blue-400/80 block" /></span>
            <span className="text-xs font-semibold text-slate-200">{appName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">SPONSORED</span>
            <span className="bg-black/30 border border-gray-600 rounded px-2 py-0.5 text-xs font-mono text-blue-400">
              T-0{countdown}s
            </span>
          </div>
        </div>

        {/* HUD 倒數進度（= PlaybackTimeline 的藍色進度條） */}
        <div className="h-1 bg-slate-800">
          <div
            className="h-full bg-blue-500 transition-[width] duration-500 ease-linear"
            style={{ width: `${(countdown / AD_DURATION) * 100}%` }}
          />
        </div>

        {/* 廣告槽 */}
        <div className="bg-[#0B1220] px-3 py-3" ref={adSlotRef}>
          <AdSenseSlot slotKey="splash" />
        </div>

        {/* 步驟列（= StepEditor 的欄位樣式） */}
        <div className="px-3 pb-3 space-y-1.5">
          <div className="flex items-center gap-2 rounded bg-black/30 border border-gray-600 px-2 py-1 font-mono text-xs">
            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">STEP 01</span>
            <span className="text-slate-300">TAP</span>
            <span className="ml-auto text-slate-500">±0px</span>
          </div>
          <div className="flex items-center gap-2 rounded bg-black/30 border border-gray-600 px-2 py-1 font-mono text-xs">
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">DELAY</span>
            <span className="text-slate-300">5000ms</span>
            <span className="ml-auto text-slate-500">PRECISION 0.001s</span>
          </div>
        </div>

        <div className="px-3 pb-2.5 text-center font-mono text-[11px] tracking-[0.18em] text-slate-600">
          yesolve studio
        </div>
      </div>
    </div>
  );
};
