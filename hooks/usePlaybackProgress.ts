import { useMemo } from 'react';
import { AppMode, ClickStep } from '../types';
import {
  getStepCumulativeTimes,
  getTotalBaseDuration,
  getSuffixBaseDuration,
  getSuffixCumulativeTimes,
  getNextStepIndex,
  clampStartIndex,
} from '../utils/timeline';

export interface PlaybackProgress {
  /** 播放速度（>0 保底 1） */
  safeSpeed: number;
  /** 全長（已除速；時間軸圓點定位＋閒置總長顯示用） */
  totalScaled: number;
  /** 本輪剩餘總長（已除速；從起始點到尾 + tail，進度條分母用） */
  suffixScaled: number;
  /** 本輪進度 0~1（僅播放中有效；以後綴為基準，起始點為 0%） */
  progress: number;
  /** 下一步索引；-1 表本輪尾段或非播放中 */
  nextStepIdx: number;
  /** 距下一步毫秒（已除速；以後綴相對時刻計算） */
  nextInMs: number;
  /** 每步累計觸發時刻（base ms，絕對時間軸，圓點定位用） */
  cumulative: number[];
  /** 後綴相對觸發時刻（base ms，與 sessionStart 對齊；< startIndex 為 -1） */
  suffixCumulative: number[];
  /** clamp 後的本輪起始步驟 */
  clampedStart: number;
  /** 首步尚未觸發（等待立即執行的起始步） */
  awaitingFirst: boolean;
  /** 開場倒數剩餘毫秒（>0 表開場中；起鏈後為 0。live 為負即開場剩餘，見 App.togglePlay） */
  openingRemaining: number;
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
  const suffixBase = useMemo(
    () => getSuffixBaseDuration(steps, recordedDuration, startIndex),
    [steps, recordedDuration, startIndex]
  );
  const suffixCumulative = useMemo(
    () => getSuffixCumulativeTimes(steps, startIndex),
    [steps, startIndex]
  );

  return useMemo(() => {
    const safeSpeed = playbackSpeed > 0 ? playbackSpeed : 1;
    const totalScaled = totalBase / safeSpeed;
    const suffixScaled = suffixBase / safeSpeed;
    const isPlaying = mode === AppMode.PLAYING;
    const clampedStart = clampStartIndex(steps.length, startIndex);

    if (!isPlaying) {
      return {
        safeSpeed,
        totalScaled,
        suffixScaled,
        progress: 0,
        nextStepIdx: -1,
        nextInMs: 0,
        cumulative,
        suffixCumulative,
        clampedStart,
        awaitingFirst: false,
        openingRemaining: 0,
      };
    }

    // 開場倒數期間 live 為負（sessionStart = 按下時刻 + 開場）：
    // 鏈時間以歸零後起算（chainLive），開場剩餘供 pill/時間軸顯示 3-2-1。
    const chainLive = Math.max(0, liveDuration);
    const openingRemaining = Math.max(0, -liveDuration);

    // 首步尚未觸發前，以起始步驟為基準（否則會誤顯示 #1）
    const awaitingFirst = activePlaybackStepIndex === null || activePlaybackStepIndex === undefined;
    const nextStepIdx = awaitingFirst
      ? (steps.length > 0 ? clampedStart : -1)
      : getNextStepIndex(true, activePlaybackStepIndex, steps.length);

    // 倒數：以後綴相對時刻 - chainLive（兩者都以起鏈為零點，不會混入 #1~#N-1 的時間）
    let nextInMs = 0;
    if (nextStepIdx >= 0 && suffixCumulative[nextStepIdx] !== undefined && suffixCumulative[nextStepIdx] >= 0) {
      if (awaitingFirst) {
        // 起始步立即執行，不倒數（中途開始另有開場倒數，此處恆為 0）
        nextInMs = 0;
      } else {
        nextInMs = Math.max(0, suffixCumulative[nextStepIdx] / safeSpeed - chainLive);
      }
    }

    // 進度：chainLive / 剩餘總長（起始點為 0%，跑到尾 + tail 為 100%；開場期間為 0%）
    const progress =
      suffixScaled > 0 ? Math.min(1, Math.max(0, chainLive / suffixScaled)) : 0;

    return {
      safeSpeed,
      totalScaled,
      suffixScaled,
      progress,
      nextStepIdx,
      nextInMs,
      cumulative,
      suffixCumulative,
      clampedStart,
      awaitingFirst,
      openingRemaining,
    };
  }, [mode, steps, totalBase, suffixBase, playbackSpeed, mode === AppMode.PLAYING ? liveDuration : 0, activePlaybackStepIndex, startIndex, cumulative, suffixCumulative]);
}
