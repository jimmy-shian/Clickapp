import React from 'react';
import { AppMode, ClickStep } from '../types';
import { formatTime } from '../utils/format';
import { stepTypeLabel } from '../utils/timeline';
import type { PlaybackProgress } from '../hooks/usePlaybackProgress';
import { useTranslation } from '../utils/i18n';

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
  const { safeSpeed, totalScaled, progress: pct, nextStepIdx, nextInMs, cumulative } = progress;
  const isPlaying = mode === AppMode.PLAYING;
  const isInfiniteLoop = loop && loopCount === 0;

  // 目前執行中的步驟（首步未觸發前以後備起始步驟顯示，避免誤顯示 #1）
  const displayIdx = activePlaybackStepIndex !== null && activePlaybackStepIndex !== undefined
    ? activePlaybackStepIndex
    : (isPlaying ? Math.min(Math.max(0, startIndex), Math.max(0, steps.length - 1)) : null);
  const curStep = displayIdx !== null && steps[displayIdx] ? steps[displayIdx] : undefined;
  const curLabel = curStep ? `#${displayIdx! + 1} ${stepTypeLabel(curStep.type)}` : '';

  const statusText = isPlaying
    ? (nextStepIdx >= 0
      ? `${curLabel ? `${curLabel} · ` : ''}→ #${nextStepIdx + 1} · ${(nextInMs / 1000).toFixed(1)}s`
      : `${curLabel ? `${curLabel} · ` : ''}${t('roundEnding', { pct: Math.round(pct * 100) })}`)
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
      </div>
      <div
        className={`relative h-3 mt-0.5 ${onJumpToStep ? 'cursor-pointer' : ''}`}
        onClick={onJumpToStep ? handleBarClick : undefined}
      >
        {cumulative.map((tMs, i) => {
          const left = totalScaled > 0 ? Math.min(100, Math.max(0, (tMs / safeSpeed / totalScaled) * 100)) : 0;
          const isDone = isPlaying && activePlaybackStepIndex !== null && activePlaybackStepIndex !== undefined && i <= activePlaybackStepIndex;
          const isNext = i === nextStepIdx;
          const id = steps[i]?.id;
          return (
            <div
              key={id ?? i}
              onClick={id && onJumpToStep ? (e) => { e.stopPropagation(); onJumpToStep(id); } : undefined}
              className={isNext ? 'absolute w-2 h-2 rounded-full bg-amber-400 cursor-pointer' : isDone ? 'absolute w-1.5 h-1.5 rounded-full bg-blue-300 cursor-pointer' : 'absolute w-1.5 h-1.5 rounded-full bg-gray-500 cursor-pointer'}
              style={{ left: `calc(${left}% - 3px)`, top: '2px' }}
              title={`#${i + 1} ${formatTime(tMs / safeSpeed)}`}
            />
          );
        })}
      </div>
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
