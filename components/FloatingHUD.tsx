import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { AppMode, ClickScript, ClickStep, SavedScriptSummary } from '../types';
import { Play, Square, Circle, Save, Upload, Trash2, GripHorizontal, MousePointer2, Minimize2, ChevronLeft, Plus, Folder, FileJson, CornerRightDown, Check, Music, ArrowRightLeft, FileText, Gauge, Power, Copy } from 'lucide-react';
import { SafeNumberInput } from './SafeNumberInput';
import { MinimizedHUD } from './MinimizedHUD';
import { PlaybackTimeline } from './PlaybackTimeline';
import { formatTime, parseFormattedTime } from '../utils/format';
import { blurOnEnter, stopTouchPropagation, handleInputFocus, handleInputBlur } from '../utils/input';
import {
  reportOverlayRect,
  openFilePicker,
  isAndroidOverlay,
} from '../utils/android';
import { clampToViewport, getCollapsedSize } from '../utils/geometry';
import { stepTypeLabel, getTotalStepsDuration, getStepCumulativeTimes } from '../utils/timeline';
import { useLiveDuration } from '../hooks/useLiveDuration';
import { useWindowDrag, getDragClientXY } from '../hooks/useWindowDrag';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { useTranslation } from '../utils/i18n';

interface FloatingHUDProps {
  mode: AppMode;
  script: ClickScript;
  savedScripts: SavedScriptSummary[];
  isScriptLoaded: boolean;
  showSaveFeedback?: boolean;
  sessionStartTime: number | null;
  isDraggingPoint?: boolean;

  // Actions
  onRecordToggle: () => void;
  onPlayToggle: () => void;
  onClear: () => void; // Clear current steps
  onDuplicateStep?: () => void; // Duplicate selected step

  // Storage Actions
  onSaveLocal: () => void; // Save to local storage
  onExport: () => void; // Export to file
  onLoadFile: (file: File) => void; // Import from file
  onLoadLocal: (id: string) => void; // Load from local storage
  onCreateNew: () => void;
  onDeleteLocal: (id: string) => void;
  onCloseScript: () => void; // Go back to menu
  onExitApp: () => void; // Close the app

  // Converter
  onConvertSheet: (songFile: File, mapFile: File) => void;

  // Script Config
  setLoop: (loop: boolean) => void;
  setLoopCount: (count: number) => void;
  setScriptName: (name: string) => void;
  setScriptDuration?: (durationMs: number) => void;

  // Step Interaction
  onSelectStep: (id: string | null) => void;
  selectedStepId: string | null;

  // Playback Control
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  // Layout sync back to App / Android
  onRectChange?: (x: number, y: number, width: number, height: number, isCollapsed: boolean) => void;
  // Playback progress (由 App 傳入，避免 HUD 自己高頻計算)
  completedLoops?: number;
  activePlaybackStepIndex?: number | null;
  // 本輪起始步驟（從中間開始播放時，首步觸發前的顯示基準）
  playbackStartIndex?: number;
}

interface LiveDurationDisplayProps {
  sessionStartTime: number | null;
  isTimed: boolean;
  totalDuration: number;
}

interface EditableDurationDisplayProps {
  /** 顯示用總長（已除速 ms） */
  totalDuration: number;
  playbackSpeed: number;
  /** 最低允許 base ms（未除速）＝ 全部步驟耗時（含 repeat 展開），避免尾段被裁掉 */
  minBaseMs: number;
  /** commit 回傳 base ms（未除速），寫入 metadata.duration */
  onCommit: (baseMs: number) => void;
}

/** 閒置時可編輯的總時長：可直接輸入秒數或分:秒，讓總長不必綁定錄製當下長度 */
const EditableDurationDisplay: React.FC<EditableDurationDisplayProps> = React.memo(({
  totalDuration,
  playbackSpeed,
  minBaseMs,
  onCommit,
}) => {
  const [localStr, setLocalStr] = useState('');
  const isFocusedRef = useRef(false);
  const safeSpeed = playbackSpeed > 0 ? playbackSpeed : 1;
  const minDisplay = minBaseMs / safeSpeed;

  // 非聚焦時同步外部值（例如載入腳本、步驟編輯導致總長變化）
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalStr(formatTime(totalDuration));
    }
  }, [totalDuration]);

  const handleBlur = (e?: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    handleInputBlur();
    const raw = e?.target?.value ?? localStr;
    const newMs = parseFormattedTime(raw);
    if (newMs !== null) {
      const baseMs = Math.max(minBaseMs, Math.round(newMs * safeSpeed));
      onCommit(baseMs);
      setLocalStr(formatTime(baseMs / safeSpeed));
    } else {
      // 無效輸入：還原顯示值
      setLocalStr(formatTime(totalDuration));
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={localStr}
      onChange={(e) => setLocalStr(e.target.value)}
      onFocus={(e) => {
        isFocusedRef.current = true;
        handleInputFocus(e);
      }}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          isFocusedRef.current = false;
          handleBlur();
          blurOnEnter(e);
        }
      }}
      onTouchStart={stopTouchPropagation}
      aria-label="總時長"
      title={`最低 ${formatTime(minDisplay)}（最後一步含重複觸發時刻）`}
      className="w-full bg-transparent text-right text-lg font-mono text-white font-semibold tracking-widest outline-none border-b border-transparent focus:border-blue-500 select-text"
      placeholder="00:00.000"
      style={{ touchAction: 'manipulation' }}
    />
  );
});

const LiveDurationDisplay: React.FC<LiveDurationDisplayProps> = React.memo(({
  sessionStartTime,
  isTimed,
  totalDuration,
}) => {
  const liveDuration = useLiveDuration(sessionStartTime, isTimed, 1000);
  const displayDuration = isTimed ? liveDuration : totalDuration;
  return (
    <div className="text-lg font-mono text-white font-semibold">
      {formatTime(displayDuration)}
    </div>
  );
});

interface MemoStepRowProps {
  step: ClickStep;
  idx: number;
  isSelected: boolean;
  displayTime: string;
  onSelect: (id: string) => void;
  onDuplicate?: () => void;
  duplicateTitle: string;
  setRef: (el: HTMLDivElement | null) => void;
}

const MemoStepRow: React.FC<MemoStepRowProps> = React.memo(({
  step,
  idx,
  isSelected,
  displayTime,
  onSelect,
  onDuplicate,
  duplicateTitle,
  setRef,
}) => {
  return (
    <div
      ref={setRef}
      onClick={() => onSelect(step.id)}
      className={`relative p-3 cursor-pointer rounded mb-1 border ${isSelected
        ? 'bg-blue-600 border-blue-400 text-white'
        : 'bg-transparent border-white/5 text-gray-300'
        }`}
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <div className="flex items-center gap-2 w-24">
          <span className={`font-mono text-lg opacity-70 ${isSelected ? 'text-blue-200' : 'text-gray-500'}`}>
            #{idx + 1}
          </span>
          <span className="font-semibold text-lg flex items-center gap-1">
            <span>{stepTypeLabel(step.type)}</span>
            {step.repeat > 1 && (
              <span className="text-xs font-black text-amber-400 font-mono">×{step.repeat}</span>
            )}
          </span>
        </div>

        <div className="flex justify-end pr-4">
          <span className={`font-mono text-[12px] font-black tabular-nums ${isSelected ? 'text-white' : 'text-gray-200'}`}>
            {displayTime}
          </span>
        </div>

        <div className={`w-24 text-right font-mono text-[10px] flex items-center justify-end gap-1 ${isSelected ? 'text-blue-200' : 'text-gray-500'}`}>
          {isSelected && onDuplicate && (
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
              className="p-1 rounded text-blue-200"
              title={duplicateTitle}
            >
              <Copy size={12} />
            </button>
          )}
          {Math.round(step.x)},{Math.round(step.y)}
        </div>
      </div>
    </div>
  );
});

export const FloatingHUD: React.FC<FloatingHUDProps> = ({
  mode,
  script,
  savedScripts,
  isScriptLoaded,
  showSaveFeedback,
  sessionStartTime,
  isDraggingPoint = false,
  onRecordToggle,
  onPlayToggle,
  onClear,
  onSaveLocal,
  onExport,
  onLoadFile,
  onLoadLocal,
  onCreateNew,
  onDeleteLocal,
  onCloseScript,
  onExitApp,
  onConvertSheet,
  setLoop,
  setLoopCount,
  setScriptName,
  setScriptDuration,
  onSelectStep,
  selectedStepId,
  playbackSpeed,
  setPlaybackSpeed,
  onRectChange,
  onDuplicateStep,
  completedLoops = 0,
  activePlaybackStepIndex = null,
  playbackStartIndex = 0
}) => {
  const { t, lang, toggleLanguage } = useTranslation();

  // Window State
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [size, setSize] = useState({ width: 380, height: 500 }); // Slightly taller default
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAndroidBridge, setIsAndroidBridge] = useState(() => isAndroidOverlay());

  // 編輯步驟時自動縮小主視窗，露出畫布與底層畫面
  useEffect(() => {
    if (selectedStepId !== null) {
      setIsCollapsed(true);
    }
  }, [selectedStepId]);

  // Dragging State
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Converter UI State
  const [isConverterOpen, setIsConverterOpen] = useState(false);
  const [songFile, setSongFile] = useState<File | null>(null);
  const [mapFile, setMapFile] = useState<File | null>(null);

  // Script Delete Confirmation State
  const [scriptToDelete, setScriptToDelete] = useState<{ id: string; name: string } | null>(null);

  // Refs
  const hasMovedRef = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  // 上次已同步給 Android 的矩形，避免每 render 都觸發 WindowManager 更新（發燙主因之一）
  const lastSentRectRef = useRef<string>('');
  // 步驟列表項目節點（時間軸跳轉時平滑捲動定位）
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  // 低頻計時：僅縮小 HUD 需要即時秒數，展開狀態用獨立組件隔絕 re-render
  const isTimed = mode === AppMode.RECORDING || mode === AppMode.PLAYING;
  const liveDuration = useLiveDuration(sessionStartTime, isTimed && isCollapsed, 1000);

  // 播放進度 / 下一步倒數（縮小 pill 與展開時間軸共用）
  const progress = usePlaybackProgress({
    mode,
    steps: script.steps,
    recordedDuration: script.metadata.duration,
    playbackSpeed,
    liveDuration,
    activePlaybackStepIndex,
    startIndex: playbackStartIndex,
  });

  // 閒置時顯示的總長（memo 化，避免每 tick 重算）
  const totalStepsDuration = useMemo(
    () => getTotalStepsDuration(script.steps),
    [script.steps]
  );
  const safeSpeedForTotal = playbackSpeed > 0 ? playbackSpeed : 1;
  const totalDisplayDuration = Math.max(script.metadata.duration || 0, totalStepsDuration) / safeSpeedForTotal;

  // 步驟列表顯示用累計時刻（取代 render 中 mutate 變數）
  const cumulative = useMemo(() => getStepCumulativeTimes(script.steps), [script.steps]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const isPortrait = viewportH >= viewportW;
    const targetW = Math.round(viewportW * 0.75);
    const targetH = Math.round(viewportH * (isPortrait ? 0.65 : 0.9));

    setSize(prev => {
      if (prev.width !== 380 || prev.height !== 500) return prev;
      return {
        width: Math.max(250, targetW),
        height: Math.max(200, targetH)
      };
    });

    // 初始位置也要 clamp 到視窗內，避免 HUD 超出畫面
    setPosition(prev => {
      const maxX = Math.max(0, viewportW - Math.max(250, targetW));
      const maxY = Math.max(0, viewportH - Math.max(200, targetH));
      return {
        x: Math.min(prev.x, maxX),
        y: Math.min(prev.y, maxY)
      };
    });

    setIsAndroidBridge(isAndroidOverlay());
  }, []);

  // 直/橫旋轉自適應：視窗尺寸變化時把 HUD 縮放＋位置 clamp 回可視區內。
  // 之前只有 mount 時算一次，橫向開 App（寬 700+）轉直向（寬 360）會整片超出畫面無法操作。
  // 這裡只做「縮小以適應」，不自動放大，保留使用者手動調整的尺寸。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onViewportChange = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setSize(prev => {
        const maxW = Math.max(0, vw - 16);
        const maxH = Math.max(0, vh - 16);
        const minW = Math.min(250, maxW);
        const minH = Math.min(200, maxH);
        const w = Math.min(Math.max(prev.width, minW), Math.max(minW, maxW));
        const h = Math.min(Math.max(prev.height, minH), Math.max(minH, maxH));
        if (w === prev.width && h === prev.height) return prev;
        return { width: Math.round(w), height: Math.round(h) };
      });
      // 先保證 header（48px）一定在畫面內可拖曳；完整尺寸的精確 clamp 由下一個 [size] effect 補上
      setPosition(prev => {
        const maxX = Math.max(0, vw - 48);
        const maxY = Math.max(0, vh - 48);
        const nx = Math.min(Math.max(0, prev.x), maxX);
        const ny = Math.min(Math.max(0, prev.y), maxY);
        if (nx === prev.x && ny === prev.y) return prev;
        return { x: nx, y: ny };
      });
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
    };
  }, []);

  // 尺寸變化後再用完整寬高精確 clamp 位置，避免縮放後右/下緣仍在畫面外
  useEffect(() => {
    setPosition(prev => {
      const hasSteps = script.steps.length > 0;
      const currentW = isCollapsed ? getCollapsedSize(mode, hasSteps).width : size.width;
      const currentH = isCollapsed ? getCollapsedSize(mode, hasSteps).height : size.height;
      const clamped = clampToViewport(prev.x, prev.y, currentW, currentH);
      if (clamped.x === prev.x && clamped.y === prev.y) return prev;
      return clamped;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, isCollapsed, mode, script.steps.length]);

  // Register global callback for native FilePickerActivity -> JS bridge
  useEffect(() => {
    if (typeof window === 'undefined' || !isAndroidBridge) return;

    const handler = (slot: string, fileName: string, content: string) => {
      try {
        const safeName = fileName || 'selected.json';
        if (slot === 'import') {
          const file = new File([content], safeName, { type: 'application/json' });
          onLoadFile(file);
        } else if (slot === 'song') {
          const file = new File([content], safeName, { type: 'application/json' });
          setSongFile(file);
        } else if (slot === 'layout') {
          const file = new File([content], safeName, { type: 'application/json' });
          setMapFile(file);
        }
      } catch (e) {
        console.error('Failed to handle picked file', e);
      }
    };

    window.__omniclickOnFilePicked = handler;

    return () => {
      if (window.__omniclickOnFilePicked === handler) {
        window.__omniclickOnFilePicked = undefined;
      }
    };
  }, [isAndroidBridge, onLoadFile]);

  // --- SYNC HUD RECT WITH APP / ANDROID (去重，避免計時重繪時高頻 IPC 造成發燙) ---
  useEffect(() => {
    // 縮小時實際尺寸依狀態而異，需與 MinimizedHUD 一致，否則觸控層對不準
    let currentWidth = size.width;
    let currentHeight = size.height;
    if (isCollapsed) {
      const hasSteps = script.steps.length > 0;
      const collapsed = getCollapsedSize(mode, hasSteps);
      currentWidth = collapsed.width;
      currentHeight = collapsed.height;
    }
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const w = Math.round(currentWidth);
    const h = Math.round(currentHeight);

    const key = `${x},${y},${w},${h},${isCollapsed}`;
    if (lastSentRectRef.current === key) return; // 相同矩形不重送
    lastSentRectRef.current = key;

    if (onRectChange) {
      onRectChange(x, y, w, h, isCollapsed);
    } else {
      reportOverlayRect(x, y, w, h);
    }
  }, [position, size, isCollapsed, mode, onRectChange]);

  // --- Window Drag Logic (Mouse) ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isResizing) return;
    setIsDragging(true);
    hasMovedRef.current = false;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  // --- Window Drag Logic (Touch) ---
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isResizing) return;
    setIsDragging(true);
    hasMovedRef.current = false;
    const touch = e.touches[0];
    dragStart.current = { x: touch.clientX - position.x, y: touch.clientY - position.y };
  };

  // --- Window Resize Logic (Mouse) ---
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.width,
      h: size.height
    };
  };

  // --- Window Resize Logic (Touch) ---
  const handleResizeTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    const touch = e.touches[0];
    resizeStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      w: size.width,
      h: size.height
    };
  };

  // 視窗拖曳/縮放：mouse / touch 共用全域監聽（hooks/useWindowDrag）
  useWindowDrag(isDragging || isResizing, (e) => {
    const { clientX, clientY } = getDragClientXY(e);

    if (isDragging) {
      const newX = clientX - dragStart.current.x;
      const newY = clientY - dragStart.current.y;
      const hasSteps = script.steps.length > 0;
      const currentWidth = isCollapsed ? getCollapsedSize(mode, hasSteps).width : size.width;
      const currentHeight = isCollapsed ? getCollapsedSize(mode, hasSteps).height : size.height;
      const clamped = clampToViewport(newX, newY, currentWidth, currentHeight);

      if (!hasMovedRef.current) {
        const dx = Math.abs(clamped.x - position.x);
        const dy = Math.abs(clamped.y - position.y);
        if (dx > 3 || dy > 3) hasMovedRef.current = true;
      }
      setPosition({ x: clamped.x, y: clamped.y });
    }

    if (isResizing) {
      const dx = clientX - resizeStart.current.x;
      const dy = clientY - resizeStart.current.y;
      setSize({
        width: Math.max(250, resizeStart.current.w + dx),
        height: Math.max(200, resizeStart.current.h + dy)
      });
    }
  }, () => {
    setIsDragging(false);
    setIsResizing(false);
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file);
  };

  const handleConverter = () => {
    if (songFile && mapFile) {
      onConvertSheet(songFile, mapFile);
      // Reset
      setSongFile(null);
      setMapFile(null);
      setIsConverterOpen(false);
    }
  };

  // 時間軸跳轉：選取該步驟（IDLE 會開啟編輯器）＋列表平滑捲動過去，方便後續編輯
  const handleJumpToStep = useCallback((id: string) => {
    onSelectStep(id);
    requestAnimationFrame(() => {
      itemRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [onSelectStep]);

  // --- Render Minimized State（本體見 components/MinimizedHUD） ---
  if (isCollapsed) {
    const status = mode === AppMode.PLAYING ? 'playing' : mode === AppMode.RECORDING ? 'recording' : 'idle';
    const isInfiniteLoop = !!script.metadata.loop && (script.metadata.loopCount || 0) === 0;
    // 目前執行中的步驟（首步未觸發前以後備起始步驟顯示，避免誤顯示 #1）
    const curIdx = activePlaybackStepIndex !== null && activePlaybackStepIndex !== undefined
      ? activePlaybackStepIndex
      : (mode === AppMode.PLAYING ? Math.min(Math.max(0, playbackStartIndex), Math.max(0, script.steps.length - 1)) : null);
    const title = mode === AppMode.PLAYING
      ? (script.metadata.loop
        ? (isInfiniteLoop ? t('infiniteLoopStatus', { count: completedLoops }) : t('loopStatus', { current: completedLoops, total: script.metadata.loopCount }))
        : (curIdx !== null ? `${t('steps')} ${curIdx + 1} / ${script.steps.length}` : `${t('steps')} - / ${script.steps.length}`))
      : '';
    // 縮小 pill 只顯示下一步＋剩餘整秒（拿掉已執行步驟/模式，再長也不會被省略號裁掉）
    const sub = mode === AppMode.PLAYING
      ? (progress.nextStepIdx >= 0
        ? `→ #${progress.nextStepIdx + 1} · ${Math.round(progress.nextInMs / 1000)}s`
        : `${t('roundEnding', { pct: Math.round(progress.progress * 100) })}`)
      : '';
    return (
      <MinimizedHUD
        status={status}
        position={position}
        title={title}
        sub={sub}
        progress={progress.progress}
        elapsedSec={Math.floor(liveDuration / 1000)}
        draggedRef={hasMovedRef}
        isDraggingPoint={isDraggingPoint}
        hasSteps={script.steps.length > 0}
        selectedStepId={selectedStepId}
        onExpand={() => setIsCollapsed(false)}
        onPlay={onPlayToggle}
        onStopActive={mode === AppMode.PLAYING ? onPlayToggle : onRecordToggle}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      />
    );
  }

  // --- Main Render (省電：實色背景無模糊、無過渡動畫) ---
  return (
    <div
      className={`fixed z-50 rounded-xl text-white flex flex-col pointer-events-auto transition-opacity duration-150 ${
        isDraggingPoint ? 'opacity-20 pointer-events-none' : 'opacity-100'
      }`}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height, background: 'rgba(30,30,30,0.96)', border: '1px solid rgba(255,255,255,0.15)' }}
    >
      {/* Header / Drag Handle */}
      <div
        className="h-10 rounded-t-xl flex items-center justify-between px-3 cursor-move shrink-0 touch-none"
        style={{ background: 'rgba(255,255,255,0.08)' }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-300 pointer-events-none">
          {isScriptLoaded ? (
            <button
              onClick={(e) => { e.stopPropagation(); onCloseScript(); }}
              className="p-1 rounded flex items-center gap-1 pointer-events-auto text-gray-300"
            >
              <ChevronLeft size={14} />
              <span>{t('menu')}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <MousePointer2 size={14} />
              <span>OMNICLICK</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* 語言切換按鈕 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleLanguage();
            }}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-gray-200 pointer-events-auto font-mono mr-1"
            title="Language / 語言切換"
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExitApp();
            }}
            className="text-red-400 p-1 rounded pointer-events-auto mr-1"
            title={t('exitApp')}
          >
            <Power size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIsCollapsed(true); }}
            className="text-gray-400 p-1 rounded pointer-events-auto"
            onTouchEnd={(e) => { e.stopPropagation(); setIsCollapsed(true); }}
          >
            <Minimize2 size={14} />
          </button>
          <GripHorizontal size={16} className="text-gray-400" />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden overflow-y-auto">

        {!isScriptLoaded ? (
          // === LIST VIEW ===
          <div className="flex flex-col h-full relative">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                <Folder size={16} className="text-blue-400" /> {t('savedScripts')}
              </h2>
              <button
                onClick={onCreateNew}
                className="bg-blue-600 text-white text-[12px] px-2 py-1 rounded flex items-center gap-1"
              >
                <Plus size={14} /> {t('newScript')}
              </button>
            </div>

            <div className={`flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 space-y-2 transition-[margin] duration-150 ${isConverterOpen ? 'mb-28' : 'mb-8'}`}>
              {savedScripts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-gray-500 text-[12px] text-center border-2 border-dashed border-white/5 rounded-lg">
                  <p>{t('noSavedScripts')}</p>
                </div>
              ) : (
                savedScripts.map(s => (
                  <div
                    key={s.id}
                    onClick={() => onLoadLocal(s.id)}
                    className="group bg-white/5 border border-white/5 rounded-lg p-3 cursor-pointer relative hover:bg-white/10 transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div className="font-medium text-lg text-gray-200 truncate pr-6">{s.name}</div>
                      <div className="text-[10px] text-gray-500">{new Date(s.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1 flex gap-2">
                      <span>{s.stepCount} {t('steps')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setScriptToDelete({ id: s.id, name: s.name });
                      }}
                      className="absolute bottom-2 right-2 text-gray-400 hover:text-red-400 hover:bg-red-500/20 p-1.5 rounded transition-all pointer-events-auto"
                      title={t('delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}

              {/* Fixed File Upload for Mobile: Overlay Input */}
              <div className="relative mt-2 pt-2 border-t border-white/10">
                <div
                  className="flex items-center justify-center gap-2 py-2 text-[12px] text-gray-400 hover:text-gray-200 cursor-pointer transition-colors"
                  onClick={() => {
                    if (isAndroidBridge) openFilePicker('import');
                  }}
                >
                  <Upload size={14} /> {t('import')}
                </div>
                {!isAndroidBridge && (
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".json"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                )}
              </div>
            </div>

            {/* ADVANCED TOOLS SECTION: 進階光遇琴譜轉換（緊湊設計） */}
            <div className="absolute bottom-0 left-0 right-0 bg-[#1e293b]/95 backdrop-blur-sm rounded-t-xl border-t border-blue-500/30 overflow-hidden shadow-lg transition-all duration-200">
              {!isConverterOpen ? (
                <button
                  type="button"
                  onClick={() => setIsConverterOpen(true)}
                  className="w-full py-1.5 px-3 flex items-center justify-between text-blue-300 hover:text-blue-200 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <ArrowRightLeft size={13} /> {t('sheetConverterTitle')}
                  </div>
                  <span className="text-[10px] text-blue-400/80 bg-blue-500/10 px-1.5 py-0.5 rounded font-mono">▲</span>
                </button>
              ) : (
                <div className="p-2.5 bg-gray-900 border-t border-white/10">
                  <div className="flex justify-between items-center mb-1.5">
                    <h3 className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                      <ArrowRightLeft size={13} /> {t('sheetConverterTitle')}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsConverterOpen(false)}
                      className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-white/10 transition-colors"
                      title={t('close')}
                    >
                      <Minimize2 size={13} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {/* 兩欄並排：樂譜來源與按鍵佈局 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-0.5 relative">
                        <label className="text-[9px] text-gray-400 uppercase tracking-wide truncate">{t('songSource')}</label>
                        <div
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] border cursor-pointer select-none transition-colors ${
                            songFile ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'bg-black/30 border-gray-700 hover:border-gray-500 text-gray-400'
                          }`}
                          onClick={() => {
                            if (isAndroidBridge) openFilePicker('song');
                          }}
                        >
                          <Music size={12} className="shrink-0" />
                          <span className="truncate">{songFile ? songFile.name : t('selectSongFile')}</span>
                        </div>
                        {!isAndroidBridge && (
                          <input
                            type="file"
                            accept=".txt,.json,.mid,.midi"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => setSongFile(e.target.files?.[0] || null)}
                          />
                        )}
                      </div>

                      <div className="flex flex-col gap-0.5 relative">
                        <label className="text-[9px] text-gray-400 uppercase tracking-wide truncate">{t('layoutScript')}</label>
                        <div
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] border cursor-pointer select-none transition-colors ${
                            mapFile ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'bg-black/30 border-gray-700 hover:border-gray-500 text-gray-400'
                          }`}
                          onClick={() => {
                            if (isAndroidBridge) openFilePicker('layout');
                          }}
                        >
                          <FileText size={12} className="shrink-0" />
                          <span className="truncate">{mapFile ? mapFile.name : t('selectLayoutScript')}</span>
                        </div>
                        {!isAndroidBridge && (
                          <input
                            type="file"
                            accept=".json"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => setMapFile(e.target.files?.[0] || null)}
                          />
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleConverter}
                      disabled={!songFile || !mapFile}
                      className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-xs font-semibold shadow transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Check size={12} />
                      {t('convertAndSave')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          // === EDITOR VIEW ===
          <div className="flex flex-col h-full">
            {/* Script Name Input（中文選字不閃退：觸控不冒泡、鍵盤穿透由原生層保證） */}
            <input
              type="text"
              value={script.metadata.name}
              onChange={(e) => setScriptName(e.target.value)}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              onKeyDown={blurOnEnter}
              onTouchStart={stopTouchPropagation}
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="bg-transparent border-b border-white/10 focus:border-blue-500 text-base font-bold text-white px-1 py-2 mb-3 outline-none w-full select-text"
              placeholder={t('scriptNamePlaceholder')}
              style={{ touchAction: 'manipulation' }}
            />

            {/* Stats Bar */}
            <div className="flex justify-between items-end border-b border-white/10 pb-2 mb-2 shrink-0">
              <div className="flex flex-col gap-2">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">{t('status')}</div>
                </div>

                {/* Playback Speed Slider */}
                <div className="flex flex-col gap-1 w-32 border-t border-white/10 pt-2">
                  <label className="text-[12px] text-gray-400 uppercase tracking-wider flex justify-between items-center">
                    <div className="flex items-center gap-1"><Gauge size={12} /> {t('playSpeed')}</div>
                    <span className="text-blue-300 font-mono">{playbackSpeed.toFixed(1)}x</span>
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="3.0"
                    step="0.1"
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                    className="h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500 w-full"
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <div className="text-right min-w-[80px]">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">{t('duration')}</div>
                  {isTimed ? (
                    <LiveDurationDisplay
                      sessionStartTime={sessionStartTime}
                      isTimed={isTimed}
                      totalDuration={totalDisplayDuration}
                    />
                  ) : (
                    <EditableDurationDisplay
                      totalDuration={totalDisplayDuration}
                      playbackSpeed={playbackSpeed}
                      minBaseMs={totalStepsDuration}
                      onCommit={setScriptDuration ?? (() => {})}
                    />
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">{t('steps')}</div>
                  <div className="text-lg font-mono text-gray-200">{script.steps.length}</div>
                </div>
              </div>
            </div>

            <PlaybackTimeline
              mode={mode}
              steps={script.steps}
              progress={progress}
              activePlaybackStepIndex={activePlaybackStepIndex}
              startIndex={playbackStartIndex}
              loop={script.metadata.loop}
              loopCount={script.metadata.loopCount}
              completedLoops={completedLoops}
              onJumpToStep={handleJumpToStep}
            />

            {/* Primary Actions */}
            <div className="grid grid-cols-2 gap-2 shrink-0">
              <button
                onClick={() => {
                  // 如果當前 "不是" 錄影模式 (代表即將開始錄影)，則縮小視窗
                  if (mode !== AppMode.RECORDING) {
                    setIsCollapsed(true);
                  }
                  onRecordToggle(); // 執行原本的錄影動作
                }}
                className={`flex items-center justify-center gap-2 px-1 py-2 rounded-lg font-medium h-max ${mode === AppMode.RECORDING
                  ? 'bg-red-500/80 text-white'
                  : 'bg-white/10 text-gray-200'
                  }`}
              >
                {mode === AppMode.RECORDING ? <Square size={16} fill="currentColor" /> : <Circle size={16} fill="currentColor" className="text-red-500" />}
                {mode === AppMode.RECORDING ? t('stop') : t('record')}
              </button>

              <button
                onClick={() => {
                  // 如果目前不是播放模式 (代表即將開始播放)，則縮小視窗
                  if (mode !== AppMode.PLAYING) {
                    setIsCollapsed(true);
                  }
                  onPlayToggle(); // 執行原本的播放動作
                }}
                disabled={script.steps.length === 0 || mode === AppMode.RECORDING}
                className={`flex items-center justify-center gap-2 px-1 py-2 rounded-lg font-medium h-max ${mode === AppMode.PLAYING
                  ? 'bg-amber-500/80 text-white'
                  : 'bg-white/10 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed'
                  }`}
              >
                {mode === AppMode.PLAYING ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                {mode === AppMode.PLAYING ? t('stop') : t('play')}
              </button>
            </div>

            {/* Loop Option（次數可完全刪除，失焦空值帶回 0=無限） */}
            <div className="flex items-center justify-between px-1 py-2 shrink-0 gap-2">
              <label className="flex items-center gap-2 text-[12px] text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={script.metadata.loop}
                  onChange={(e) => setLoop(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-offset-gray-900"
                />
                {t('loop')}
              </label>
              {script.metadata.loop && (
                <div className="flex items-center gap-1">
                  <SafeNumberInput
                    value={script.metadata.loopCount}
                    defaultValue={0}
                    min={0}
                    onCommit={(n) => setLoopCount(n)}
                    ariaLabel="循環次數，0為無限"
                    className="w-16 bg-black/30 border border-gray-600 rounded px-2 py-0.5 text-xs text-white focus:border-blue-500 outline-none text-center"
                  />
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">{script.metadata.loopCount === 0 ? t('infinite') : t('times')}</span>
                </div>
              )}
            </div>

            {/* Step List */}
            <div className="flex-1 overflow-y-auto border border-white/10 rounded bg-black/20 p-1 custom-scrollbar min-h-[10rem]">
              {script.steps.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[12px] text-gray-600 italic">
                  {t('noClicksYet')}
                </div>
              ) : (
                script.steps.map((step, idx) => {
                  const displayTime = formatTime(cumulative[idx] / playbackSpeed);
                  return (
                    <MemoStepRow
                      key={step.id}
                      step={step}
                      idx={idx}
                      isSelected={selectedStepId === step.id}
                      displayTime={displayTime}
                      onSelect={onSelectStep}
                      onDuplicate={selectedStepId === step.id ? onDuplicateStep : undefined}
                      duplicateTitle={t('duplicateStep')}
                      setRef={(el) => {
                        if (el) itemRefs.current.set(step.id, el);
                        else itemRefs.current.delete(step.id);
                      }}
                    />
                  );
                })
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex gap-2 border-t border-white/10 pt-3 mt-2 shrink-0 relative">
              {showSaveFeedback && (
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[12px] px-2 py-1 rounded flex items-center gap-1">
                  <Check size={12} /> {t('saved')}
                </div>
              )}

              <button onClick={onSaveLocal} className="flex-1 flex flex-col items-center gap-1 p-2 rounded text-[12px] text-gray-400">
                <Save size={16} />
                <span>{t('save')}</span>
              </button>

              <button onClick={onExport} className="flex-1 flex flex-col items-center gap-1 p-2 rounded text-[12px] text-gray-400">
                <FileJson size={16} />
                <span>{t('export')}</span>
              </button>

              <button onClick={onClear} className="flex-1 flex flex-col items-center gap-1 p-2 rounded text-[12px] text-gray-400">
                <Trash2 size={16} />
                <span>{t('clear')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {scriptToDelete && (
        <div
          className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4 rounded-xl backdrop-blur-[2px] pointer-events-auto"
          onClick={(e) => { e.stopPropagation(); setScriptToDelete(null); }}
        >
          <div
            className="bg-[#1f2937] border border-white/20 rounded-xl p-4 max-w-[280px] w-full shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
              <Trash2 size={16} />
              <span>{t('delete')}</span>
            </div>
            <p className="text-xs text-gray-200 leading-relaxed break-words">
              {t('confirmDelete', { name: scriptToDelete.name })}
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setScriptToDelete(null)}
                className="px-3 py-1.5 rounded text-xs text-gray-300 hover:bg-white/10 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = scriptToDelete.id;
                  setScriptToDelete(null);
                  onDeleteLocal(id);
                }}
                className="px-3 py-1.5 rounded text-xs bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors flex items-center gap-1 shadow-md shadow-red-950/50 active:scale-95"
              >
                <Trash2 size={12} />
                <span>{t('delete')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resize Handle */}
      <div
        className="absolute bottom-0 right-0 w-16 h-16 z-50 pointer-events-none flex items-end justify-end"
      >
        <div
          onMouseDown={handleResizeMouseDown}
          onTouchStart={handleResizeTouchStart}
          className="pointer-events-auto w-8 h-8 cursor-se-resize flex items-center justify-center text-white/30"
        >
          <CornerRightDown size={14} strokeWidth={3} />
        </div>
      </div>
    </div>
  );
};
