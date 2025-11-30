import React, { useState, useEffect, useRef } from 'react';
import { ClickStep, AppMode } from '../types';

interface ClickCanvasProps {
  mode: AppMode;
  steps: ClickStep[];
  onCanvasClick: (x: number, y: number) => void;
  onStepClick: (id: string) => void;
  onStepUpdate: (updatedStep: ClickStep) => void; 
  selectedStepId: string | null;
}

export const ClickCanvas: React.FC<ClickCanvasProps> = ({
  mode,
  steps,
  onCanvasClick,
  onStepClick,
  onStepUpdate,
  selectedStepId
}) => {
  // Dragging logic
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const lastTouchTimeRef = useRef(0);

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
    // Only capture clicks on canvas if recording
    if (isRecording) {
      const now = Date.now();
      // Ignore synthetic click that follows a touch event to avoid double-adding steps
      if (now - lastTouchTimeRef.current < 400) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      onCanvasClick(x, y);
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // Handle recording taps on mobile
    if (isRecording) {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      lastTouchTimeRef.current = Date.now();
      onCanvasClick(x, y);
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
      className={`relative w-full h-screen overflow-hidden ${
        isRecording || isEditing ? 'pointer-events-auto' : 'pointer-events-none'
      } ${isRecording ? 'cursor-crosshair' : ''}`}
      style={{ backgroundColor: 'transparent' }}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
    >
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
        </svg>
      )}

      {/* Render Steps Markers - During recording or editing */}
      {(isRecording || isEditing) && steps.map((step, index) => {
        const isSelected = selectedStepId === step.id;
        return (
          <div
            key={step.id}
            onMouseDown={(e) => handleStepMouseDown(e, step)}
            onTouchStart={(e) => handleStepTouchStart(e, step)}
            className={`absolute flex items-center justify-center w-6 h-6 -ml-3 -mt-3 rounded-full border text-[10px] text-white transition-transform z-10 select-none pointer-events-auto
              ${isSelected ? 'bg-blue-600 border-white scale-125 shadow-[0_0_10px_rgba(37,99,235,0.8)] z-20' : 'bg-blue-500/30 border-blue-400 hover:bg-blue-500/60'}
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
        );
      })}
    </div>
  );
};