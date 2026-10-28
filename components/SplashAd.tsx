import adResetConfig from '../ad-reset-config.json';
import React, { useState, useEffect, useRef } from 'react';
import { showStartupAppOpenAd } from '../src/lib/startup-ad';

interface SplashAdProps {
  onFinish: () => void;
  appName?: string;
}

export const SplashAd: React.FC<SplashAdProps> = ({ onFinish, appName = "OmniClick Designer" }) => {
  if (typeof window !== 'undefined' && adResetConfig.token && localStorage.getItem('yesolve_ad_bypass_reset_token') !== adResetConfig.token) {
    localStorage.setItem('yesolve_ad_bypass', 'false');
    localStorage.setItem('yesolve_ad_bypass_reset_token', adResetConfig.token);
  }
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';

  const [countdown, setCountdown] = useState(5);
  const clickTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    if (isBypassed) {
      onFinish();
      return;
    }

    showStartupAppOpenAd();

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

  const handleBackdoorClick = () => {
    const now = Date.now();
    clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t <= 3000);
    clickTimestampsRef.current.push(now);

    if (clickTimestampsRef.current.length >= 5) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yesolve_ad_bypass', 'true');
      }
      onFinish();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[999999] pointer-events-auto bg-[#090D16] text-slate-200 flex flex-col justify-between p-6 select-none font-sans"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top HUD Status Bar */}
      <div className="flex items-center justify-between w-full max-w-md mx-auto">
        <div 
          onClick={handleBackdoorClick}
          className="flex items-center space-x-2.5 cursor-default select-none active:opacity-90"
        >
          <div className="w-7 h-7 rounded border border-cyan-500/30 bg-[#101726] flex items-center justify-center text-cyan-400">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="8" />
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-100 font-mono tracking-tight">{appName}</div>
            <div className="text-[10px] text-slate-500 font-mono">ENGINE_IDLE · READY</div>
          </div>
        </div>

        <div className="px-2.5 py-1 rounded bg-[#101726] border border-slate-800 text-[11px] font-mono text-slate-400">
          {countdown > 0 ? `T-0${countdown}s` : 'EXEC_READY'}
        </div>
      </div>

      {/* Center: Script Execution & Coordinate Grid HUD */}
      <div 
        onClick={handleBackdoorClick}
        className="w-full max-w-md mx-auto my-auto bg-[#0F1626] border border-slate-800 rounded-lg p-5 cursor-default"
      >
        {/* HUD Subhead */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3.5 text-xs font-mono">
          <div className="flex items-center space-x-2 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
            <span>SEQUENCE_STEP_PREVIEW</span>
          </div>
          <span className="text-[10px] text-slate-500">SPONSORED</span>
        </div>

        {/* AdSense Placement */}
        <div className="w-full bg-[#090D16] rounded border border-slate-800/80 p-2 mb-3.5 overflow-hidden">
          <ins
            className="adsbygoogle"
            style={{ display: 'block', width: '100%', height: '120px' }}
            data-ad-client="ca-pub-2415998114933157"
            data-ad-slot="(待補)"
            data-ad-format="auto"
            data-full-width-responsive="true"
          ></ins>
        </div>

        {/* Microsecond Macro Steps Monitor */}
        <div className="space-y-2 font-mono text-[11px]">
          <div className="flex items-center justify-between p-2 rounded bg-[#090D16] border border-slate-800/60">
            <span className="text-slate-400">STEP 01</span>
            <span className="text-cyan-400">TAP (X: 540, Y: 960)</span>
            <span className="text-slate-500">±0px</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-[#090D16] border border-slate-800/60">
            <span className="text-slate-400">DELAY</span>
            <span className="text-amber-400">120ms</span>
            <span className="text-slate-500">PRECISION 0.001s</span>
          </div>
        </div>

        <div className="mt-3.5 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <span>COORDINATE AUTOMATION</span>
          <span>AD · 5677764204</span>
        </div>
      </div>

      {/* Bottom Minimal Signature */}
      <div className="w-full max-w-md mx-auto text-center">
        <span className="text-[11px] font-mono text-slate-600">yesolve studio</span>
      </div>
    </div>
  );
};
