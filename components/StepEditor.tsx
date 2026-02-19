import React, { useState, useEffect, useRef } from 'react';

import { ClickStep } from '../types';
import { X, Copy, Clock, Repeat, MapPin, ArrowRight, Move } from 'lucide-react';

interface StepEditorProps {
  step: ClickStep;
  index: number;
  cumulativeTime?: number;
  playbackSpeed?: number;
  onUpdate: (updatedStep: ClickStep) => void;
  onClose: () => void;
  onDelete: () => void;
}

const formatTime = (ms: number) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor(ms % 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

const parseFormattedTime = (timeStr: string): number | null => {
  // Expected format MM:SS.mmm
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;

  const minutes = parseInt(parts[0], 10);
  const secondsParts = parts[1].split('.');

  if (secondsParts.length !== 2) return null;
  const seconds = parseInt(secondsParts[0], 10);
  const ms = parseInt(secondsParts[1], 10);

  if (isNaN(minutes) || isNaN(seconds) || isNaN(ms)) return null;

  return (minutes * 60000) + (seconds * 1000) + ms;
};

/** Helper: blur on Enter key to dismiss mobile keyboard */
const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') {
    (e.target as HTMLInputElement).blur();
  }
};

export const StepEditor: React.FC<StepEditorProps> = ({ step, index, cumulativeTime, playbackSpeed = 1, onUpdate, onClose, onDelete }) => {
  const [localTimeStr, setLocalTimeStr] = useState('');
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });

  // Sync local time string when step changes from outside or on mount
  // Scale down the time by playback speed for display
  useEffect(() => {
    if (cumulativeTime !== undefined) {
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

  const handleChange = (field: keyof ClickStep, value: any) => {
    onUpdate({ ...step, [field]: value });
  };

  const handleTimeBlur = () => {
    // 釋放鍵盤焦點
    window.Android?.clearInputFocus?.();
    // Calculate new delay based on edited time
    const newTimeMs = parseFormattedTime(localTimeStr);
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

  useEffect(() => {
    if (!isDraggingPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      let left = dragStartRef.current.left + dx;
      let top = dragStartRef.current.top + dy;
      if (typeof window !== 'undefined') {
        const maxLeft = window.innerWidth - 280;
        const maxTop = window.innerHeight - 350;
        left = Math.min(Math.max(20, left), maxLeft);
        top = Math.min(Math.max(20, top), maxTop);
      }
      setPanelPos({ left, top });
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;
      let left = dragStartRef.current.left + dx;
      let top = dragStartRef.current.top + dy;
      if (typeof window !== 'undefined') {
        const maxLeft = window.innerWidth - 280;
        const maxTop = window.innerHeight - 350;
        left = Math.min(Math.max(20, left), maxLeft);
        top = Math.min(Math.max(20, top), maxTop);
      }
      setPanelPos({ left, top });
    };

    const handleUp = () => {
      setIsDraggingPanel(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDraggingPanel]);

  const panelStyle = panelPos
    ? { left: panelPos.left, top: panelPos.top }
    : { left: Math.min((typeof window !== 'undefined' ? window.innerWidth : 400) - 280, Math.max(10, step.x + 20)), top: Math.min((typeof window !== 'undefined' ? window.innerHeight : 600) - 350, Math.max(10, step.y)) };

  // 面板寬度 & 最大高度隨螢幕縮放
  const panelWidth = typeof window !== 'undefined' ? Math.min(256, window.innerWidth - 20) : 256;
  const panelMaxHeight = typeof window !== 'undefined' ? Math.min(400, window.innerHeight - 40) : 400;

  const isSwipe = step.type === 'swipe';

  return (
    <div className="fixed z-50 glass-panel rounded-xl shadow-2xl text-white p-4 border border-blue-500/30 pointer-events-auto overflow-y-auto overflow-x-hidden"
      style={{ ...panelStyle, width: panelWidth, maxHeight: panelMaxHeight, touchAction: 'manipulation' }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}>

      <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2 cursor-move touch-none" onMouseDown={handleHeaderMouseDown} onTouchStart={handleHeaderTouchStart}>
        <h3 className="font-bold text-sm text-blue-400">Edit Point #{index + 1}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {/* Step Type Selector */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Move size={10} /> Type</label>
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
            <option value="click">Click</option>
            <option value="swipe">Swipe</option>
            <option value="double-click">Double Click</option>
            <option value="hold">Hold</option>
          </select>
        </div>

        {/* Trigger Time (Editable) */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-center relative group">
          <label className="text-[10px] text-blue-300 uppercase block mb-1">Trigger Time {playbackSpeed !== 1 && `(${playbackSpeed}x)`}</label>
          <input
            type="text"
            inputMode="decimal"
            value={localTimeStr}
            onChange={(e) => setLocalTimeStr(e.target.value)}
            onBlur={handleTimeBlur}
            onFocus={() => window.Android?.requestInputFocus?.()}
            onKeyDown={blurOnEnter}
            className="w-full bg-transparent text-center font-mono text-xl font-bold text-white tracking-widest outline-none border-b border-transparent focus:border-blue-500 transition-colors"
            placeholder="00:00.000"
          />
          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-50 text-[10px] text-blue-300 pointer-events-none">
            EDIT
          </div>
        </div>

        {/* Start Position */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><MapPin size={10} /> {isSwipe ? 'Start Position' : 'Position'}</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-xs text-gray-500 mr-1">X</span>
              <input
                type="number"
                inputMode="numeric"
                value={Math.round(step.x)}
                onChange={(e) => handleChange('x', Number(e.target.value))}
                onFocus={() => window.Android?.requestInputFocus?.()}
                onBlur={() => window.Android?.clearInputFocus?.()}
                onKeyDown={blurOnEnter}
                className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <span className="text-xs text-gray-500 mr-1">Y</span>
              <input
                type="number"
                inputMode="numeric"
                value={Math.round(step.y)}
                onChange={(e) => handleChange('y', Number(e.target.value))}
                onFocus={() => window.Android?.requestInputFocus?.()}
                onBlur={() => window.Android?.clearInputFocus?.()}
                onKeyDown={blurOnEnter}
                className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* End Position (Swipe only) */}
        {isSwipe && (
          <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
            <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><ArrowRight size={10} /> End Position</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-gray-500 mr-1">X</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={Math.round(step.endX ?? step.x)}
                  onChange={(e) => handleChange('endX', Number(e.target.value))}
                  onFocus={() => window.Android?.requestInputFocus?.()}
                  onBlur={() => window.Android?.clearInputFocus?.()}
                  onKeyDown={blurOnEnter}
                  className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <span className="text-xs text-gray-500 mr-1">Y</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={Math.round(step.endY ?? step.y)}
                  onChange={(e) => handleChange('endY', Number(e.target.value))}
                  onFocus={() => window.Android?.requestInputFocus?.()}
                  onBlur={() => window.Android?.clearInputFocus?.()}
                  onKeyDown={blurOnEnter}
                  className="w-full bg-black/30 border border-gray-600 rounded px-1 py-0.5 text-xs focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Swipe Duration (Swipe only) */}
        {isSwipe && (
          <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
            <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Clock size={10} /> Swipe Duration (ms)</label>
            <input
              type="number"
              inputMode="numeric"
              min="50"
              value={step.swipeDuration ?? 300}
              onChange={(e) => handleChange('swipeDuration', Math.max(50, Number(e.target.value)))}
              onFocus={() => window.Android?.requestInputFocus?.()}
              onBlur={() => window.Android?.clearInputFocus?.()}
              onKeyDown={blurOnEnter}
              className="w-full bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
            />
          </div>
        )}

        {/* Repeats */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Repeat size={10} /> Repeats</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={step.repeat}
              onChange={(e) => handleChange('repeat', Math.max(1, Number(e.target.value)))}
              onFocus={() => window.Android?.requestInputFocus?.()}
              onBlur={() => window.Android?.clearInputFocus?.()}
              onKeyDown={blurOnEnter}
              className="flex-1 bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
            />
            <span className="text-xs text-gray-500">times</span>
          </div>
        </div>

        {/* Repeat Interval */}
        {step.repeat > 1 && (
          <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
            <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Clock size={10} /> Repeat Interval (ms)</label>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={step.repeatInterval}
              onChange={(e) => handleChange('repeatInterval', Math.max(0, Number(e.target.value)))}
              onFocus={() => window.Android?.requestInputFocus?.()}
              onBlur={() => window.Android?.clearInputFocus?.()}
              onKeyDown={blurOnEnter}
              className="w-full bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
            />
          </div>
        )}

        {/* Post-Action Delay */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 uppercase flex items-center gap-1"><Clock size={10} /> Delay from previous (ms)</label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={step.delay}
            onChange={(e) => handleChange('delay', Math.max(0, Number(e.target.value)))}
            onFocus={() => window.Android?.requestInputFocus?.()}
            onBlur={() => window.Android?.clearInputFocus?.()}
            onKeyDown={blurOnEnter}
            className="w-full bg-black/30 border border-gray-600 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
          />
        </div>

        <button
          onClick={onDelete}
          className="mt-2 w-full flex items-center justify-center gap-2 py-1.5 bg-red-500/10 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded border border-red-500/20 transition-colors text-xs"
        >
          <X size={12} /> Delete Point
        </button>
      </div>
    </div>
  );
};