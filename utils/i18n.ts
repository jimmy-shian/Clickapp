import { useState, useEffect } from 'react';

export type Language = 'zh' | 'en';

export const translations = {
  zh: {
    // General / Common
    appName: 'OmniClick',
    close: '關閉',
    delete: '刪除',
    cancel: '取消',
    confirm: '確定',
    save: '儲存',
    load: '載入',
    export: '匯出',
    import: '匯入',
    clear: '清空',
    menu: '選單',
    exitApp: '退出程式',
    saved: '已儲存！',

    // FloatingHUD - Menu View
    newScript: '新增腳本',
    openImport: '開啟 / 匯入',
    savedScripts: '已儲存腳本',
    noSavedScripts: '尚無已儲存腳本。',
    confirmClear: '確定要清空當前腳本的所有點擊步驟嗎？',
    confirmDelete: '確定要刪除「{name}」嗎？',
    invalidScript: '無效的腳本檔案',

    // Advanced Features - Sky Sheet Converter
    advancedFeatures: '進階功能',
    sheetConverterTitle: '進階光遇琴譜轉換',
    songSource: '1. 樂譜來源 (TXT/JSON)',
    selectSongFile: '選擇樂譜檔案...',
    layoutScript: '2. 按鍵佈局腳本 (JSON - 15鍵)',
    selectLayoutScript: '選擇按鍵佈局腳本...',
    convertAndSave: '轉換並儲存',
    convertSuccess: '成功轉換 {count} 個音符並已載入！',

    // FloatingHUD - Editor View
    scriptNamePlaceholder: '腳本名稱',
    status: '狀態',
    playSpeed: '播放速度',
    duration: '總時長',
    steps: '步驟數',
    record: '錄製',
    stop: '停止',
    play: '播放',
    loop: '循環',
    times: '次',
    infinite: '∞ 無限',
    noClicksYet: '尚未錄製任何點擊。',
    duplicateStep: '複製步驟',
    timesUnit: '次',

    // StepEditor
    editPoint: '編輯點位 #{index}',
    type: '類型',
    typeClick: '點擊',
    typeSwipe: '滑動',
    typeDoubleClick: '雙擊',
    typeHold: '長按',
    triggerTime: '觸發時刻',
    position: '座標',
    startPosition: '起點座標',
    endPosition: '終點座標',
    swipeDuration: '滑動時間 (ms)',
    repeats: '重複次數',
    repeatInterval: '重複間隔 (ms)',
    delayFromPrev: '與上一步間隔 (ms)',
    duplicate: '複製',
    playFromHere: '從此點播放',

    // Timeline & Progress
    timeline: '時間軸',
    totalDuration: '總長 {duration}',
    infiniteLoopStatus: '∞ 無限循環 · 已執行 {count} 次',
    loopStatus: '循環 {current} / {total} 次',
    roundEnding: '本輪尾段 · {pct}%',

    // Minimized HUD
    minimizedStopTitle: '停止播放（點圓圈外展開則同樣停止）',
    playFromSelected: '從選定點播放',
    expand: '展開',
  },
  en: {
    // General / Common
    appName: 'OmniClick',
    close: 'Close',
    delete: 'Delete',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    load: 'Load',
    export: 'Export',
    import: 'Import',
    clear: 'Clear',
    menu: 'Menu',
    exitApp: 'Exit App',
    saved: 'Saved!',

    // FloatingHUD - Menu View
    newScript: 'New Script',
    openImport: 'Open / Import',
    savedScripts: 'Saved Scripts',
    noSavedScripts: 'No saved scripts yet.',
    confirmClear: 'Are you sure you want to clear all steps?',
    confirmDelete: 'Are you sure you want to delete "{name}"?',
    invalidScript: 'Invalid script file',

    // Advanced Features - Sky Sheet Converter
    advancedFeatures: 'Advanced Features',
    sheetConverterTitle: 'Sky Music Sheet Converter',
    songSource: '1. Song Source (TXT/JSON)',
    selectSongFile: 'Select Song File...',
    layoutScript: '2. Layout Script (JSON - 15 pts)',
    selectLayoutScript: 'Select Layout Script...',
    convertAndSave: 'Convert & Save',
    convertSuccess: 'Successfully converted {count} notes and loaded!',

    // FloatingHUD - Editor View
    scriptNamePlaceholder: 'Script Name',
    status: 'Status',
    playSpeed: 'Play Speed',
    duration: 'Duration',
    steps: 'Steps',
    record: 'RECORD',
    stop: 'STOP',
    play: 'PLAY',
    loop: 'Loop',
    times: 'times',
    infinite: '∞ infinite',
    noClicksYet: 'No clicks recorded yet.',
    duplicateStep: 'Duplicate step',
    timesUnit: 'times',

    // StepEditor
    editPoint: 'Edit Point #{index}',
    type: 'Type',
    typeClick: 'Click',
    typeSwipe: 'Swipe',
    typeDoubleClick: 'Double Click',
    typeHold: 'Hold',
    triggerTime: 'Trigger Time',
    position: 'Position',
    startPosition: 'Start Position',
    endPosition: 'End Position',
    swipeDuration: 'Swipe Duration (ms)',
    repeats: 'Repeats',
    repeatInterval: 'Repeat Interval (ms)',
    delayFromPrev: 'Delay from previous (ms)',
    duplicate: 'Duplicate',
    playFromHere: 'Play from here',

    // Timeline & Progress
    timeline: 'Timeline',
    totalDuration: 'Total {duration}',
    infiniteLoopStatus: '∞ Infinite · Executed {count} times',
    loopStatus: 'Loop {current} / {total} times',
    roundEnding: 'Round ending · {pct}%',

    // Minimized HUD
    minimizedStopTitle: 'Stop playback (tap outside to expand and stop)',
    playFromSelected: 'Play from selected',
    expand: 'Expand',
  },
} as const;

export type TranslationKey = keyof typeof translations['zh'];

let currentLanguage: Language = 'zh';
const listeners = new Set<(lang: Language) => void>();

export function getLanguage(): Language {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('omniclick_lang');
    if (saved === 'zh' || saved === 'en') {
      currentLanguage = saved;
    }
  }
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('omniclick_lang', lang);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((cb) => cb(lang));
}

export function toggleLanguage(): Language {
  const next = getLanguage() === 'zh' ? 'en' : 'zh';
  setLanguage(next);
  return next;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const lang = currentLanguage;
  const dict = translations[lang] || translations.zh;
  let text: string = dict[key] || translations.zh[key] || key;

  if (params) {
    Object.entries(params).forEach(([pKey, pVal]) => {
      text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
    });
  }
  return text;
}

export function useTranslation() {
  const [lang, setLang] = useState<Language>(getLanguage);

  useEffect(() => {
    const listener = (newLang: Language) => setLang(newLang);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    t: (key: TranslationKey, params?: Record<string, string | number>) => t(key, params),
    lang,
    setLanguage,
    toggleLanguage,
  };
}
