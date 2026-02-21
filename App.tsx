import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ClickScript, ClickStep, AppMode, SavedScriptSummary } from './types';
import { FloatingHUD } from './components/FloatingHUD';
import { ClickCanvas } from './components/ClickCanvas';
import { StepEditor } from './components/StepEditor';

// Declaration for Android Interface
declare global {
  interface Window {
    Android?: {
      performClick: (x: number, y: number) => void;
      performSwipe?: (x1: number, y1: number, x2: number, y2: number, durationMs: number) => void;
      close?: () => void;
      updateOverlayRect?: (x: number, y: number, width: number, height: number) => void;
      tap?: (x: number, y: number) => void;
      swipe?: (x1: number, y1: number, x2: number, y2: number, durationMs: number) => void;
      reportPos?: (x: number, y: number, width: number, height: number) => void;
      openFilePicker?: (slot: string) => void;
      saveFile?: (name: string, content: string) => void;
      requestInputFocus?: () => void;
      clearInputFocus?: () => void;
      setRecordingMode?: (recording: boolean) => void;
      setHudRect?: (x: number, y: number, width: number, height: number) => void;
      dispatchRecordedGesture?: (canvasX: number, canvasY: number) => void;
      dispatchRecordedSwipe?: (x1: number, y1: number, x2: number, y2: number, durationMs: number) => void;
    };
    __omniclickOnFilePicked?: (slot: string, fileName: string, content: string) => void;
  }
}

const STORAGE_KEY = 'omniclick_scripts';

const generateUniqueNewScriptName = (): string => {
  const baseName = 'New Script';

  try {
    if (typeof window === 'undefined') {
      return `${baseName} #1`;
    }
  } catch {
    return `${baseName} #1`;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return `${baseName} #1`;
    }

    const parsed = JSON.parse(raw);
    const allScripts: any[] = Object.values(parsed);

    const regex = /^New Script(?: #(\d+))?$/;
    let maxIndex = 0;

    for (const s of allScripts) {
      const name: string | undefined = s && s.metadata && s.metadata.name;
      if (!name) continue;
      const match = name.match(regex);
      if (!match) continue;
      const n = match[1] ? parseInt(match[1], 10) : 0;
      if (!isNaN(n) && n > maxIndex) {
        maxIndex = n;
      }
    }

    const nextIndex = maxIndex + 1;
    return `${baseName} #${nextIndex}`;
  } catch (e) {
    console.error('Failed to generate unique script name', e);
    return `${baseName} #1`;
  }
};

const generateNewScript = (): ClickScript => {
  const now = Date.now();
  return {
    metadata: {
      id: uuidv4(),
      name: generateUniqueNewScriptName(),
      version: '1.0',
      loop: false,
      loopCount: 0,
      createdAt: now,
      updatedAt: now,
      duration: 0
    },
    steps: []
  };
};

function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [script, setScript] = useState<ClickScript>(generateNewScript());

  // Navigation State
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [savedScripts, setSavedScripts] = useState<SavedScriptSummary[]>([]);
  const [showSaveFeedback, setShowSaveFeedback] = useState(false);

  // Playback Visual State
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackSpeedRef = useRef(1); // Ref to access current speed inside playback closures

  // Editing State
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

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

  // HUD Rect for Android touch layer alignment
  const hudRectRef = useRef({ x: 20, y: 20, width: 380, height: 500, isCollapsed: false });

  // Helper: sync overlay rect to Android if bridge is available
  const updateAndroidOverlayRect = (x: number, y: number, width: number, height: number) => {
    if (!window.Android) return;
    if (window.Android.updateOverlayRect) {
      window.Android.updateOverlayRect(x, y, width, height);
    } else if (window.Android.reportPos) {
      window.Android.reportPos(x, y, width, height);
    }
  };

  // --- Sync Speed Ref ---
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  // --- Storage Logic ---
  useEffect(() => {
    loadSavedScriptsList();
  }, []);

  const loadSavedScriptsList = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const summary: SavedScriptSummary[] = Object.values(parsed).map((s: any) => ({
          id: s.metadata.id,
          name: s.metadata.name,
          updatedAt: s.metadata.updatedAt || Date.now(),
          stepCount: s.steps.length
        }));
        // Sort by newest
        summary.sort((a, b) => b.updatedAt - a.updatedAt);
        setSavedScripts(summary);
      }
    } catch (e) {
      console.error("Failed to load scripts", e);
    }
  };

  const saveScriptToStorage = (scriptToSave: ClickScript) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const allScripts = raw ? JSON.parse(raw) : {};

      const updatedScript = {
        ...scriptToSave,
        metadata: {
          ...scriptToSave.metadata,
          updatedAt: Date.now()
        }
      };

      allScripts[updatedScript.metadata.id] = updatedScript;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allScripts));
      return updatedScript;
    } catch (e) {
      console.error("Storage error", e);
      throw new Error("Failed to save to local storage.");
    }
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const allScripts = JSON.parse(raw);
        const target = allScripts[id];
        if (target) {
          setScript(target);
          setIsScriptLoaded(true);
          setMode(AppMode.IDLE);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteLocal = (id: string) => {
    if (!window.confirm("Are you sure you want to delete this script?")) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const allScripts = JSON.parse(raw);
        delete allScripts[id];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allScripts));
        loadSavedScriptsList();

        // If we deleted the current one, close it
        if (script.metadata.id === id) {
          handleCloseScript();
        }
      }
    } catch (e) { console.error(e); }
  };

  const handleCreateNew = () => {
    setScript(generateNewScript());
    setIsScriptLoaded(true);
    setMode(AppMode.IDLE);
  };

  const handleClear = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const allScripts = JSON.parse(raw);
        if (allScripts[script.metadata.id]) {
          delete allScripts[script.metadata.id];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(allScripts));
        }
      }
    } catch (e) {
      console.error(e);
    }

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
    if (window.Android && typeof window.Android.close === 'function') {
      window.Android.close();
    } else if (typeof window.close === 'function') {
      window.close();
    }
  };

  // --- Logic: Converter ---
  const handleConvertSheet = async (songFile: File, mapFile: File) => {
    try {
      const songText = await songFile.text();
      const mapText = await mapFile.text();

      let songData;
      let mapData;

      try {
        songData = JSON.parse(songText);
        mapData = JSON.parse(mapText);
      } catch (e) {
        alert("Error parsing JSON files. Please check format.");
        return;
      }

      // 1. Process Song Data
      // Handle array wrapper if present (user example shows array)
      const songEntry = Array.isArray(songData) ? songData[0] : songData;
      if (!songEntry || !songEntry.songNotes) {
        alert("Invalid Song JSON format. Missing 'songNotes'.");
        return;
      }

      // Sort notes by time just in case
      const notes = songEntry.songNotes.sort((a: any, b: any) => a.time - b.time);

      // 2. Process Map Data
      if (!mapData.steps || mapData.steps.length < 15) {
        alert("Layout script must have at least 15 steps (Key1 to Key15).");
        return;
      }

      // 3. Generate Steps
      const newSteps: ClickStep[] = [];
      let previousTime = 0;

      for (const note of notes) {
        // Parse Key format "Key5", "Key12", etc.
        const keyMatch = note.key && note.key.match(/Key(\d+)/);
        if (!keyMatch) continue; // Skip invalid keys

        const keyNum = parseInt(keyMatch[1], 10);
        const stepIndex = keyNum - 1; // 0-based index

        if (stepIndex < 0 || stepIndex >= mapData.steps.length) {
          console.warn(`Key${keyNum} out of bounds for layout script.`);
          continue;
        }

        const targetPos = mapData.steps[stepIndex];

        // Calculate delay relative to previous action
        const delay = Math.max(0, note.time - previousTime);

        newSteps.push({
          id: uuidv4(),
          x: targetPos.x,
          y: targetPos.y,
          delay: delay, // Store delay BEFORE this step
          type: 'click',
          repeat: 1,
          repeatInterval: 100
        });

        previousTime = note.time;
      }

      if (newSteps.length === 0) {
        alert("No valid notes converted.");
        return;
      }

      // 4. Create Script
      const newScript: ClickScript = {
        metadata: {
          id: uuidv4(),
          name: `Converted: ${songEntry.name || 'Song'}`,
          version: '1.0',
          loop: false,
          loopCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          duration: previousTime + 1000 // Buffer at end
        },
        steps: newSteps
      };

      // 5. Save
      saveScriptToStorage(newScript);
      loadSavedScriptsList();
      alert(`Success! Created script "${newScript.metadata.name}" with ${newSteps.length} steps.`);

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
        if (window.Android?.dispatchRecordedGesture) {
          window.Android.dispatchRecordedGesture(x, y);
        }

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
        if (window.Android?.dispatchRecordedSwipe) {
          window.Android.dispatchRecordedSwipe(x, y, endX, endY, swipeDuration);
        }

        return { ...prev, steps: [...prev.steps, newStep] };
      });
    }
  };

  const toggleRecord = () => {
    if (mode === AppMode.RECORDING) {
      // STOP RECORDING
      setScript(prev => {
        const now = Date.now();

        // Calculate steps duration based on LATEST script state (prev)
        let stepsDuration = 0;
        prev.steps.forEach(s => {
          stepsDuration += s.delay;
          if (s.repeat > 1) stepsDuration += (s.repeat - 1) * s.repeatInterval;
        });

        // Tail is time from last click to now
        // lastActionTimeRef is mutable and holds the timestamp of the last click (or start if no clicks)
        const tail = Math.max(0, now - lastActionTimeRef.current);
        const totalDuration = stepsDuration + tail;

        const finalScript = {
          ...prev,
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
      if (window.Android?.setRecordingMode) {
        window.Android.setRecordingMode(false);
      }

      // 錄製結束：還原成只覆蓋 HUD 的觸控區
      const r = hudRectRef.current;
      updateAndroidOverlayRect(r.x, r.y, r.width, r.height);
    } else {
      // START RECORDING
      // 通知 Android 開始錄製穿透 tap
      if (window.Android?.setRecordingMode) {
        window.Android.setRecordingMode(true);
      }

      // 強制同步 HUD rect → Android（screen px），確保錄製啟動時排除區域立即有效
      if (window.Android?.setHudRect) {
        const dpr = window.devicePixelRatio || 1;
        const r = hudRectRef.current;
        // 展開時加 extraBottom，與 handleHudRectChange 一致
        const extraH = r.isCollapsed ? 0 : 24;
        window.Android.setHudRect(
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
    setMode(AppMode.IDLE);
    setSessionStartTime(null);
  }, []);

  const playStep = useCallback((index: number, subRepeatIndex: number = 0) => {
    if (!isPlayingRef.current) return;
    const speed = playbackSpeedRef.current;

    // SCRIPT ENDED
    if (index >= script.steps.length) {
      // Calculate remaining duration (tail)
      let totalTimeUsed = 0;
      script.steps.forEach(s => {
        totalTimeUsed += s.delay;
        if (s.repeat > 1) {
          totalTimeUsed += (s.repeat - 1) * s.repeatInterval;
        }
      });

      const recordedDuration = script.metadata.duration || 0;
      // Adjust tail for speed
      const tailDelay = Math.max(500, (recordedDuration - totalTimeUsed)) / speed;

      if (script.metadata.loop) {
        // Check loop count: 0 = infinite, N = loop N times
        const maxLoops = script.metadata.loopCount || 0;
        loopCounterRef.current += 1;

        if (maxLoops > 0 && loopCounterRef.current >= maxLoops) {
          // Reached max loop count, stop
          playbackTimeoutRef.current = window.setTimeout(() => {
            stopPlayback();
          }, tailDelay);
        } else {
          playbackTimeoutRef.current = window.setTimeout(() => {
            setSessionStartTime(Date.now()); // Reset timer for visual loop
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
        if (window.Android?.performSwipe) {
          window.Android.performSwipe(step.x, step.y, step.endX, step.endY, swipeDur);
        } else if (window.Android?.swipe) {
          // 後備：舊版直接 pixel swipe
          const dpr = window.devicePixelRatio || 1;
          window.Android.swipe(step.x * dpr, step.y * dpr, step.endX * dpr, step.endY * dpr, swipeDur);
        }
      } else {
        // Tap gesture — 使用 performClick（有 ratio mapping）
        if (window.Android?.performClick) {
          window.Android.performClick(step.x, step.y);
        }
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
    if (typeof window !== 'undefined' && (window as any).Android) {
      const androidBridge = (window as any).Android as { saveFile?: (name: string, content: string) => void };
      if (androidBridge && typeof androidBridge.saveFile === 'function') {
        androidBridge.saveFile(fileName, jsonContent);
        return;
      }
    }

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
  let cumulativeTime = 0;
  for (const s of script.steps) {
    if (s.id === selectedStepId) {
      cumulativeTime += s.delay;
      break;
    }
    cumulativeTime += s.delay;
    if (s.repeat > 1) {
      cumulativeTime += (s.repeat - 1) * s.repeatInterval;
    }
  }

  const selectedStep = script.steps.find(s => s.id === selectedStepId);
  const selectedStepIndex = script.steps.findIndex(s => s.id === selectedStepId);

  const handleHudRectChange = (x: number, y: number, width: number, height: number, isCollapsed: boolean) => {
    const isEditing = mode === AppMode.IDLE && selectedStepId !== null;
    hudRectRef.current = { x, y, width, height, isCollapsed };

    // 回報 HUD 矩形給 Android，錄製時排除此區域不穿透 tap
    // 轉換 CSS px → 螢幕 px
    if (window.Android?.setHudRect) {
      const dpr = window.devicePixelRatio || 1;
      window.Android.setHudRect(x * dpr, y * dpr, width * dpr, height * dpr);
    }

    // 非錄製狀態下，用 HUD 矩形當作觸控 overlay；錄製時 overlay 由 toggleRecord 控制
    if (mode !== AppMode.RECORDING && !isEditing) {
      if (isCollapsed) {
        // 縮小成園點時，給 HUD 周圍多一圈 padding，避免因座標/尺寸誤差導致圓點點不到
        const padding = 16;
        const ox = Math.max(0, x - padding);
        const oy = Math.max(0, y - padding);
        const ow = width + padding * 2;
        const oh = height + padding * 2;
        updateAndroidOverlayRect(ox, oy, ow, oh);
      } else {
        // 展開狀態下，額外在下方多給一些高度，確保底部按鈕也在觸控 overlay 範圍內
        const extraBottom = 24; // dp / CSS px，實際會乘上 density
        updateAndroidOverlayRect(x, y, width, height + extraBottom);
      }
    }
  };

  useEffect(() => {
    const isEditing = mode === AppMode.IDLE && selectedStepId !== null;

    if (mode === AppMode.RECORDING || isEditing) {
      if (typeof window !== 'undefined') {
        const w = window.innerWidth || hudRectRef.current.width;
        const h = window.innerHeight || hudRectRef.current.height;
        updateAndroidOverlayRect(0, 0, w, h);
      } else {
        updateAndroidOverlayRect(0, 0, hudRectRef.current.width, hudRectRef.current.height);
      }
    } else {
      const { x, y, width, height, isCollapsed } = hudRectRef.current;
      if (isCollapsed) {
        const padding = 16;
        const ox = Math.max(0, x - padding);
        const oy = Math.max(0, y - padding);
        const ow = width + padding * 2;
        const oh = height + padding * 2;
        updateAndroidOverlayRect(ox, oy, ow, oh);
      } else {
        const extraBottom = 24;
        updateAndroidOverlayRect(x, y, width, height + extraBottom);
      }
    }
  }, [mode, selectedStepId]);

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
          activePlaybackStepIndex={activePlaybackStepIndex}
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
          onUpdate={handleStepUpdate}
          onClose={() => setSelectedStepId(null)}
          onDelete={handleStepDelete}
          onDuplicate={handleStepDuplicate}
        />
      )}
    </div>
  );
}

export default App;