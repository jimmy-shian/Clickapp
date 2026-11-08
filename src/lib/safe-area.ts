import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * 安全區（safe area）inset：上方系統狀態列、下方系統導覽列／手勢列的避讓距離（CSS px）。
 *
 * 為什麼不能只靠 CSS env(safe-area-inset-*)：
 * - Android WebView（targetSdk 35）預設為 edge-to-edge，內容會延伸到系統列底下，
 *   但 Chromium 的 env(safe-area-inset-*) 只回報「瀏海海」缺口，不含狀態列／導覽列高度，
 *   因此 Android 必須由原生端依 WindowInsets 實測 WebView 被系統列蓋住的高度。
 * - iOS Safari／支援的瀏覽器則以 CSS env() 為準。
 * 兩者取較大值，確保任何平台都不會被系統列壓到。
 */
interface SafeAreaNativePlugin {
  getInsets(): Promise<{ top?: number; bottom?: number; left?: number; right?: number }>;
}

const SafeAreaNative = registerPlugin<SafeAreaNativePlugin>('SafeArea');

export interface SafeAreaInsets {
  /** 上方狀態列（瀏海海）避讓距離 */
  top: number;
  /** 下方導覽列／手勢列避讓距離 */
  bottom: number;
  /** 左側避讓距離（橫向時的系統列） */
  left: number;
  /** 右側避讓距離（橫向時的系統列） */
  right: number;
}

export interface SafeAreaState {
  insets: SafeAreaInsets;
  /** 是否已完成第一次量測（原生 plugin／CSS 皆已回覆）；版面據此定位後才量廣告槽 */
  ready: boolean;
}

const ZERO_INSETS: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** 以隱藏探測元素讀取 CSS env(safe-area-inset-*) 的實際數值（iOS Safari／桌面瀏覽器） */
export function readCssSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined' || typeof window === 'undefined') return ZERO_INSETS;
  try {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:0',
      'height:0',
      'visibility:hidden',
      'pointer-events:none',
      'padding-top:env(safe-area-inset-top, 0px)',
      'padding-bottom:env(safe-area-inset-bottom, 0px)',
      'padding-left:env(safe-area-inset-left, 0px)',
      'padding-right:env(safe-area-inset-right, 0px)',
    ].join(';');
    document.body.appendChild(probe);
    const style = window.getComputedStyle(probe);
    const insets: SafeAreaInsets = {
      top: parseFloat(style.paddingTop) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
      right: parseFloat(style.paddingRight) || 0,
    };
    probe.remove();
    return insets;
  } catch {
    return ZERO_INSETS;
  }
}

/** 取得安全區 inset：原生以 WindowInsets 為準，網頁以 CSS env() 為準，兩者取較大值 */
export async function getSafeAreaInsets(): Promise<SafeAreaInsets> {
  const css = readCssSafeAreaInsets();
  try {
    if (Capacitor.isNativePlatform()) {
      const native = await SafeAreaNative.getInsets();
      return {
        top: Math.max(css.top, native?.top ?? 0),
        bottom: Math.max(css.bottom, native?.bottom ?? 0),
        left: Math.max(css.left, native?.left ?? 0),
        right: Math.max(css.right, native?.right ?? 0),
      };
    }
  } catch {
    /* 原生 plugin 未註冊或查詢失敗 → 退回 CSS env() 的值 */
  }
  return css;
}

/**
 * React hook：取得安全區 inset。
 *
 * 回傳的 ready 旗標代表「版面 inset 已定案」，需要先知道安全區再量座標的元件
 * （例如開場廣告要量原生廣告槽位置）應等 ready 為 true 後才量測，
 * 否則 inset 晚到會造成版面位移、廣告槽座標對不上的問題。
 */
export function useSafeAreaInsets(): SafeAreaState {
  const [state, setState] = useState<SafeAreaState>(() => ({
    insets: readCssSafeAreaInsets(),
    ready: false,
  }));

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const insets = await getSafeAreaInsets();
      if (cancelled) return;
      setState((prev) => {
        const same =
          prev.insets.top === insets.top &&
          prev.insets.bottom === insets.bottom &&
          prev.insets.left === insets.left &&
          prev.insets.right === insets.right;
        if (same && prev.ready) return prev;
        return { insets, ready: true };
      });
    };

    void refresh();

    const onViewportChange = () => {
      void refresh();
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    window.visualViewport?.addEventListener('resize', onViewportChange);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
    };
  }, []);

  return state;
}
