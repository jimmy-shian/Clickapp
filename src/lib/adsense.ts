import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import adsenseConfig from '../../adsense-config.json';

export type AdSlotKey = 'splash' | 'banner' | 'floating' | 'prerecording';

type AdsenseConfig = { client?: string; slots?: Partial<Record<AdSlotKey, string>> };

const config = adsenseConfig as AdsenseConfig;

declare global {
  interface Window {
    /** AdSense 載入後由 adsbygoogle.js 注入的 push 佇列入口。 */
    adsbygoogle?: { push: (opts?: Record<string, unknown>) => void };
  }
}

/**
 * 原生平台一律走 AdMob 原生 SDK（原生進階 Native Advanced）。
 * WebView 內的 AdSense 顯示廣告既不會 fill，也違反 AdSense 對嵌入環境的要求，
 * 因此原生平台一律不渲染 <ins>。
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getAdSlot(key: AdSlotKey): string {
  return (config.slots?.[key] ?? '').trim();
}

/**
 * 只有在「非原生平台 + 已填 publisher client + 已填 slot id」三者皆成立時才渲染 <ins>。
 * 任一條件不成立時改顯示品牌佔位板，避免出現永遠空白的廣告框。
 */
export function canRenderAdSense(key: AdSlotKey): boolean {
  if (isNativeApp()) return false;
  const client = (config.client ?? '').trim();
  return client.length > 0 && getAdSlot(key).length > 0;
}

let scriptPromise: Promise<void> | null = null;

/** 單例注入 AdSense script；重複呼叫只會載入一次。 */
export function loadAdSenseScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('AdSense requires a browser environment'));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-adsense-loader]');
    if (existing) {
      if (window.adsbygoogle) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('AdSense script failed to load')));
      return;
    }
    const client = (config.client ?? '').trim();
    if (!client) {
      reject(new Error('adsense-config.json is missing client'));
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.adsenseLoader = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('AdSense script failed to load'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** AdSense script 就緒後呼叫一次，讓 <ins> 進入填充佇列。 */
export function requestAdFill(): void {
  try {
    if (!window.adsbygoogle) return;
    window.adsbygoogle.push({});
  } catch (error) {
    console.warn('[AdSense] push failed:', error);
  }
}

/** 廣告槽載入狀態。 */
export type AdSlotStatus =
  /** 原生平台，或 publisher client / slot id 未設定 → 不渲染 <ins>。 */
  | 'none'
  /** AdSense script 載入中 → 暫時顯示品牌佔位板。 */
  | 'loading'
  /** AdSense script 已就緒並完成 push() → 可渲染 <ins>。 */
  | 'ready'
  /** AdSense script 載入失敗或逾時 → 顯示品牌佔位板。 */
  | 'error';

export interface AdSlotState {
  status: AdSlotStatus;
  client: string;
  slot: string;
  /** 是否可渲染 <ins>；false 時呼叫端必須改渲染品牌佔位板。 */
  renderable: boolean;
}

/** AdSense script 載入逾時（毫秒）→ 逾時後改顯示品牌佔位板。 */
const ADSENSE_LOAD_TIMEOUT = 8000;

/**
 * 掛載 AdSense script 並回傳目前廣告槽狀態。
 *
 * 嚴格對應規格：只有在「非原生平台 + client 已設定 + slot id 已設定 + AdSense script 載入完成」
 * 四者皆成立時 renderable 才為 true，其餘一律改顯示品牌佔位板，
 * 避免出現永遠空白的死 <ins> 框。
 */
export function useAdSenseSlot(key: AdSlotKey): AdSlotState {
  const supported = canRenderAdSense(key);
  const [status, setStatus] = useState<AdSlotStatus>(supported ? 'loading' : 'none');

  useEffect(() => {
    if (!supported) {
      setStatus('none');
      return;
    }
    let cancelled = false;
    setStatus('loading');

    const timeout = setTimeout(() => {
      if (!cancelled) setStatus('error');
    }, ADSENSE_LOAD_TIMEOUT);

    loadAdSenseScript()
      .then(() => {
        if (cancelled) return;
        clearTimeout(timeout);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        console.warn('[AdSense] script load failed:', error);
        if (cancelled) return;
        clearTimeout(timeout);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [supported, key]);

  return {
    status,
    client: supported ? (config.client ?? '').trim() : '',
    slot: supported ? getAdSlot(key) : '',
    renderable: status === 'ready',
  };
}
