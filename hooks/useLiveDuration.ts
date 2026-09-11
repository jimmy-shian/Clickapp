import { useState, useEffect } from 'react';

/** 低頻計時：回傳自 sessionStartTime 起經過的毫秒數；非 active 時回 0 且不跑 timer（省電） */
export function useLiveDuration(
  sessionStartTime: number | null,
  active: boolean,
  intervalMs: number
): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active || !sessionStartTime) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - sessionStartTime);
    const id = window.setInterval(() => {
      setElapsed(Date.now() - sessionStartTime);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, sessionStartTime, intervalMs]);

  return elapsed;
}
