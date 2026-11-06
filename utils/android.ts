/** 與原生層（OmniClickAccessibilityService.JsBridge）對接的型別與安全呼叫封裝。
 * 集中管理所有 window.Android 存取，避免各元件重複寫 try/catch 與可選串連。
 */

export interface AndroidBridge {
  performClick: (x: number, y: number) => void;
  performSwipe?: (x1: number, y1: number, x2: number, y2: number, durationMs: number) => void;
  close?: () => void;
  /** 辨識橋接所處的 WebView：「overlay」＝懸浮 HUD（服務層）／「host」＝App 畫面（Capacitor） */
  getContext?: () => string;
  /** 無障礙服務是否已啟用（host 橋接提供同步查詢） */
  isAccessibilityEnabled?: () => boolean;
  /** 開啟系統「無障礙設定」頁 */
  openAccessibilitySettings?: () => void;
  /** App 畫面切換到懸浮模式；回傳 false 代表服務未啟用（需先引導使用者去設定） */
  enterOverlayMode?: () => boolean;
  /** 結束 App 畫面（host 橋接提供；overlay 用 close()） */
  exitApp?: () => void;
  updateOverlayRect?: (x: number, y: number, width: number, height: number) => void;
  tap?: (x: number, y: number) => void;
  swipe?: (x1: number, y1: number, x2: number, y2: number, durationMs: number) => void;
  reportPos?: (x: number, y: number, width: number, height: number) => void;
  openFilePicker?: (slot: string) => void;
  saveFile?: (name: string, content: string) => void;
  requestInputFocus?: () => void;
  clearInputFocus?: () => void;
  setRecordingMode?: (recording: boolean) => void;
  setHudRect?: (x: number, y: number, width: number, height: number) => void;
  dispatchRecordedGesture?: (canvasX: number, canvasY: number) => void;
  dispatchRecordedSwipe?: (x1: number, y1: number, x2: number, y2: number, durationMs: number) => void;
}

declare global {
  interface Window {
    Android?: AndroidBridge;
    __omniclickOnFilePicked?: (slot: string, fileName: string, content: string) => void;
  }
}

/** 取得原生橋接物件（非 overlay 環境回傳 undefined） */
export function getAndroidBridge(): AndroidBridge | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    return window.Android;
  } catch {
    return undefined;
  }
}

/** 橋接所處的 WebView 語境：'overlay'（懸浮 HUD）/ 'host'（App 畫面）/ null（瀏覽器預覽） */
export type BridgeContext = 'overlay' | 'host' | null;

let cachedContext: BridgeContext | undefined;

/** 辨識目前橋接所在語境（首次同步呼叫原生 tag，之後取快取） */
export function getHostContext(): BridgeContext {
  if (cachedContext === undefined) {
    try {
      const ctx = getAndroidBridge()?.getContext?.();
      if (ctx === 'overlay' || ctx === 'host') {
        cachedContext = ctx;
      } else {
        // 有 window.Android 但沒有語境 tag → 舊版橋接＝overlay
        cachedContext = getAndroidBridge() ? 'overlay' : null;
      }
    } catch {
      cachedContext = null;
    }
  }
  return cachedContext;
}

/** 是否跑在 Accessibility Service 的 overlay WebView（懸浮 HUD）內 */
export function isAndroidOverlay(): boolean {
  return getHostContext() === 'overlay';
}

/** 是否跑在 App 畫面的 Capacitor WebView 內（懸浮模式另以按鈕切換） */
export function isHostApp(): boolean {
  return getHostContext() === 'host';
}

function safeCall(fn: (b: AndroidBridge) => void): void {
  try {
    const b = getAndroidBridge();
    if (b) fn(b);
  } catch {
    /* noop：原生層不可用時靜默略過 */
  }
}

/** 輸入框取得焦點：只讓視窗可取焦以彈鍵盤，保持 NOT_TOUCHABLE 使選字列穿透（見原生註解） */
export function requestInputFocus(): void {
  safeCall((b) => b.requestInputFocus?.());
}

/** 鍵盤開關中央狀態：任一輸入框聚焦即為開（由 utils/input 的 focus/blur 維護）。
 * App 訂閱此狀態：鍵盤開著時把原生觸控層從全螢幕縮為 HUD＋編輯器聯集，
 * 讓鍵盤區觸控直接穿透給 IME，避免按鍵被轉發進 WebView 造成 blur 關鍵盤。
 */
let keyboardOpen = false;
const keyboardListeners = new Set<(open: boolean) => void>();

export function isKeyboardOpen(): boolean {
  return keyboardOpen;
}

export function setKeyboardOpen(open: boolean): void {
  if (keyboardOpen === open) return;
  keyboardOpen = open;
  keyboardListeners.forEach((cb) => {
    try {
      cb(open);
    } catch {
      /* 單一監聽器異常不影響其他 */
    }
  });
}

/** 訂閱鍵盤開關（回傳取消訂閱函式） */
export function subscribeKeyboardOpen(cb: (open: boolean) => void): () => void {
  keyboardListeners.add(cb);
  return () => {
    keyboardListeners.delete(cb);
  };
}

/** 輸入框失焦：排程恢復 overlay 旗標（原生端 debounce） */
export function clearInputFocus(): void {
  safeCall((b) => b.clearInputFocus?.());
}

/** 主動完成/收闔鍵盤：指定「完成」時呼叫，主動失焦輸入元素、通知原生釋放焦點並收起鍵盤 */
export function dismissKeyboard(): void {
  try {
    const el = document.activeElement as HTMLElement | null;
    if (el && typeof el.blur === 'function') {
      el.blur();
    }
  } catch {
    /* noop */
  }
  clearInputFocus();
  setKeyboardOpen(false);
}

/** 輸入框 blur 時呼叫：若焦點仍在任一輸入框（切換輸入中）則不關鍵盤，
 * 確認離開所有輸入框才釋放焦點。
 */
export function notifyInputBlur(): void {
  const release = () => {
    clearInputFocus();
    setKeyboardOpen(false);
  };
  try {
    window.setTimeout(() => {
      try {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
          return;
        }
      } catch {
        /* 查詢失敗則照常釋放 */
      }
      release();
    }, 100);
  } catch {
    release();
  }
}

/** 回報觸控 overlay 矩形（相容 updateOverlayRect / reportPos 兩種橋接） */
export function reportOverlayRect(x: number, y: number, width: number, height: number): void {
  safeCall((b) => {
    if (b.updateOverlayRect) b.updateOverlayRect(x, y, width, height);
    else if (b.reportPos) b.reportPos(x, y, width, height);
  });
}

/** 回報 HUD 矩形（螢幕 px），錄製時排除此區域不穿透 tap */
export function setHudRect(x: number, y: number, width: number, height: number): void {
  safeCall((b) => b.setHudRect?.(x, y, width, height));
}

/** 開啟原生檔案選擇器（slot：import / song / layout） */
export function openFilePicker(slot: string): void {
  safeCall((b) => b.openFilePicker?.(slot));
}

/** 觸發原生儲存流程；有橋接回傳 true，否則回傳 false 由呼叫方走瀏覽器下載 */
export function saveFileViaBridge(fileName: string, content: string): boolean {
  const b = getAndroidBridge();
  if (b && typeof b.saveFile === 'function') {
    try {
      b.saveFile(fileName, content);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** 錄製/播放模式切換通知 */
export function setRecordingMode(recording: boolean): void {
  safeCall((b) => b.setRecordingMode?.(recording));
}

/** 查詢無障礙服務是否已啟用（host 橋接提供；其他語境回傳 false） */
export function isAccessibilityServiceEnabled(): boolean {
  try {
    const b = getAndroidBridge();
    return typeof b?.isAccessibilityEnabled === 'function' ? b.isAccessibilityEnabled() : false;
  } catch {
    return false;
  }
}

/** 開啟系統「無障礙設定」頁（host 橋接提供；其他語境静默略過） */
export function openAndroidAccessibilitySettings(): void {
  safeCall((b) => b.openAccessibilitySettings?.());
}

/** App 畫面切換到懸浮模式。
 * 回傳 true：已移動到背景，懸浮 HUD 接管畫面；
 * 回傳 false：服務未啟用，呼叫方應先帶使用者到無障礙設定。
 */
export function enterOverlayMode(): boolean {
  try {
    const b = getAndroidBridge();
    return typeof b?.enterOverlayMode === 'function' ? b.enterOverlayMode() : false;
  } catch {
    return false;
  }
}

/** 結束 App 畫面（host 橋接提供；瀏覽器略過） */
export function exitHostApp(): void {
  safeCall((b) => b.exitApp?.());
}

/** 關閉 overlay（請系統停用服務） */
export function closeOverlay(): void {
  safeCall((b) => b.close?.());
}

/** 命名空間式 API（與上述函式相同，擇一使用） */
export const android = {
  requestInputFocus,
  clearInputFocus,
  dismissKeyboard,
  notifyInputBlur,
  isKeyboardOpen,
  setKeyboardOpen,
  subscribeKeyboardOpen,
  reportOverlayRect,
  setHudRect,
  openFilePicker,
  saveFile: saveFileViaBridge,
  setRecordingMode,
  close: closeOverlay,
  isHostApp,
  isAccessibilityEnabled: isAccessibilityServiceEnabled,
  openAccessibilitySettings: openAndroidAccessibilitySettings,
  enterOverlayMode,
  exitApp: exitHostApp,
};
