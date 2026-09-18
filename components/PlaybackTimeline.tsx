import React, { useRef, useEffect } from 'react';
import { AppMode, ClickStep } from '../types';
import { formatTime } from '../utils/format';
import { stepTypeLabel } from '../utils/timeline';
import type { PlaybackProgress } from '../hooks/usePlaybackProgress';
import { useTranslation } from '../utils/i18n';

interface TimelineDotsCanvasProps {
  steps: ClickStep[];
  cumulative: number[];
  totalScaled: number;
  safeSpeed: number;
  isPlaying: boolean;
  activePlaybackStepIndex: number | null | undefined;
  nextStepIdx: number;
  startIndex?: number;
  onJumpToStep?: (stepId: string) => void;
}

const TimelineDotsCanvas: React.FC<TimelineDotsCanvasProps> = React.memo(({
  steps,
  cumulative,
  totalScaled,
  safeSpeed,
  isPlaying,
  activePlaybackStepIndex,
  nextStepIdx,
  startIndex = 0,
  onJumpToStep,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use actual clientWidth for crisp rendering
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);

    if (totalScaled <= 0 || steps.length === 0) return;

    const centerY = height / 2;

    for (let i = 0; i < cumulative.length; i++) {
      const tMs = cumulative[i];
      const frac = Math.min(1, Math.max(0, tMs / safeSpeed / totalScaled));
      const x = frac * width;

      const isDone = isPlaying && activePlaybackStepIndex !== null && activePlaybackStepIndex !== undefined && i >= startIndex && i <= activePlaybackStepIndex;
      const isNext = isPlaying && i === nextStepIdx;
      const isSkipped = isPlaying && i < startIndex;

      ctx.beginPath();
      if (isNext) {
        ctx.arc(x, centerY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24'; // amber-400
      } else if (isDone) {
        ctx.arc(x, centerY, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#93c5fd'; // blue-300
      } else if (isSkipped) {
        ctx.arc(x, centerY, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#374151'; // gray-700（本輪已跳過）
      } else {
        ctx.arc(x, centerY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#6b7280'; // gray-500
      }
      ctx.fill();
    }
  }, [steps, cumulative, totalScaled, safeSpeed, isPlaying, activePlaybackStepIndex, nextStepIdx, startIndex]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onJumpToStep || steps.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const targetBase = frac * totalScaled * safeSpeed;
    let idx = cumulative.findIndex((t) => t >= targetBase);
    if (idx < 0) idx = steps.length - 1;
    const id = steps[idx]?.id;
    if (id) onJumpToStep(id);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-3 mt-0.5 ${onJumpToStep ? 'cursor-pointer' : ''}`}
      onClick={onJumpToStep ? handleClick : undefined}
    />
  );
});

interface PlaybackTimelineProps {
  mode: AppMode;
  steps: ClickStep[];
  progress: PlaybackProgress;
  activePlaybackStepIndex: number | null | undefined;
  /** 本輪起始步驟（從中間開始時首步觸發前的顯示基準） */
  startIndex?: number;
  loop: boolean;
  loopCount: number;
  completedLoops: number;
  /** 點擊時間軸跳到該步驟（選取＋列表平滑捲動） */
  onJumpToStep?: (stepId: string) => void;
}

/** 簡易時間軸：進度/時間執行，一眼看出即將/還有多久下一步（靜態條，無動畫） */
export const PlaybackTimeline: React.FC<PlaybackTimelineProps> = ({
  mode,
  steps,
  progress,
  activePlaybackStepIndex,
  startIndex = 0,
  loop,
  loopCount,
  completedLoops,
  onJumpToStep,
}) => {
  const { t } = useTranslation();
  const { safeSpeed, totalScaled, progress: pct, nextStepIdx, nextInMs, cumulative, openingRemaining } = progress;
  const isPlaying = mode === AppMode.PLAYING;
  const isInfiniteLoop = loop && loopCount === 0;

  // 首步未觸發前不顯示「目前步驟」（否則會出現「#3 · → #3」重複）；只顯示下一步
  const awaitingFirst = isPlaying && (activePlaybackStepIndex === null || activePlaybackStepIndex === undefined);
  const displayIdx = awaitingFirst
    ? null
    : (activePlaybackStepIndex !== null && activePlaybackStepIndex !== undefined
      ? activePlaybackStepIndex
      : (isPlaying ? Math.min(Math.max(0, startIndex), Math.max(0, steps.length - 1)) : null));
  const curStep = displayIdx !== null && steps[displayIdx] ? steps[displayIdx] : undefined;
  const curLabel = curStep ? `#${displayIdx! + 1} ${stepTypeLabel(curStep.type)}` : '';

  const statusText = isPlaying
    ? (openingRemaining > 0 && awaitingFirst
      // 開場倒數中（從中途開始）：顯示 3-2-1 與目標步驟，進度條維持 0%
      ? (nextStepIdx >= 0 ? `開場倒數 ${Math.ceil(openingRemaining / 1000)} → #${nextStepIdx + 1}` : `開場倒數 ${Math.ceil(openingRemaining / 1000)}`)
      : (nextStepIdx >= 0
        ? `${curLabel ? `${curLabel} · ` : ''}→ #${nextStepIdx + 1} · ${(nextInMs / 1000).toFixed(1)}s`
        : `${curLabel ? `${curLabel} · ` : ''}${t('roundEnding', { pct: Math.round(pct * 100) })}`))
    : `${t('totalDuration', { duration: formatTime(totalScaled) })}${safeSpeed !== 1 ? ` @${safeSpeed.toFixed(1)}x` : ''}`;

  // 點擊進度條空白處：依時間比例找最近的步驟跳轉
  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onJumpToStep || steps.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
    const targetBase = frac * totalScaled * safeSpeed;
    let idx = cumulative.findIndex((t) => t >= targetBase);
    if (idx < 0) idx = steps.length - 1;
    const id = steps[idx]?.id;
    if (id) onJumpToStep(id);
  };

  return (
    <div className="shrink-0 border border-white/10 rounded-xl bg-black/20 px-2 py-2 mb-2">
      <div className="flex justify-between items-center text-[10px] text-gray-400 mb-1">
        <span className="uppercase tracking-wider">{t('timeline')}</span>
        <span className="font-mono text-gray-300">{statusText}</span>
      </div>
      <div
        className={`relative h-2 rounded bg-white/10 overflow-hidden ${onJumpToStep ? 'cursor-pointer' : ''}`}
        onClick={onJumpToStep ? handleBarClick : undefined}
      >
        <div className="absolute inset-y-0 left-0 bg-blue-500" style={{ width: `${Math.round((isPlaying ? pct : 0) * 100)}%` }} />
        {totalScaled > 0 && cumulative.map((tMs, idx) => {
          const frac = Math.min(1, Math.max(0, tMs / safeSpeed / totalScaled));
          const isDone = isPlaying && activePlaybackStepIndex !== null && activePlaybackStepIndex !== undefined && idx >= startIndex && idx <= activePlaybackStepIndex;
          const isNext = isPlaying && idx === nextStepIdx;
          const isSkipped = isPlaying && idx < startIndex;
          return (
            <div
              key={steps[idx]?.id || idx}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full pointer-events-none ${
                isNext
                  ? 'w-1.5 h-1.5 bg-amber-300 ring-1 ring-amber-400 z-10'
                  : isDone
                  ? 'w-1 h-1 bg-white z-[1]'
                  : isSkipped
                  ? 'w-1 h-1 bg-white/20 z-[1]'
                  : 'w-1 h-1 bg-white/60 z-[1]'
              }`}
              style={{ left: `${frac * 100}%` }}
            />
          );
        })}
      </div>
      <TimelineDotsCanvas
        steps={steps}
        cumulative={cumulative}
        totalScaled={totalScaled}
        safeSpeed={safeSpeed}
        isPlaying={isPlaying}
        activePlaybackStepIndex={activePlaybackStepIndex}
        nextStepIdx={nextStepIdx}
        startIndex={startIndex}
        onJumpToStep={onJumpToStep}
      />
      {loop && (
        <div className="text-[11px] text-gray-300 mt-1">
          {isInfiniteLoop
            ? t('infiniteLoopStatus', { count: completedLoops })
            : t('loopStatus', { current: completedLoops, total: loopCount })}
        </div>
      )}
    </div>
  );
};
