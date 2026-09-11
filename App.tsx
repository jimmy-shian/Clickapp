import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ClickScript, ClickStep, AppMode, SavedScriptSummary } from './types';
import { FloatingHUD } from './components/FloatingHUD';
import { ClickCanvas } from './components/ClickCanvas';
import { StepEditor } from './components/StepEditor';
import {
  loadScriptSummaries,
  saveScript as persistScript,
  loadScriptById,
  deleteScriptById,
  createNewScript,
} from './services/scriptStorage';
import { convertSheetFiles } from './services/sheetConverter';
import {
  android,
  getAndroidBridge,
  subscribeKeyboardOpen,
} from './utils/android';
import { withTouchPadding, EXPANDED_EXTRA_BOTTOM, unionRects } from './utils/geometry';
import { getTotalStepsDuration, getCumulativeTimeUpTo } from './utils/timeline';
import { t } from './utils/i18n';

function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [script, setScript] = useState<ClickScript>(createNewScript);

  // Navigation State
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [savedScripts, setSavedScripts] = useState<SavedScriptSummary[]>([]);
  const [showSaveFeedback, setShowSaveFeedback] = useState(false);

  // Playback Visual State
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackSpeedRef = useRef(1); // Ref to access current speed inside playback closures

  // Editing State
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isDraggingPoint, setIsDraggingPoint] = useState(false);

  // 鍵盤開關（任一輸入框聚焦即開）：開著時觸控層從全螢幕縮為 HUD＋編輯器聯集，
  // 鍵盤區觸控穿透給 IME，按鍵不再被轉發進 WebView 造成 blur 關鍵盤
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  useEffect(() => subscribeKeyboardOpen(setIsKeyboardOpen), []);

  // Playback & Recording Refs
  const playbackTimeoutRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const loopCounterRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const lastActionTimeRef = useRef<number>(0);

  // Live Timer State
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  // Playback UI State
  const [activePlaybackStepIndex, setActivePlaybackStepIndex] = useState<number | null>(null);
  // 已完成的循環次數（state 版，供 HUD 縮小時顯示；loopCount=0 無限循環也會累計）
  const [completedLoops, setCompletedLoops] = useState(0);
  // 本輪起始步驟（從中間開始播放時，首步觸發前的進度/下一步顯示基準）
  const [playbackStartIndex, setPlaybackStartIndex] = useState(0);

  // HUD Rect for Android touch layer alignment
  const hudRectRef = useRef({ x: 20, y: 20, width: 380, height: 500, isCollapsed: false });
  // StepEditor 面板矩形（viewport CSS px；只在鍵盤開啟＋編輯中時與 HUD 聯集設觸控層）
  const editorRectRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  // 節流：避免拖曳 HUD 時高頻呼叫 WindowManager（發燙/耗電主因之一）
  const lastHudSyncRef = useRef(0);
  const pendingHudSyncRef = useRef<number | null>(null);

  // Helper: sync overlay rect to Android if bridge is available
  // useCallback 穩定引用：避免 FloatingHUD 矩形同步 effect 在每次 render（打字/計時 tick）都觸發原生重排
  const updateAndroidOverlayRect = useCallback((x: number, y: number, width: number, height: number) => {
    android.reportOverlayRect(x, y, width, height);
  }, []);

  // --- Sync Speed Ref ---
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  // --- Storage Logic (本體見 services/scriptStorage) ---
  useEffect(() => {
    loadSavedScriptsList();
  }, []);

  const loadSavedScriptsList = () => {
    setSavedScripts(loadScriptSummaries());
  };

  const saveScriptToStorage = (scriptToSave: ClickScript) => {
    return persistScript(scriptToSave);
  };

  const handleSaveLocal = () => {
    try {
      const updated = saveScriptToStorage(script);
      setScript(updated); // Update state to reflect new time
      loadSavedScriptsList(); // Refresh list

      // Visual feedback
      setShowSaveFeedback(true);
      setTimeout(() => setShowSaveFeedback(false), 2000);
    } catch (e) {
      alert("Failed to save locally. Storage might be full.");
    }
  };

  const handleLoadLocal = (id: string) => {
    const target = loadScriptById(id);
    if (target) {
      setScript(target);
      setIsScriptLoaded(true);
      setMode(AppMode.IDLE);
    }
  };

  const handleDeleteLocal = (id: string) => {
    if (!window.confirm("Are you sure you want to delete this script?")) return;

    deleteScriptById(id);
    loadSavedScriptsList();

    // If we deleted the current one, close it
    if (script.metadata.id === id) {
      handleCloseScript();
    }
  };

  const handleCreateNew = () => {
    setScript(createNewScript());
    setIsScriptLoaded(true);
    setMode(AppMode.IDLE);
  };

  const handleClear = () => {
    deleteScriptById(script.metadata.id);

    setScript(prev => ({ ...prev, steps: [] }));
    setSelectedStepId(null);
    loadSavedScriptsList();
  };

  const handleCloseScript = () => {
    setIsScriptLoaded(false);
    setMode(AppMode.IDLE);
    setSelectedStepId(null);
    stopPlayback();
  };

  const handleExitApp = () => {
    // Remove confirm dialog to ensure direct exit
    // Attempt various close methods
    const bridge = getAndroidBridge();
    if (bridge && typeof bridge.close === 'function') {
      android.close();
    } else if (typeof window.close === 'function') {
      try { window.close(); } catch { /* noop */ }
    }
  };

  // --- Logic: Converter (本體見 services/sheetConverter) ---
  const handleConvertSheet = async (songFile: File, mapFile: File) => {
    try {
      const { script: newScript, stepCount } = await convertSheetFiles(songFile, mapFile);
      saveScriptToStorage(newScript);
      loadSavedScriptsList();
      alert(`Success! Created script "${newScript.metadata.name}" with ${stepCount} steps.`);
    } catch (e: any) {
      console.error(e);
      alert("Conversion failed: " + e.message);
    }
  };

  // --- Logic: Recording ---
  const handleCanvasClick = (x: number, y: number) => {
    if (mode === AppMode.RECORDING) {
      const now = Date.now();

      setScript(prev => {
        const last = prev.steps[prev.steps.length - 1];

        // 計算與上一次動作的間隔
        const delay = Math.max(0, now - lastActionTimeRef.current);

        // 去重：如果與上一個 step 距離很近且時間差極短，視為同一次點擊
        if (last) {
          const dx = last.x - x;
          const dy = last.y - y;
          if ((dx * dx + dy * dy) < 144 && delay < 150) {
            return prev;
          }
        }

        // ✅ 在 updater 內同步更新 ref，確保與新增 step 一致
        lastActionTimeRef.current = now;

        const newStep: ClickStep = {
          id: uuidv4(),
          x,
          y,
          delay,
          type: 'click',
          repeat: 1,
          repeatInterval: 100
        };

        // 錄製穿透：通知 Android 在底層 App 上執行原生 tap
        getAndroidBridge()?.dispatchRecordedGesture?.(x, y);

        return { ...prev, steps: [...prev.steps, newStep] };
      });
    } else if (mode === AppMode.IDLE) {
      setSelectedStepId(null);
    }
  };

  const handleCanvasSwipe = (x: number, y: number, endX: number, endY: number, swipeDuration: number) => {
    if (mode === AppMode.RECORDING) {
      const now = Date.now();

      setScript(prev => {
        const delay = Math.max(0, now - swipeDuration - lastActionTimeRef.current);
        lastActionTimeRef.current = now;

        const newStep: ClickStep = {
          id: uuidv4(),
          x,
          y,
          endX,
          endY,
          swipeDuration,
          delay,
          type: 'swipe',
          repeat: 1,
          repeatInterval: 100
        };

        // 錄製穿透：通知 Android 在底層 App 上執行原生 swipe
        getAndroidBridge()?.dispatchRecordedSwipe?.(x, y, endX, endY, swipeDuration);

        return { ...prev, steps: [...prev.steps, newStep] };
      });
    }
  };

  /**
   * 錄製結束/暫停時整併步驟：
   * 將連續點擊同一位置（距離 <= 24px）的點自動變換為單一步驟的重複次數 (repeat)，
   * 並計算平均間隔 (repeatInterval)，保持總時長與節奏不變。
   * 其餘時候（例如使用者複製新增）則不進行整併。
   */
  const consolidateSteps = (steps: ClickStep[], thresholdPx = 24): ClickStep[] => {
    if (steps.length <= 1) return steps;
    const result: ClickStep[] = [];
    const thresholdSq = thresholdPx * thresholdPx;

    let i = 0;
    while (i < steps.length) {
      const cur = steps[i];

      // 非普通點擊（例如滑動 swipe）不整併
      if (cur.type !== 'click') {
        result.push(cur);
        i++;
        continue;
      }

      // 向後尋找同一位置的連續點擊
      let j = i + 1;
      let totalRepeat = cur.repeat || 1;
      const intervals: number[] = [];

      // 若當前步驟已有 repeat，展開現有間隔
      if (cur.repeat > 1 && cur.repeatInterval) {
        for (let k = 0; k < cur.repeat - 1; k++) {
          intervals.push(cur.repeatInterval);
        }
      }

      while (j < steps.length) {
        const next = steps[j];
        if (next.type !== 'click') break;

        const dx = next.x - cur.x;
        const dy = next.y - cur.y;
        if (dx * dx + dy * dy > thresholdSq) {
          // 位置不同，停止整併
          break;
        }

        // 同一位置的連續點擊：累計次數並記錄與前一點的 delay 作為間隔
        const nextRepeat = next.repeat || 1;
        totalRepeat += nextRepeat;
        intervals.push(next.delay);

        if (next.repeat > 1 && next.repeatInterval) {
          for (let k = 0; k < next.repeat - 1; k++) {
            intervals.push(next.repeatInterval);
          }
        }

        j++;
      }

      if (j > i + 1) {
        // 成功整併多個連續點擊
        const avgInterval = intervals.length > 0
          ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
          : (cur.repeatInterval || 100);

        result.push({
          ...cur,
          repeat: totalRepeat,
          repeatInterval: Math.max(20, avgInterval),
        });
        i = j;
      } else {
        result.push(cur);
        i++;
      }
    }

    return result;
  };

  const toggleRecord = () => {
    if (mode === AppMode.RECORDING) {
      // STOP RECORDING
      setScript(prev => {
        // 完成錄製時自動整併同一位置的連續點擊為該點重複次數
        const consolidated = consolidateSteps(prev.steps);
        const now = Date.now();

        // Calculate steps duration based on LATEST consolidated script state
        let stepsDuration = 0;
        consolidated.forEach(s => {
          stepsDuration += s.delay;
          if (s.repeat > 1) stepsDuration += (s.repeat - 1) * s.repeatInterval;
        });

        // Tail is time from last click to now
        // lastActionTimeRef is mutable and holds the timestamp of the last click (or start if no clicks)
        const tail = Math.max(0, now - lastActionTimeRef.current);
        const totalDuration = stepsDuration + tail;

        const finalScript = {
          ...prev,
          steps: consolidated,
          metadata: {
            ...prev.metadata,
            duration: totalDuration
          }
        };

        // 錄製結束時自動儲存，使腳本可供後續編輯/播放
        try {
          saveScriptToStorage(finalScript);
        } catch (e) {
          console.error('Auto-save after recording failed', e);
        }

        return finalScript;
      });
      setMode(AppMode.IDLE);
      setSessionStartTime(null);

      // 刷新已儲存腳本列表
      loadSavedScriptsList();

      // 通知 Android 停止錄製穿透 tap
      android.setRecordingMode(false);

      // 錄製結束：還原成只覆蓋 HUD 的觸控區
      const r = hudRectRef.current;
      updateAndroidOverlayRect(r.x, r.y, r.width, r.height);
    } else {
      // START RECORDING
      // 通知 Android 開始錄製穿透 tap
      android.setRecordingMode(true);

      // 強制同步 HUD rect → Android（screen px），確保錄製啟動時排除區域立即有效
      {
        const dpr = window.devicePixelRatio || 1;
        const r = hudRectRef.current;
        // 展開時加 extraBottom，與 handleHudRectChange 一致
        const extraH = r.isCollapsed ? 0 : EXPANDED_EXTRA_BOTTOM;
        android.setHudRect(
          r.x * dpr,
          r.y * dpr,
          r.width * dpr,
          (r.height + extraH) * dpr
        );
      }

      setMode(AppMode.RECORDING);
      setSelectedStepId(null);

      // 錄製模式：讓觸控 overlay 佔滿整個螢幕，所有點擊都交給 ClickCanvas
      if (typeof window !== 'undefined') {
        const w = window.innerWidth || hudRectRef.current.width;
        const h = window.innerHeight || hudRectRef.current.height;
        updateAndroidOverlayRect(0, 0, w, h);
      } else {
        updateAndroidOverlayRect(0, 0, hudRectRef.current.width, hudRectRef.current.height);
      }

      setMode(AppMode.RECORDING);
      const now = Date.now();
      startTimeRef.current = now;
      lastActionTimeRef.current = now; // Initialize relative timer
      setSessionStartTime(now);
    }
  };

  // --- Logic: Playback ---
  const stopPlayback = useCallback(() => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
    }
    isPlayingRef.current = false;
    setActivePlaybackStepIndex(null);
    setPlaybackStartIndex(0);
    setMode(AppMode.IDLE);
    setSessionStartTime(null);
    // completedLoops 保留，供展開版時間軸查看本次共執行幾次；下次播放開始時重置
  }, []);

  const playStep = useCallback((index: number, subRepeatIndex: number = 0) => {
    if (!isPlayingRef.current) return;
    const speed = playbackSpeedRef.current;

    // SCRIPT ENDED
    if (index >= script.steps.length) {
      // Calculate remaining duration (tail)
      const totalTimeUsed = getTotalStepsDuration(script.steps);

      const recordedDuration = script.metadata.duration || 0;
      // Adjust tail for speed
      const tailDelay = Math.max(500, (recordedDuration - totalTimeUsed)) / speed;

      if (script.metadata.loop) {
        // Check loop count: 0 = infinite, N = loop N times
        const maxLoops = script.metadata.loopCount || 0;
        loopCounterRef.current += 1;
        setCompletedLoops(loopCounterRef.current); // 同步給 HUD（每輪一次，低頻）

        if (maxLoops > 0 && loopCounterRef.current >= maxLoops) {
          // Reached max loop count, stop
          playbackTimeoutRef.current = window.setTimeout(() => {
            stopPlayback();
          }, tailDelay);
        } else {
          playbackTimeoutRef.current = window.setTimeout(() => {
            setSessionStartTime(Date.now()); // Reset timer for visual loop
            setPlaybackStartIndex(0); // 新一輪從頭開始，顯示基準同步歸零
            playStep(0, 0);
          }, tailDelay);
        }
      } else {
        playbackTimeoutRef.current = window.setTimeout(() => {
          stopPlayback();
        }, tailDelay);
      }
      return;
    }

    const step = script.steps[index];
    const delay = (subRepeatIndex === 0 ? step.delay : step.repeatInterval) / speed;

    playbackTimeoutRef.current = window.setTimeout(() => {
      if (!isPlayingRef.current) return;

      // Update UI to show current step only when it actually executes
      setActivePlaybackStepIndex(index);

      // --- PERFORM NATIVE GESTURE (gesture dispatch) ---
      // 使用 canvas CSS 座標直接傳入 performClick / performSwipe，
      // Java 端會用 canvas↔screen 比例做正確換算，不再用 dpr 乘法。

      if (step.type === 'swipe' && step.endX !== undefined && step.endY !== undefined) {
        const swipeDur = step.swipeDuration ?? 300;
        const bridge = getAndroidBridge();
        if (bridge?.performSwipe) {
          bridge.performSwipe(step.x, step.y, step.endX, step.endY, swipeDur);
        } else if (bridge?.swipe) {
          // 後備：舊版直接 pixel swipe
          const dpr = window.devicePixelRatio || 1;
          bridge.swipe(step.x * dpr, step.y * dpr, step.endX * dpr, step.endY * dpr, swipeDur);
        }
      } else {
        // Tap gesture — 使用 performClick（有 ratio mapping）
        getAndroidBridge()?.performClick?.(step.x, step.y);
      }
      // ----------------------------

      // NOTE: Visual updates removed to improve click performance/timing

      // Schedule Next
      if (step.repeat > 1 && subRepeatIndex < step.repeat - 1) {
        playStep(index, subRepeatIndex + 1);
      } else {
        playStep(index + 1, 0);
      }
    }, delay);

  }, [script.steps, script.metadata.loop, script.metadata.loopCount, script.metadata.duration, stopPlayback]);

  const togglePlay = () => {
    if (mode === AppMode.PLAYING) {
      stopPlayback();
    } else {
      if (script.steps.length === 0) return;

      // Determine start index: if a step is selected, start from that step
      let startIndex = 0;
      if (selectedStepId) {
        const idx = script.steps.findIndex(s => s.id === selectedStepId);
        if (idx >= 0) startIndex = idx;
      }

      setMode(AppMode.PLAYING);
      setSelectedStepId(null);
      isPlayingRef.current = true;
      loopCounterRef.current = 0;
      setCompletedLoops(0);
      setPlaybackStartIndex(startIndex);
      setSessionStartTime(Date.now());

      // Start the chain from the determined index
      playStep(startIndex, 0);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    };
  }, []);

  // --- Logic: File I/O (Export/Import) ---

  const handleExportFile = () => {
    const fileName = `${script.metadata.name.replace(/\s+/g, '_')}.json`;
    const jsonContent = JSON.stringify(script, null, 2);

    // If running inside Android overlay WebView, prefer native save flow if available
    if (android.saveFile(fileName, jsonContent)) return;

    // Fallback: regular browser download via data URL
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonContent);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleLoadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const steps = json.steps.map((s: any) => ({
          ...s,
          repeat: s.repeat || 1,
          repeatInterval: s.repeatInterval || 100
        }))

        const metadata = {
          ...json.metadata,
          id: json.metadata.id || uuidv4(),
          updatedAt: Date.now()
        };

        setScript({ ...json, metadata, steps });
        setIsScriptLoaded(true);
        setMode(AppMode.IDLE);
      } catch (err) {
        alert("Invalid script file");
      }
    };
    reader.readAsText(file);
  };

  // --- Logic: Step Editing ---

  const handleStepUpdate = (updatedStep: ClickStep) => {
    setScript(prev => ({
      ...prev,
      steps: prev.steps.map(s => s.id === updatedStep.id ? updatedStep : s)
    }));
  };

  const handleStepDelete = () => {
    if (selectedStepId) {
      setScript(prev => ({
        ...prev,
        steps: prev.steps.filter(s => s.id !== selectedStepId)
      }));
      setSelectedStepId(null);
    }
  }

  const handleStepDuplicate = () => {
    if (!selectedStepId) return;
    setScript(prev => {
      const idx = prev.steps.findIndex(s => s.id === selectedStepId);
      if (idx < 0) return prev;
      const original = prev.steps[idx];
      const clone: ClickStep = {
        ...original,
        id: uuidv4(),
        // Keep same delay as original so timeline shifts correctly
        // e.g. A(3s) B(2s) → A(3s) A'(3s) B(2s)
      };
      const newSteps = [...prev.steps];
      newSteps.splice(idx + 1, 0, clone);
      return { ...prev, steps: newSteps };
    });
  };

  // Calculate cumulative time for the selected step to pass to editor if needed
  const cumulativeTime = getCumulativeTimeUpTo(script.steps, selectedStepId);

  const selectedStep = script.steps.find(s => s.id === selectedStepId);
  const selectedStepIndex = script.steps.findIndex(s => s.id === selectedStepId);

  /** 當鍵盤開啟時，嚴格將觸控 overlay 限制在虛擬鍵盤上緣以上，絕不覆蓋鍵盤區 */
  const clampOverlayAboveKeyboard = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    if (typeof window === 'undefined') return rect;
    // 取得可視區高度（鍵盤上緣），預留 8px 安全距離
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight * 0.55;
    const maxBottom = Math.max(40, viewportHeight - 8);
    if (rect.y >= maxBottom) {
      return { x: rect.x, y: rect.y, width: 0, height: 0 };
    }
    const clampedHeight = Math.min(rect.height, Math.max(0, maxBottom - rect.y));
    return { ...rect, height: clampedHeight };
  }, []);

  /** 將 HUD 矩形套用到觸控 overlay（縮小外擴 padding / 展開底部加高，鍵盤開啟時限制在鍵盤以上） */
  const applyTouchOverlayRect = useCallback((rect: { x: number; y: number; width: number; height: number; isCollapsed: boolean }) => {
    if (rect.isCollapsed) {
      // 縮小時外擴一圈 padding，避免因座標/尺寸誤差導致點不到
      const p = withTouchPadding(rect);
      const target = isKeyboardOpen ? clampOverlayAboveKeyboard(p) : p;
      updateAndroidOverlayRect(target.x, target.y, target.width, target.height);
    } else {
      // 展開時底部外加高度，確保底部按鈕在 overlay 範圍內
      const extraH = isKeyboardOpen ? 0 : EXPANDED_EXTRA_BOTTOM;
      const target = isKeyboardOpen
        ? clampOverlayAboveKeyboard({ ...rect, height: rect.height + extraH })
        : { ...rect, height: rect.height + extraH };
      updateAndroidOverlayRect(target.x, target.y, target.width, target.height);
    }
  }, [updateAndroidOverlayRect, isKeyboardOpen, clampOverlayAboveKeyboard]);

  /** 回報 HUD 矩形給 Android（CSS px → 螢幕 px），錄製時排除此區域不穿透 tap */
  const reportHudRectToAndroid = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    android.setHudRect(rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr);
  }, []);

  /** 鍵盤開啟＋編輯中：觸控層改為 HUD＋編輯器面板的外包聯集（嚴格限制在鍵盤以上，穿透鍵盤給 IME） */
  const applyUnionTouchRect = useCallback(() => {
    const u = unionRects(hudRectRef.current, editorRectRef.current);
    const clamped = clampOverlayAboveKeyboard(u);
    updateAndroidOverlayRect(clamped.x, clamped.y, clamped.width, clamped.height);
  }, [updateAndroidOverlayRect, clampOverlayAboveKeyboard]);

  // useCallback 穩定引用：打字/計時 tick 不改變此函式身份，HUD 端矩形同步 effect 才不會誤觸原生重排
  const handleHudRectChange = useCallback((x: number, y: number, width: number, height: number, isCollapsed: boolean) => {
    const isEditing = mode === AppMode.IDLE && selectedStepId !== null;
    const prev = hudRectRef.current;
    // 相同矩形直接跳過（HUD 端已去重，這裡是第二道防線）
    if (prev.x === x && prev.y === y && prev.width === width && prev.height === height && prev.isCollapsed === isCollapsed) {
      return;
    }
    hudRectRef.current = { x, y, width, height, isCollapsed };

    // 節流：拖曳中最多 ~8次/秒呼叫 WindowManager，降低發燙；收合狀態切換則立即同步
    const now = Date.now();
    if (prev.isCollapsed !== isCollapsed || now - lastHudSyncRef.current > 120) {
      lastHudSyncRef.current = now;
    } else {
      // 拖尾補送：節流期間被丟棄的最終位置，140ms 後補送一次，避免觸控層停在舊座標
      if (pendingHudSyncRef.current !== null) window.clearTimeout(pendingHudSyncRef.current);
      const snapMode = mode;
      const snapEditing = isEditing;
      const snapSelected = selectedStepId;
      const snapKeyboard = isKeyboardOpen;
      pendingHudSyncRef.current = window.setTimeout(() => {
        pendingHudSyncRef.current = null;
        lastHudSyncRef.current = Date.now();
        const r = hudRectRef.current;
        reportHudRectToAndroid(r);
        // 與即時路徑一致：鍵盤開著時不用全螢幕，編輯中用聯集
        if (snapKeyboard) {
          if (snapMode === AppMode.IDLE && snapSelected !== null) {
            applyUnionTouchRect();
          } else {
            applyTouchOverlayRect(r);
          }
        } else if (snapMode !== AppMode.RECORDING && !snapEditing) {
          applyTouchOverlayRect(r);
        }
      }, 140);
      return;
    }

    reportHudRectToAndroid({ x, y, width, height });

    // 鍵盤開著時不用全螢幕：改用 HUD（＋編輯中再聯集編輯器面板），鍵盤區穿透給 IME；
    // 錄製/編輯＋鍵盤關閉時維持原邏輯（錄製由 toggleRecord 控制全螢幕）
    if (isKeyboardOpen) {
      if (mode === AppMode.IDLE && selectedStepId !== null) {
        applyUnionTouchRect();
      } else {
        applyTouchOverlayRect({ x, y, width, height, isCollapsed });
      }
      return;
    }

    // 非錄製狀態下，用 HUD 矩形當作觸控 overlay；錄製時 overlay 由 toggleRecord 控制
    if (mode !== AppMode.RECORDING && !isEditing) {
      applyTouchOverlayRect({ x, y, width, height, isCollapsed });
    }
  }, [mode, selectedStepId, isKeyboardOpen, applyTouchOverlayRect, applyUnionTouchRect, reportHudRectToAndroid]);

  /** StepEditor 面板矩形回報：只在鍵盤開啟＋編輯中時即時刷新聯集觸控層 */
  const handleEditorRectChange = useCallback((x: number, y: number, width: number, height: number) => {
    editorRectRef.current = { x, y, width, height };
    if (isKeyboardOpen && mode === AppMode.IDLE && selectedStepId !== null) {
      applyUnionTouchRect();
    }
  }, [isKeyboardOpen, mode, selectedStepId, applyUnionTouchRect]);

  // 監聽視窗可視高度變化（鍵盤彈出/收起時），動態調整觸控層避開鍵盤；支援手機內建導覽列/返回鍵自動收闔
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const onViewportResize = () => {
      // 若視窗高度恢復到接近 window.innerHeight，代表使用者透過手機內建導覽列/返回鍵收闔了鍵盤
      if (window.visualViewport && window.visualViewport.height >= window.innerHeight - 60) {
        if (isKeyboardOpen) {
          android.setKeyboardOpen(false);
          android.clearInputFocus();
          return;
        }
      }

      if (isKeyboardOpen) {
        const isEditing = mode === AppMode.IDLE && selectedStepId !== null;
        if (isEditing) {
          applyUnionTouchRect();
        } else {
          applyTouchOverlayRect(hudRectRef.current);
        }
      }
    };
    window.visualViewport.addEventListener('resize', onViewportResize);
    return () => window.visualViewport?.removeEventListener('resize', onViewportResize);
  }, [isKeyboardOpen, mode, selectedStepId, applyUnionTouchRect, applyTouchOverlayRect]);

  useEffect(() => {
    const isEditing = mode === AppMode.IDLE && selectedStepId !== null;

    // 鍵盤開著時不用全螢幕（否則鍵盤按鍵被轉發進 WebView → blur → 鍵盤關閉）：
    // 編輯中改用 HUD＋編輯器聯集，其餘用 HUD 矩形；關閉後恢復全螢幕
    if (isKeyboardOpen) {
      if (isEditing) {
        applyUnionTouchRect();
      } else {
        applyTouchOverlayRect(hudRectRef.current);
      }
      return;
    }

    if (mode === AppMode.RECORDING || isEditing) {
      if (typeof window !== 'undefined') {
        const w = window.innerWidth || hudRectRef.current.width;
        const h = window.innerHeight || hudRectRef.current.height;
        updateAndroidOverlayRect(0, 0, w, h);
      } else {
        updateAndroidOverlayRect(0, 0, hudRectRef.current.width, hudRectRef.current.height);
      }
    } else {
      applyTouchOverlayRect(hudRectRef.current);
    }
  }, [mode, selectedStepId, isKeyboardOpen, applyTouchOverlayRect, applyUnionTouchRect, updateAndroidOverlayRect]);

  return (
    // Updated: Background is transparent and pointer-events passed through
    <div
      className="relative w-full h-full overflow-hidden select-none font-sans pointer-events-none"
      style={{ backgroundColor: 'transparent' }}
    >

      {/* Main Canvas - Only interactive if script is loaded */}
      {isScriptLoaded ? (
        <ClickCanvas
          mode={mode}
          steps={script.steps}
          onCanvasClick={handleCanvasClick}
          onCanvasSwipe={handleCanvasSwipe}
          onStepClick={(id) => setSelectedStepId(id)}
          onStepUpdate={handleStepUpdate}
          selectedStepId={selectedStepId}
          onDragPointChange={setIsDraggingPoint}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" />
      )}

      {/* Floating Controls */}
      <FloatingHUD
        mode={mode}
        script={script}
        savedScripts={savedScripts}
        isScriptLoaded={isScriptLoaded}
        showSaveFeedback={showSaveFeedback}
        sessionStartTime={sessionStartTime}
        isDraggingPoint={isDraggingPoint}

        onRecordToggle={toggleRecord}
        onPlayToggle={togglePlay}
        onClear={handleClear}

        onSaveLocal={handleSaveLocal}
        onExport={handleExportFile}
        onLoadFile={handleLoadFile}
        onLoadLocal={handleLoadLocal}
        onCreateNew={handleCreateNew}
        onDeleteLocal={handleDeleteLocal}
        onCloseScript={handleCloseScript}
        onExitApp={handleExitApp}
        onConvertSheet={handleConvertSheet}

        setLoop={(loop) => setScript(prev => ({ ...prev, metadata: { ...prev.metadata, loop } }))}
        setLoopCount={(loopCount) => setScript(prev => ({ ...prev, metadata: { ...prev.metadata, loopCount } }))}
        setScriptName={(name) => setScript(prev => ({ ...prev, metadata: { ...prev.metadata, name } }))}

        onSelectStep={setSelectedStepId}
        selectedStepId={selectedStepId}
        completedLoops={completedLoops}
        activePlaybackStepIndex={activePlaybackStepIndex}
        playbackStartIndex={playbackStartIndex}

        playbackSpeed={playbackSpeed}
        setPlaybackSpeed={setPlaybackSpeed}

        onRectChange={handleHudRectChange}
        onDuplicateStep={handleStepDuplicate}
      />

      {/* Step Editor */}
      {selectedStep && mode === AppMode.IDLE && isScriptLoaded && (
        <StepEditor
          step={selectedStep}
          index={selectedStepIndex}
          cumulativeTime={cumulativeTime}
          playbackSpeed={playbackSpeed}
          isDraggingPoint={isDraggingPoint}
          onUpdate={handleStepUpdate}
          onClose={() => setSelectedStepId(null)}
          onDelete={handleStepDelete}
          onDuplicate={handleStepDuplicate}
          onRectChange={handleEditorRectChange}
        />
      )}
    </div>
  );
}

export default App;