import { AppMode } from '../types';

/** HUD 縮小後三種狀態的實際尺寸（需與 MinimizedHUD render 一致，否則觸控層對不準） */
export const COLLAPSED_SIZE = {
  playing: { width: 264, height: 54 },
  recording: { width: 64, height: 48 },
  idleWithSteps: { width: 96, height: 48 },
  idle: { width: 48, height: 48 },
} as const;

export function getCollapsedSize(mode: AppMode, hasSteps: boolean = true): { width: number; height: number } {
  if (mode === AppMode.PLAYING) return { ...COLLAPSED_SIZE.playing };
  if (mode === AppMode.RECORDING) return { ...COLLAPSED_SIZE.recording };
  if (hasSteps) return { ...COLLAPSED_SIZE.idleWithSteps };
  return { ...COLLAPSED_SIZE.idle };
}

/** 將座標限制在視窗內 */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(0, window.innerWidth - width);
  const maxY = Math.max(0, window.innerHeight - height);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

export interface HudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 縮小時觸控層外擴的 padding，避免座標誤差導致小圓點點不到 */
export const TOUCH_PADDING = 16;

/** 展開時觸控層底部外加高度，確保底部按鈕在 overlay 範圍內 */
export const EXPANDED_EXTRA_BOTTOM = 24;

/** 對矩形外擴 padding（回傳新物件，不修改傳入值） */
export function withTouchPadding(rect: HudRect, padding: number = TOUCH_PADDING): HudRect {
  return {
    x: Math.max(0, rect.x - padding),
    y: Math.max(0, rect.y - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

/** 取兩矩形的外包矩形（鍵盤開啟時，觸控層改為 HUD＋編輯器聯集，讓鍵盤區穿透給 IME）。
 * 任一邊無效（寬高<=0）時回傳另一邊。
 */
export function unionRects(a: HudRect, b: HudRect | null | undefined): HudRect {
  if (!b || b.width <= 0 || b.height <= 0) return { ...a };
  if (a.width <= 0 || a.height <= 0) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}
