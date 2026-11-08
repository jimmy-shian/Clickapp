import adResetConfig from '../ad-reset-config.json';
import React, { useState, useEffect, useRef } from 'react';
import { showNativeAdInSlot, hideNativeAdInSlot, updateNativeAdInSlot } from '../src/lib/startup-ad';
import { useSafeAreaInsets } from '../src/lib/safe-area';
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
 *
 * 版面規則：
 * - 上下（左右）系統狀態列／導覽列一律避讓：內容排進 safe-area 之內，
 *   不會被系統列壓到或蓋住。
 * - 版面元素一律單行呈現（whitespace-nowrap + truncate），
 *   避免窄螢幕時文字換行、撐破原本的 HUD 版型。
 * - 廣告槽為固定高度，原生 AdMob 卡片依同一高度排版，兩者疊在一起仍是同一版面。
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
  /** 系統列安全區（上／下／左／右），避免內容被狀態列與導覽列壓到 */
  const { insets, ready: safeAreaReady } = useSafeAreaInsets();

  // 原生平台：廣告槽位置由 StartupAdPlugin 放真正的 AdMob 原生進階廣告。
  // 只在略過狀態變更時掛載／卸載，不隨父層重繪重新請求廣告。
  // 需等 safe-area 量測完成再量槽位，否則 inset 晚到會讓槽位座標與畫面對不準。
  useEffect(() => {
    if (isBypassed || !safeAreaReady) return;
    showNativeAdInSlot(adSlotRef.current);
    return () => hideNativeAdInSlot();
  }, [isBypassed, safeAreaReady]);

  // 版面位移（旋轉、系統列變化）時只重新定位既有原生廣告卡片，不重新載入廣告
  useEffect(() => {
    if (isBypassed || !safeAreaReady) return;
    updateNativeAdInSlot(adSlotRef.current);
  }, [isBypassed, safeAreaReady, insets.top, insets.bottom, insets.left, insets.right]);

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
      className="fixed inset-0 z-[999999] pointer-events-auto flex flex-col bg-[#0B1220] text-slate-200 select-none overflow-hidden"
      style={{
        // 系統列避讓：狀態列（上）與導覽列／手勢列（下）區域留白，內容不被壓住
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 上半：ClickCanvas 的座標網格 + 十字瞄準器 */}
      <div
        onClick={handleBackdoorClick}
        className="relative flex-1 min-h-0 cursor-default overflow-hidden"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(96,165,250,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(96,165,250,0.09) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        {/* 座標刻度 */}
        <div className="absolute left-2 top-2 font-mono text-[10px] leading-none text-blue-400/50 whitespace-nowrap">X 0</div>
        <div className="absolute left-2 bottom-2 font-mono text-[10px] leading-none text-blue-400/50 whitespace-nowrap">Y max</div>
        <div className="absolute right-2 top-2 font-mono text-[10px] leading-none text-blue-400/50 whitespace-nowrap">GRID 28px</div>

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
        {/* HUD 標頭 + 倒數（單行不換行；名稱過長時以省略號收尾） */}
        <div
          onClick={handleBackdoorClick}
          className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-slate-700/70 cursor-default"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="shrink-0 bg-blue-500/10 rounded px-1 py-0.5">
              <ChevronsUp size={10} className="text-blue-400/80 block" />
            </span>
            <span className="text-xs font-semibold text-slate-200 truncate whitespace-nowrap">{appName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] leading-none text-slate-500 font-mono uppercase tracking-wider whitespace-nowrap">SPONSORED</span>
            <span className="shrink-0 bg-black/30 border border-gray-600 rounded px-2 py-0.5 text-xs font-mono text-blue-400 whitespace-nowrap tabular-nums">
              T-0{countdown}s
            </span>
          </div>
        </div>

        {/* HUD 倒數進度（= PlaybackTimeline 的藍色進度條） */}
        <div className="h-1 bg-slate-800 shrink-0">
          <div
            className="h-full bg-blue-500 transition-[width] duration-500 ease-linear"
            style={{ width: `${(countdown / AD_DURATION) * 100}%` }}
          />
        </div>

        {/* 廣告槽：固定高度，讓原生 AdMob 卡片與設計版位完全對齊 */}
        <div className="bg-[#0B1220] px-3 py-2 shrink-0">
          <div
            ref={adSlotRef}
            className="relative w-full h-[clamp(150px,26vh,220px)] overflow-hidden rounded-lg"
          >
            <div className="h-full w-full flex items-stretch justify-center">
              <AdSenseSlot slotKey="splash" />
            </div>
          </div>
        </div>

        {/* 步驟列（= StepEditor 的欄位樣式；單行不換行） */}
        <div className="px-3 pb-3 pt-1 space-y-1.5 shrink-0">
          <div className="flex items-center gap-2 rounded bg-black/30 border border-gray-600 px-2 py-1 font-mono text-xs whitespace-nowrap overflow-hidden">
            <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">STEP 01</span>
            <span className="shrink-0 text-slate-300">TAP</span>
            <span className="ml-auto min-w-0 truncate text-slate-500">±0px</span>
          </div>
          <div className="flex items-center gap-2 rounded bg-black/30 border border-gray-600 px-2 py-1 font-mono text-xs whitespace-nowrap overflow-hidden">
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">DELAY</span>
            <span className="shrink-0 text-slate-300">5000ms</span>
            <span className="ml-auto min-w-0 truncate text-slate-500">PRECISION 0.001s</span>
          </div>
        </div>

        <div className="px-3 pb-2.5 text-center font-mono text-[11px] leading-none tracking-[0.18em] text-slate-600 whitespace-nowrap shrink-0">
          yesolve studio
        </div>
      </div>
    </div>
  );
};
