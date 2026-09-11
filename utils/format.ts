/** 將毫秒格式化為 MM:SS.mmm（原散落在 FloatingHUD / StepEditor 的重複實作） */
export const formatTime = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor(ms % 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

/**
 * 解析時間字串為毫秒；支援：
 * 1. 純秒數（例如 "08", "8", "8.5", "120"）-> 換算為毫秒
 * 2. 分秒格式（例如 "00:08", "0:08.5", "1:30", "01:08.000", ":08"）
 * 格式不符回傳 null
 */
export const parseFormattedTime = (timeStr: string): number | null => {
  if (timeStr === undefined || timeStr === null) return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  // 1. 純數字（含小數，例如 "08", "8", "8.5", "120"）-> 視為秒數
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = parseFloat(trimmed);
    return isNaN(sec) ? null : Math.round(sec * 1000);
  }

  // 2. 分:秒 格式（例如 "00:08", "01:23.456", ":08"）
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length === 2) {
      const minStr = parts[0].trim();
      const secStr = parts[1].trim();
      const minutes = minStr === '' ? 0 : parseInt(minStr, 10);
      const sec = parseFloat(secStr);
      if (!isNaN(minutes) && !isNaN(sec) && minutes >= 0 && sec >= 0) {
        return Math.round(minutes * 60000 + sec * 1000);
      }
    }
  }

  return null;
};
