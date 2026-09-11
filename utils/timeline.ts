import { ClickStep } from '../types';

/** 步驟類型短標籤（步驟列表 / 播放標記共用） */
export function stepTypeLabel(type: ClickStep['type']): string {
  switch (type) {
    case 'swipe': return 'Swipe';
    case 'double-click': return 'DblClick';
    case 'hold': return 'Hold';
    default: return 'Click';
  }
}

/** 每步觸發時刻的累計時間（base ms，未除速；含 repeat 展開） */
export function getStepCumulativeTimes(steps: ClickStep[]): number[] {
  const cum: number[] = [];
  let acc = 0;
  for (const s of steps) {
    acc += s.delay;
    cum.push(acc);
    if (s.repeat > 1) acc += (s.repeat - 1) * s.repeatInterval;
  }
  return cum;
}

/** 全部步驟耗時總和（delay + repeat 展開；不含錄影 tail） */
export function getTotalStepsDuration(steps: ClickStep[]): number {
  return steps.reduce((acc, step) => {
    let d = acc + step.delay;
    if (step.repeat > 1) d += (step.repeat - 1) * step.repeatInterval;
    return d;
  }, 0);
}

/** 本輪總長 base（取錄影總長與步驟總和較大者，至少 1 避免除零） */
export function getTotalBaseDuration(steps: ClickStep[], recordedDuration: number = 0): number {
  return Math.max(recordedDuration, getTotalStepsDuration(steps), 1);
}

/** 指定步驟的累計觸發時刻（含該步 delay；找不到 id 則回傳全長） */
export function getCumulativeTimeUpTo(steps: ClickStep[], stepId: string | null): number {
  let t = 0;
  for (const s of steps) {
    if (s.id === stepId) {
      t += s.delay;
      break;
    }
    t += s.delay;
    if (s.repeat > 1) t += (s.repeat - 1) * s.repeatInterval;
  }
  return t;
}

/** 下一步索引；-1 代表本輪尾段（等待 loop / tail）或非播放中 */
export function getNextStepIndex(
  isPlaying: boolean,
  activePlaybackStepIndex: number | null | undefined,
  stepCount: number
): number {
  if (!isPlaying) return -1;
  if (activePlaybackStepIndex === null || activePlaybackStepIndex === undefined) return stepCount > 0 ? 0 : -1;
  const n = activePlaybackStepIndex + 1;
  return n < stepCount ? n : -1;
}

/** 距下一步的毫秒數（已除速；無下一步回傳 0） */
export function getNextStepDelayMs(
  cumulative: number[],
  nextStepIdx: number,
  safeSpeed: number,
  liveDuration: number
): number {
  if (nextStepIdx < 0 || cumulative[nextStepIdx] === undefined) return 0;
  return Math.max(0, cumulative[nextStepIdx] / safeSpeed - liveDuration);
}
