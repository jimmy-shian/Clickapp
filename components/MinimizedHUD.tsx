import React from 'react';
import { Maximize2, Square } from 'lucide-react';
import { getCollapsedSize } from '../utils/geometry';
import { AppMode } from '../types';
import { useTranslation } from '../utils/i18n';

export type MinimizedStatus = 'playing' | 'recording' | 'idle';

interface MinimizedHUDProps {
  status: MinimizedStatus;
  position: { x: number; y: number };
  /** 播放 pill 主標題（循環次數 / 步驟進度） */
  title?: string;
  /** 播放 pill 副標題（下一步倒數） */
  sub?: string;
  /** 播放進度 0~1 */
  progress?: number;
  /** 錄影經過秒數 */
  elapsedSec?: number;
  /** 拖曳旗標（區分拖曳與點擊） */
  draggedRef: { current: boolean };
  /** 畫布拖曳點位中，半透明透視底層遊戲 */
  isDraggingPoint?: boolean;
  onExpand: () => void;
  /** 停止播放/錄影（不展開） */
  onStopActive: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
}

/** 縮小 HUD（省電：無動畫、無模糊；播放時顯示已執行次數 + 進度）
 * 實際尺寸必須與 utils/geometry.getCollapsedSize 一致。
 */
export const MinimizedHUD: React.FC<MinimizedHUDProps> = ({
  status,
  position,
  title = '',
  sub = '',
  progress = 0,
  elapsedSec = 0,
  draggedRef,
  isDraggingPoint = false,
  onExpand,
  onStopActive,
  onMouseDown,
  onTouchStart,
}) => {
  const { t } = useTranslation();
  const modeForSize = status === 'playing' ? AppMode.PLAYING : status === 'recording' ? AppMode.RECORDING : AppMode.IDLE;
  const { width, height } = getCollapsedSize(modeForSize);
  const boxStyle: React.CSSProperties = {
    left: position.x,
    top: position.y,
    width: `${width}px`,
    height: `${height}px`,
  };

  const dragOpacityClass = isDraggingPoint ? 'opacity-20 pointer-events-none' : 'opacity-100';

  if (status === 'playing') {
    return (
      <div
        className={`fixed z-50 rounded-[27px] flex items-center gap-2 pointer-events-auto bg-gray-800 overflow-hidden transition-opacity duration-150 ${dragOpacityClass}`}
        style={{ ...boxStyle, border: '1px solid rgba(255,255,255,0.18)' }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!draggedRef.current) onStopActive();
          }}
          className="ml-2 w-9 h-9 rounded-full flex items-center justify-center bg-amber-500 text-white shrink-0"
          title={t('minimizedStopTitle')}
        >
          <Square size={16} fill="white" className="text-white" />
        </button>
        <div
          className="flex-1 min-w-0 pr-3.5 py-1 cursor-pointer flex flex-col justify-center"
          onClick={() => {
            if (!draggedRef.current) {
              onExpand();
              onStopActive(); // 展開即停止，與舊行為一致
            }
          }}
        >
          <div className="text-[11px] font-bold text-white leading-tight truncate">{title}</div>
          <div className="my-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-amber-400" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          {/* 單行裁切：副標題再長也不換行撐出 pill */}
          <div className="text-[10px] text-gray-300 font-mono leading-tight truncate whitespace-nowrap">{sub}</div>
        </div>
      </div>
    );
  }

  if (status === 'recording') {
    return (
      <div
        className={`fixed z-50 rounded-full flex items-center justify-center cursor-pointer pointer-events-auto bg-red-600 transition-opacity duration-150 ${dragOpacityClass}`}
        style={boxStyle}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onClick={() => {
          if (!draggedRef.current) {
            onExpand();
            onStopActive();
          }
        }}
      >
        <Square size={16} fill="white" className="text-white" />
        <span className="ml-1 text-[11px] font-mono text-white">{elapsedSec}s</span>
      </div>
    );
  }

  return (
    <div
      className={`fixed z-50 rounded-full flex items-center justify-center cursor-pointer pointer-events-auto bg-gray-800 transition-opacity duration-150 ${dragOpacityClass}`}
      style={{ ...boxStyle, border: '1px solid rgba(255,255,255,0.15)' }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onClick={() => {
        if (!draggedRef.current) onExpand();
      }}
    >
      <Maximize2 size={20} className="text-white" />
    </div>
  );
};
