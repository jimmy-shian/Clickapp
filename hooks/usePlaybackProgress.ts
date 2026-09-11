import { useMemo } from 'react';
import { AppMode, ClickStep } from '../types';
import {
  getStepCumulativeTimes,
  getTotalBaseDuration,
  getNextStepIndex,
  getNextStepDelayMs,
} from '../utils/timeline';

export interface PlaybackProgress {
  /** 播放速度（>0 保底 1） */
  safeSpeed: number;
  /** 本輪總長（已除速） */
  totalScaled: number;
  /** 本輪進度 0~1（僅播放中有效） */
  progress: number;
  /** 下一步索引；-1 表本輪尾段或非播放中 */
  nextStepIdx: number;
  /** 距下一步毫秒（已除速） */
  nextInMs: number;
  /** 每步累計觸發時刻（base ms） */
  cumulative: number[];
}

interface UsePlaybackProgressArgs {
  mode: AppMode;
  steps: ClickStep[];
  recordedDuration?: number;
  playbackSpeed: number;
  liveDuration: number;
  activePlaybackStepIndex: number | null | undefined;
  /** 本輪起始步驟（從中間開始播放時，首步觸發前的顯示基準） */
  startIndex?: number;
}

/** 播放進度 / 下一步倒數的共用計算（縮小 pill 與展開時間軸共用，純計算無動畫） */
export function usePlaybackProgress({
  mode,
  steps,
  recordedDuration = 0,
  playbackSpeed,
  liveDuration,
  activePlaybackStepIndex,
  startIndex = 0,
}: UsePlaybackProgressArgs): PlaybackProgress {
  const cumulative = useMemo(() => getStepCumulativeTimes(steps), [steps]);
  const totalBase = useMemo(
    () => getTotalBaseDuration(steps, recordedDuration),
    [steps, recordedDuration]
  );

  return useMemo(() => {
    const safeSpeed = playbackSpeed > 0 ? playbackSpeed : 1;
    const totalScaled = totalBase / safeSpeed;
    const isPlaying = mode === AppMode.PLAYING;
    const clampedStart = steps.length > 0 ? Math.min(Math.max(0, startIndex), steps.length - 1) : 0;
    // 首步尚未觸發前，以起始步驟為基準（否則會誤顯示 #1）
    const awaitingFirst = isPlaying && (activePlaybackStepIndex === null || activePlaybackStepIndex === undefined);
    const nextStepIdx = awaitingFirst
      ? (steps.length > 0 ? clampedStart : -1)
      : getNextStepIndex(isPlaying, activePlaybackStepIndex, steps.length);
    const nextInMs = isPlaying
      ? getNextStepDelayMs(cumulative, nextStepIdx, safeSpeed, liveDuration)
      : 0;
    // 從中間開始時，進度條起點落在起始步驟的時間位置，而非 0%
    const baseOffset = isPlaying && clampedStart > 0 && steps[clampedStart] !== undefined
      ? Math.max(0, cumulative[clampedStart] - steps[clampedStart].delay)
      : 0;
    const progress =
      isPlaying && totalScaled > 0
        ? Math.min(1, Math.max(0, (baseOffset / safeSpeed + liveDuration) / totalScaled))
        : 0;
    return { safeSpeed, totalScaled, progress, nextStepIdx, nextInMs, cumulative };
  }, [mode, steps, totalBase, playbackSpeed, liveDuration, activePlaybackStepIndex, startIndex, cumulative]);
}
