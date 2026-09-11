import React, { useState, useEffect, useRef } from 'react';

import { ClickStep } from '../types';
import { X, Copy, Clock, Repeat, MapPin, ArrowRight, Move } from 'lucide-react';
import { SafeNumberInput } from './SafeNumberInput';
import { formatTime, parseFormattedTime } from '../utils/format';
import { blurOnEnter, handleInputFocus, handleInputBlur } from '../utils/input';
import { useWindowDrag, getDragClientXY } from '../hooks/useWindowDrag';
import { useTranslation } from '../utils/i18n';

interface StepEditorProps {
  step: ClickStep;
  index: number;
  cumulativeTime?: number;
  playbackSpeed?: number;
  isDraggingPoint?: boolean;
  onUpdate: (updatedStep: ClickStep) => void;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  /** 回報面板矩形（viewport CSS px），鍵盤開啟時 App 以此＋HUD 聯集設觸控層 */
  onRectChange?: (x: number, y: number, width: number, height: number) => void;
}

export const StepEditor: React.FC<StepEditorProps> = ({
  step,
  index,
  cumulativeTime,
  playbackSpeed = 1,
  isDraggingPoint = false,
  onUpdate,
  onClose,
  onDelete,
  onDuplicate,
  onRectChange,
}) => {
  const { t } = useTranslation();
  const [localTimeStr, setLocalTimeStr] = useState('');
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const isTimeFocusedRef = useRef(false);

  // 面板根節點＋上次回報 key（去重，避免打字重繪時高頻 IPC）
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastRectKeyRef = useRef('');

  // Sync local time string when step changes from outside or on mount (only when NOT focused)
  // Scale down the time by playback speed for display
  useEffect(() => {
    if (!isTimeFocusedRef.current && cumulativeTime !== undefined) {
      setLocalTimeStr(formatTime(cumulativeTime / playbackSpeed));
    }
  }, [cumulativeTime, step.id, playbackSpeed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setPanelPos({ left: step.x + 20, top: step.y });
      return;
    }
    // 計算面板可用的最大寬度/高度，確保不超出畫面
    const panelW = Math.min(256, window.innerWidth - 40); // w-64 = 256px, 但不超過螢幕
    const panelH = Math.min(350, window.innerHeight - 40);
    const maxLeft = Math.max(0, window.innerWidth - panelW);
    const maxTop = Math.max(0, window.innerHeight - panelH);
    const left = Math.min(maxLeft, Math.max(10, step.x + 20));
    const top = Math.min(maxTop, Math.max(10, step.y));
    setPanelPos({ left, top });
  }, [step.id]);

  // 回報面板矩形給 App（鍵盤開啟時觸控層改用 HUD＋面板聯集）；
  // key 去重：打字等重繪不重送，只有位置/尺寸變化才回報
  useEffect(() => {
    if (!onRectChange) return;
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (lastRectKeyRef.current === key) return;
    lastRectKeyRef.current = key;
    onRectChange(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height));
  }, [panelPos, step.type, step.id, onRectChange]);

  const handleChange = (field: keyof ClickStep, value: any) => {
    onUpdate({ ...step, [field]: value });
  };

  const handleTimeBlur = (e?: React.FocusEvent<HTMLInputElement>) => {
    isTimeFocusedRef.current = false;
    // 釋放鍵盤焦點（確認離開所有輸入框才真正釋放，避免切換輸入時閃退）
    handleInputBlur();
    const raw = e?.target?.value ?? localTimeStr;
    // Calculate new delay based on edited time
    const newTimeMs = parseFormattedTime(raw);
    if (newTimeMs !== null && cumulativeTime !== undefined) {
      // Reverse Scale: Convert user input time back to base time
      const newTimeBase = newTimeMs * playbackSpeed;

      // Calculate the base end time of the previous step
      const prevStepsEndTimeBase = cumulativeTime - step.delay;

      // New delay is the difference
      const newDelay = Math.max(0, newTimeBase - prevStepsEndTimeBase);

      handleChange('delay', newDelay);

      // Format the input back nicely
      setLocalTimeStr(formatTime(newTimeMs));
    } else {
      // Revert if invalid
      if (cumulativeTime !== undefined) {
        setLocalTimeStr(formatTime(cumulativeTime / playbackSpeed));
      }
    }
  };

  const startPanelDrag = (clientX: number, clientY: number) => {
    if (!panelPos) return;
    setIsDraggingPanel(true);
    dragStartRef.current = { x: clientX, y: clientY, left: panelPos.left, top: panelPos.top };
  };

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    startPanelDrag(e.clientX, e.clientY);
  };

  const handleHeaderTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    e.stopPropagation();
    const touch = e.touches[0];
    startPanelDrag(touch.clientX, touch.clientY);
  };

  // 面板拖曳：mouse / touch 共用全域監聽（hooks/useWindowDrag）
  useWindowDrag(isDraggingPanel, (e) => {
    const { clientX, clientY } = getDragClientXY(e);
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    let left = dragStartRef.current.left + dx;
    let top = dragStartRef.current.top + dy;
    if (typeof window !== 'undefined') {
      const maxLeft = window.innerWidth - 280;
      const maxTop = window.innerHeight - 350;
      left = Math.min(Math.max(20, left), maxLeft);
      top = Math.min(Math.max(20, top), maxTop);
    }
    setPanelPos({ left, top });
  }, () => {
    setIsDraggingPanel(false);
  });

  const panelStyle = panelPos
    ? { left: panelPos.left, top: panelPos.top }
    : { left: Math.min((typeof window !== 'undefined' ? window.innerWidth : 400) - 280, Math.max(10, step.x + 20)), top: Math.min((typeof window !== 'undefined' ? window.innerHeight : 600) - 350, Math.max(10, step.y)) };

  // 面板寬度 & 最大高度隨螢幕縮放
  const panelWidth = typeof window !== 'undefined' ? Math.min(256, window.innerWidth - 20) : 256;
  const panelMaxHeight = typeof window !== 'undefined' ? Math.min(400, window.innerHeight - 40) : 400;

  const isSwipe = step.type === 'swipe';

  return (
    <div
      ref={rootRef}
      className={`fixed z-50 rounded-xl text-white p-4 border border-blue-500/30 pointer-events-auto overflow-y-auto overflow-x-hidden transition-opacity duration-150 ${
        isDraggingPoint ? 'opacity-20 pointer-events-none' : 'opacity-95'
      }`}
      style={{
        ...panelStyle,
        width: panelWidth,
        maxHeight: panelMaxHeight,
        touchAction: 'manipulation',
        background: 'rgba(22, 27, 34, 0.96)',
      }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2 cursor-move touch-none" onMouseDown={handleHeaderMouseDown} onTouchStart={handleHeaderTouchStart}>
        <h3 className="font-bold text-sm text-blue-400">{t('editPoint', { index: index + 1 })}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {/* Step Type Selector */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Move size={10} /> {t('type')}</label>
          <select
            value={step.type}
            onChange={(e) => {
              const newType = e.target.value as ClickStep['type'];
              const updates: Partial<ClickStep> = { type: newType };
              if (newType === 'swipe' && step.endX === undefined) {
                updates.endX = step.x + 100;
                updates.endY = step.y;
                updates.swipeDuration = 300;
              }
              onUpdate({ ...step, ...updates });
            }}
            className="w-full bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:border-blue-500 outline-none"
          >
            <option value="click">{t('typeClick')}</option>
            <option value="swipe">{t('typeSwipe')}</option>
            <option value="double-click">{t('typeDoubleClick')}</option>
            <option value="hold">{t('typeHold')}</option>
          </select>
        </div>

        {/* Trigger Time (Editable) */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-center relative group">
          <label className="text-[10px] text-blue-300 uppercase block mb-1">{t('triggerTime')} {playbackSpeed !== 1 && `(${playbackSpeed}x)`}</label>
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={localTimeStr}
            onChange={(e) => {
              // 只更新本地暫存，不即時換算/commit，避免刪除或輸入中亂跳補齊
              setLocalTimeStr(e.target.value);
            }}
            onFocus={(e) => {
              isTimeFocusedRef.current = true;
              handleInputFocus(e);
            }}
            onBlur={handleTimeBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                isTimeFocusedRef.current = false;
                handleTimeBlur();
                blurOnEnter(e);
              }
            }}
            onTouchStart={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-center font-mono text-xl font-bold text-white tracking-widest outline-none border-b border-transparent focus:border-blue-500"
            placeholder="00:00.000"
            style={{ touchAction: 'manipulation' }}
          />
          <div className="absolute right-2 top-2 opacity-50 text-[10px] text-blue-300 pointer-events-none">
            EDIT
          </div>
        </div>

        {/* Start Position（可完全清空，失焦空值帶回原本座標） */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><MapPin size={10} /> {isSwipe ? t('startPosition') : t('position')}</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-xs text-gray-500 mr-1">X</span>
              <SafeNumberInput
                value={Math.round(step.x)}
                defaultValue={Math.round(step.x)}
                onCommit={(n) => handleChange('x', n)}
                ariaLabel="X座標"
                className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <span className="text-xs text-gray-500 mr-1">Y</span>
              <SafeNumberInput
                value={Math.round(step.y)}
                defaultValue={Math.round(step.y)}
                onCommit={(n) => handleChange('y', n)}
                ariaLabel="Y座標"
                className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* End Position (Swipe only) */}
        {isSwipe && (
          <div className="space-y-1">
            <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><ArrowRight size={10} /> {t('endPosition')}</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-gray-500 mr-1">X</span>
                <SafeNumberInput
                  value={Math.round(step.endX ?? step.x)}
                  defaultValue={Math.round(step.endX ?? step.x)}
                  onCommit={(n) => handleChange('endX', n)}
                  ariaLabel="終點X座標"
                  className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <span className="text-xs text-gray-500 mr-1">Y</span>
                <SafeNumberInput
                  value={Math.round(step.endY ?? step.y)}
                  defaultValue={Math.round(step.endY ?? step.y)}
                  onCommit={(n) => handleChange('endY', n)}
                  ariaLabel="終點Y座標"
                  className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Swipe Duration (Swipe only) */}
        {isSwipe && (
          <div className="space-y-1">
            <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Clock size={10} /> {t('swipeDuration')}</label>
            <SafeNumberInput
              value={step.swipeDuration ?? 300}
              defaultValue={300}
              min={50}
              onCommit={(n) => handleChange('swipeDuration', n)}
              ariaLabel="滑動時間毫秒"
              className="w-full bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
            />
          </div>
        )}

        {/* Repeats（可清空，失焦空值帶回 1） */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Repeat size={10} /> {t('repeats')}</label>
          <div className="flex items-center gap-2">
            <SafeNumberInput
              value={step.repeat}
              defaultValue={1}
              min={1}
              onCommit={(n) => handleChange('repeat', n)}
              ariaLabel="重複次數"
              className="flex-1 bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
            />
            <span className="text-xs text-gray-500">{t('timesUnit')}</span>
          </div>
        </div>

        {/* Repeat Interval（可清空，失焦空值帶回 0） */}
        {step.repeat > 1 && (
          <div className="space-y-1">
            <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Clock size={10} /> {t('repeatInterval')}</label>
            <SafeNumberInput
              value={step.repeatInterval}
              defaultValue={0}
              min={0}
              onCommit={(n) => handleChange('repeatInterval', n)}
              ariaLabel="重複間隔毫秒"
              className="w-full bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
            />
          </div>
        )}

        {/* Post-Action Delay（可清空，失焦空值帶回 0） */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Clock size={10} /> {t('delayFromPrev')}</label>
          <SafeNumberInput
            value={step.delay}
            defaultValue={0}
            min={0}
            onCommit={(n) => handleChange('delay', n)}
            ariaLabel="與上一步間隔毫秒"
            className="w-full bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
          />
        </div>

        <div className="mt-2 flex gap-2">
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20 text-xs"
            >
              <Copy size={12} /> {t('duplicate')}
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-red-500/10 text-red-400 rounded border border-red-500/20 text-xs"
          >
            <X size={12} /> {t('delete')}
          </button>
        </div>
      </div>
    </div>
  );
};