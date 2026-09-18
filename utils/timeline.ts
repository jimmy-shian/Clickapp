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

/** 本輪總長 base（取錄影總長與步驟總和較大者，至少 1 避免除零；全長顯示用） */
export function getTotalBaseDuration(steps: ClickStep[], recordedDuration: number = 0): number {
  return Math.max(recordedDuration, getTotalStepsDuration(steps), 1);
}

/** 起始索引 clamp 到合法範圍（空陣列回 0） */
export function clampStartIndex(stepCount: number, startIndex: number): number {
  if (stepCount <= 0) return 0;
  if (!Number.isFinite(startIndex)) return 0;
  return Math.min(Math.max(0, Math.floor(startIndex)), stepCount - 1);
}

/** 錄影 tail：錄製總長超出步驟總和的部分（單次播放尾段等待用，與起始點無關） */
export function getTailDuration(steps: ClickStep[], recordedDuration: number = 0): number {
  return Math.max(0, recordedDuration - getTotalStepsDuration(steps));
}

/**
 * 後綴執行耗時（不含起始步自己的 delay，因為中途開始首步立即執行）：
 * (repeat[N]-1)*interval[N] + sum(N+1..尾 delay + repeat 展開)
 */
export function getSuffixStepsDuration(steps: ClickStep[], startIndex: number): number {
  if (steps.length === 0) return 0;
  const s = clampStartIndex(steps.length, startIndex);
  let total = 0;
  const first = steps[s];
  if (first && first.repeat > 1) total += (first.repeat - 1) * first.repeatInterval;
  for (let i = s + 1; i < steps.length; i++) {
    const st = steps[i];
    total += st.delay;
    if (st.repeat > 1) total += (st.repeat - 1) * st.repeatInterval;
  }
  return total;
}

/**
 * 後綴相對觸發時刻：與 sessionStartTime（播放開始）對齊的時間軸。
 * - 下標 < startIndex 填 -1（已跳過，不參與倒數）
 * - [startIndex] = 0（立即執行）
 * - 之後每步 = 相對毫秒（未除速，含 repeat 展開）
 */
export function getSuffixCumulativeTimes(steps: ClickStep[], startIndex: number): number[] {
  const rel: number[] = new Array(steps.length).fill(-1);
  if (steps.length === 0) return rel;
  const s = clampStartIndex(steps.length, startIndex);
  let acc = 0;
  rel[s] = 0;
  // 首步的重複尾段會計入下一手的等待
  const first = steps[s];
  if (first && first.repeat > 1) acc += (first.repeat - 1) * first.repeatInterval;
  for (let i = s + 1; i < steps.length; i++) {
    acc += steps[i].delay;
    rel[i] = acc;
    if (steps[i].repeat > 1) acc += (steps[i].repeat - 1) * steps[i].repeatInterval;
  }
  return rel;
}

/** 本輪剩餘總長 base（後綴執行耗時 + tail，至少 1 避免除零） */
export function getSuffixBaseDuration(
  steps: ClickStep[],
  recordedDuration: number = 0,
  startIndex: number = 0
): number {
  return Math.max(getSuffixStepsDuration(steps, startIndex) + getTailDuration(steps, recordedDuration), 1);
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
