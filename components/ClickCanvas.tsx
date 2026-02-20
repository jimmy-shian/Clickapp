import React, { useState, useEffect, useRef } from 'react';
import { ClickStep, AppMode } from '../types';

interface ClickCanvasProps {
  mode: AppMode;
  steps: ClickStep[];
  onCanvasClick: (x: number, y: number) => void;
  onCanvasSwipe: (x: number, y: number, endX: number, endY: number, duration: number) => void;
  onStepClick: (id: string) => void;
  onStepUpdate: (updatedStep: ClickStep) => void;
  selectedStepId: string | null;
  activePlaybackStepIndex?: number | null;
}

const SWIPE_THRESHOLD = 15; // px – movement beyond this classifies touch as swipe

export const ClickCanvas: React.FC<ClickCanvasProps> = ({
  mode,
  steps,
  onCanvasClick,
  onCanvasSwipe,
  onStepClick,
  onStepUpdate,
  selectedStepId,
  activePlaybackStepIndex
}) => {
  // Dragging logic
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const lastTouchTimeRef = useRef(0);

  // Swipe recording state
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isSwiping = useRef(false);

  const isRecording = mode === AppMode.RECORDING;
  const isEditing = !isRecording && mode === AppMode.IDLE && selectedStepId !== null;

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (draggingStepId && !isRecording && mode !== AppMode.PLAYING) {
        const step = steps.find(s => s.id === draggingStepId);
        if (step) {
          onStepUpdate({
            ...step,
            x: e.clientX - dragOffset.current.x,
            y: e.clientY - dragOffset.current.y
          });
        }
      }
    };

    const handleWindowMouseUp = () => {
      if (draggingStepId) {
        setDraggingStepId(null);
      }
    };

    // Touch support for dragging points
    const handleWindowTouchMove = (e: TouchEvent) => {
      if (draggingStepId && !isRecording && mode !== AppMode.PLAYING) {
        e.preventDefault();
        const step = steps.find(s => s.id === draggingStepId);
        const touch = e.touches[0];

        if (step) {
          onStepUpdate({
            ...step,
            x: touch.clientX - dragOffset.current.x,
            y: touch.clientY - dragOffset.current.y
          });
        }
      }
    };

    const handleWindowTouchEnd = () => {
      if (draggingStepId) {
        setDraggingStepId(null);
      }
    };

    if (draggingStepId) {
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
      window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
      window.addEventListener('touchend', handleWindowTouchEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowTouchEnd);
    };
  }, [draggingStepId, mode, steps, onStepUpdate]);


  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // On Android overlay, touch events are dispatched from the native TouchOverlayView.
    // The WebView then generates BOTH a touchstart AND a synthetic click for the same tap.
    // We use onTouchStart as the canonical recording handler, so skip onClick entirely
    // during recording to prevent duplicate steps.
    if (isRecording) return;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // Handle recording taps / swipes on mobile
    if (isRecording) {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      lastTouchTimeRef.current = Date.now();
      // Start tracking for potential swipe
      swipeStartRef.current = { x, y, time: Date.now() };
      isSwiping.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isRecording && swipeStartRef.current) {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      const dx = x - swipeStartRef.current.x;
      const dy = y - swipeStartRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > SWIPE_THRESHOLD) {
        isSwiping.current = true;
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isRecording && swipeStartRef.current) {
      e.preventDefault();
      const touch = e.changedTouches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const endX = touch.clientX - rect.left;
      const endY = touch.clientY - rect.top;
      const start = swipeStartRef.current;

      if (isSwiping.current) {
        // Record as swipe
        const duration = Math.max(50, Date.now() - start.time);
        onCanvasSwipe(start.x, start.y, endX, endY, duration);
      } else {
        // Record as click
        onCanvasClick(start.x, start.y);
      }

      swipeStartRef.current = null;
      isSwiping.current = false;
    }
  };

  const handleStepMouseDown = (e: React.MouseEvent, step: ClickStep) => {
    if (isRecording || mode === AppMode.PLAYING) return;

    e.stopPropagation();
    onStepClick(step.id);

    setDraggingStepId(step.id);
    dragOffset.current = {
      x: e.clientX - step.x,
      y: e.clientY - step.y
    };
  };

  const handleStepTouchStart = (e: React.TouchEvent, step: ClickStep) => {
    if (isRecording || mode === AppMode.PLAYING) return;
    e.stopPropagation();
    onStepClick(step.id);
    setDraggingStepId(step.id);
    const touch = e.touches[0];
    dragOffset.current = {
      x: touch.clientX - step.x,
      y: touch.clientY - step.y
    };
  };

  return (
    <div
      className={`relative w-full h-screen overflow-hidden ${isRecording || isEditing ? 'pointer-events-auto' : 'pointer-events-none'
        } ${isRecording ? 'cursor-crosshair' : ''}`}
      style={{ backgroundColor: 'transparent' }}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >


      {/* Playback Active Step Overlay (Top Center) */}
      {mode === AppMode.PLAYING && activePlaybackStepIndex !== null && activePlaybackStepIndex !== undefined && steps[activePlaybackStepIndex] && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40 bg-black/60 backdrop-blur-sm border border-white/20 px-4 py-2 rounded-full shadow-lg pointer-events-none animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
            <span className="text-white font-mono font-bold text-sm">
              #{activePlaybackStepIndex + 1}
            </span>
            <span className="text-gray-300 text-xs font-medium">
              {steps[activePlaybackStepIndex].type.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Background Layer (Transparent Overlay) */}
      <div className="absolute inset-0 pointer-events-none"></div>

      {/* Render Connectors - During recording or editing */}
      {(isRecording || isEditing) && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <polyline
            points={steps.map(s => `${s.x},${s.y}`).join(' ')}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="opacity-40"
          />
          {/* Render swipe arrows */}
          {steps.map((step) => {
            if (step.type === 'swipe' && step.endX !== undefined && step.endY !== undefined) {
              const isSelected = selectedStepId === step.id;
              return (
                <g key={`swipe-${step.id}`}>
                  <defs>
                    <marker
                      id={`arrowhead-${step.id}`}
                      markerWidth="8"
                      markerHeight="6"
                      refX="7"
                      refY="3"
                      orient="auto"
                    >
                      <polygon
                        points="0 0, 8 3, 0 6"
                        fill={isSelected ? '#fbbf24' : '#f97316'}
                      />
                    </marker>
                  </defs>
                  <line
                    x1={step.x}
                    y1={step.y}
                    x2={step.endX}
                    y2={step.endY}
                    stroke={isSelected ? '#fbbf24' : '#f97316'}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray={isSelected ? 'none' : '6 3'}
                    markerEnd={`url(#arrowhead-${step.id})`}
                    className="transition-all"
                  />
                </g>
              );
            }
            return null;
          })}
        </svg>
      )}

      {/* Render Steps Markers - During recording or editing */}
      {(isRecording || isEditing) && steps.map((step, index) => {
        const isSelected = selectedStepId === step.id;
        const isSwipe = step.type === 'swipe';
        return (
          <React.Fragment key={step.id}>
            {/* Start point */}
            <div
              onMouseDown={(e) => handleStepMouseDown(e, step)}
              onTouchStart={(e) => handleStepTouchStart(e, step)}
              className={`absolute flex items-center justify-center w-6 h-6 -ml-3 -mt-3 rounded-full border text-[10px] text-white transition-transform z-10 select-none pointer-events-auto
                ${isSelected ? 'bg-blue-600 border-white scale-125 shadow-[0_0_10px_rgba(37,99,235,0.8)] z-20' : isSwipe ? 'bg-orange-500/40 border-orange-400 hover:bg-orange-500/60' : 'bg-blue-500/30 border-blue-400 hover:bg-blue-500/60'}
                ${mode === AppMode.IDLE ? 'cursor-grab active:cursor-grabbing' : ''}
              `}
              style={{
                left: step.x,
                top: step.y,
                borderColor: isSelected ? '#fbbf24' : undefined
              }}
            >
              {index + 1}
            </div>
            {/* Swipe end point marker */}
            {isSwipe && step.endX !== undefined && step.endY !== undefined && (
              <div
                className={`absolute flex items-center justify-center w-4 h-4 -ml-2 -mt-2 rounded-full border text-[8px] transition-transform z-10 select-none pointer-events-none
                  ${isSelected ? 'bg-yellow-500/60 border-yellow-300' : 'bg-orange-400/40 border-orange-300'}
                `}
                style={{
                  left: step.endX,
                  top: step.endY,
                }}
              >
                ▸
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};