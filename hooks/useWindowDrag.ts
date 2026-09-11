import { useEffect, useRef } from 'react';

export type WindowDragEvent = MouseEvent | TouchEvent;

/** active 時接管全域 mouse/touch 移動與放開事件；關閉時自動移除監聽。
 * 取代 FloatingHUD / StepEditor 各自重複的 window.addEventListener 樣板。
 */
export function useWindowDrag(
  active: boolean,
  onMove: (e: WindowDragEvent) => void,
  onEnd: () => void
): void {
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    if (!active) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) e.preventDefault();
      moveRef.current(e);
    };
    const handleEnd = () => endRef.current();

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [active]);
}

/** 從拖曳事件取出 client 座標（mouse / touch 共用） */
export function getDragClientXY(e: WindowDragEvent): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = e.touches[0] ?? e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY };
  }
  return { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
}
