import React, { useState, useEffect, useRef } from 'react';
import { blurOnEnter, stopTouchPropagation, handleInputFocus, handleInputBlur } from '../utils/input';

interface SafeNumberInputProps {
  value: number;
  /** 失焦且為空/非法時要帶回的默認值（例如 loopCount→0、repeat→1） */
  defaultValue: number;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * 允許完全刪除內容的數字輸入框。
 * - 輸入中以字串保存，可清空為 ""，不會被 Number("")=0 即時蓋掉
 * - 失焦 / 按 Enter 時才 commit；空值或非法值則帶回 defaultValue
 * - focus 時通知 Android 彈鍵盤（穿透模式，不擋選字列），blur 時釋放
 */
export const SafeNumberInput: React.FC<SafeNumberInputProps> = ({
  value,
  defaultValue,
  min,
  max,
  onCommit,
  className,
  ariaLabel,
}) => {
  const [text, setText] = useState<string>(String(value));
  const focusedRef = useRef(false);

  // 外部值變化時同步（但輸入焦點中不覆蓋，避免打字被洗掉）
  useEffect(() => {
    if (!focusedRef.current) {
      setText(String(value));
    }
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      setText(String(defaultValue));
      onCommit(defaultValue);
      return;
    }
    let n = Number(trimmed);
    if (!isFinite(n)) {
      setText(String(defaultValue));
      onCommit(defaultValue);
      return;
    }
    n = Math.round(n);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    onCommit(n);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        // 只允許數字相關字元，空字串允許（完全刪除），輸入中不提前 commit，失焦或 Enter 才結算
        const v = e.target.value;
        if (v === '' || /^-?\d*$/.test(v)) {
          setText(v);
        }
      }}
      onFocus={(e) => {
        focusedRef.current = true;
        handleInputFocus(e);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        const currentVal = e.target.value ?? text;
        commit(currentVal);
        handleInputBlur();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          focusedRef.current = false;
          const currentVal = (e.target as HTMLInputElement).value ?? text;
          commit(currentVal);
          blurOnEnter(e);
        }
      }}
      className={className}
      style={{ touchAction: 'manipulation' }}
      onTouchStart={stopTouchPropagation}
    />
  );
};
