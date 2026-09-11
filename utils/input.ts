import React from 'react';
import { requestInputFocus, notifyInputBlur, setKeyboardOpen, dismissKeyboard } from './android';

export { dismissKeyboard };

/** Enter 鍵失焦並收闔鍵盤（各輸入框共用，指定完成） */
export const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
  if (e.key === 'Enter') {
    dismissKeyboard();
  }
};

/** 阻止觸控冒泡（輸入框被 HUD 拖曳/面板拖曳誤觸時共用） */
export const stopTouchPropagation = (e: React.TouchEvent): void => {
  e.stopPropagation();
};

/** 輸入框 focus 時呼叫：彈鍵盤＋標記鍵盤開啟 */
export function handleInputFocus(_e: React.FocusEvent<HTMLInputElement>): void {
  requestInputFocus();
  setKeyboardOpen(true);
}

/** 輸入框 blur 時呼叫：確認離開所有輸入框才釋放（見 notifyInputBlur） */
export function handleInputBlur(): void {
  notifyInputBlur();
}
