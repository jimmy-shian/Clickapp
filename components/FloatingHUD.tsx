import React, { useState, useRef, useEffect } from 'react';
import { AppMode, ClickScript, SavedScriptSummary } from '../types';
import { Play, Square, Circle, Save, Upload, Trash2, GripHorizontal, MousePointer2, Minimize2, Maximize2, ChevronLeft, Plus, Folder, FileJson, CornerRightDown, Check, Clock, Music, ArrowRightLeft, FileText, Gauge, Power } from 'lucide-react';

interface FloatingHUDProps {
  mode: AppMode;
  script: ClickScript;
  savedScripts: SavedScriptSummary[];
  isScriptLoaded: boolean;
  showSaveFeedback?: boolean;
  sessionStartTime: number | null;
  
  // Actions
  onRecordToggle: () => void;
  onPlayToggle: () => void;
  onClear: () => void; // Clear current steps
  
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
  setScriptName: (name: string) => void;
  
  // Step Interaction
  onSelectStep: (id: string | null) => void;
  selectedStepId: string | null;

  // Playback Control
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  // Layout sync back to App / Android
  onRectChange?: (x: number, y: number, width: number, height: number, isCollapsed: boolean) => void;
}

const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = Math.floor(ms % 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

export const FloatingHUD: React.FC<FloatingHUDProps> = ({
  mode,
  script,
  savedScripts,
  isScriptLoaded,
  showSaveFeedback,
  sessionStartTime,
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
  setScriptName,
  onSelectStep,
  selectedStepId,
  playbackSpeed,
  setPlaybackSpeed,
  onRectChange
}) => {
  // Window State
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [size, setSize] = useState({ width: 380, height: 500 }); // Slightly taller default
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Dragging State
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  
  // Live Timer State
  const [liveDuration, setLiveDuration] = useState(0);

  // Converter UI State
  const [isConverterOpen, setIsConverterOpen] = useState(false);
  const [songFile, setSongFile] = useState<File | null>(null);
  const [mapFile, setMapFile] = useState<File | null>(null);

  // Refs
  const hasMovedRef = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const clampToViewport = (x: number, y: number, width: number, height: number) => {
    if (typeof window === 'undefined') return { x, y };
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY)
    };
  };

  // --- SYNC HUD RECT WITH APP / ANDROID ---
  useEffect(() => {
    const currentWidth = isCollapsed ? 48 : size.width;
    const currentHeight = isCollapsed ? 48 : size.height;
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const w = Math.round(currentWidth);
    const h = Math.round(currentHeight);

    if (onRectChange) {
      onRectChange(x, y, w, h, isCollapsed);
    } else if (window.Android && window.Android.updateOverlayRect) {
      window.Android.updateOverlayRect(x, y, w, h);
    } else if (window.Android && window.Android.reportPos) {
      window.Android.reportPos(x, y, w, h);
    }
  }, [position, size, isCollapsed, onRectChange]);

  // --- Live Timer Effect ---
  useEffect(() => {
    let frameId: number;
    const update = () => {
        if ((mode === AppMode.RECORDING || mode === AppMode.PLAYING) && sessionStartTime) {
            setLiveDuration(Date.now() - sessionStartTime);
            frameId = requestAnimationFrame(update);
        }
    };
    
    if (mode === AppMode.RECORDING || mode === AppMode.PLAYING) {
        update();
    } else {
        setLiveDuration(0);
    }
    
    return () => cancelAnimationFrame(frameId);
  }, [mode, sessionStartTime]);

  // Determine what duration to show in the header
  const totalStepsDuration = script.steps.reduce((acc, step) => {
      let d = acc + step.delay;
      if (step.repeat > 1) d += (step.repeat - 1) * step.repeatInterval;
      return d;
  }, 0);

  const displayDuration = (mode === AppMode.RECORDING || mode === AppMode.PLAYING) 
    ? liveDuration 
    : Math.max(script.metadata.duration || 0, totalStepsDuration) / playbackSpeed;

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

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragStart.current.x;
        const newY = e.clientY - dragStart.current.y;
        const currentWidth = isCollapsed ? 48 : size.width;
        const currentHeight = isCollapsed ? 48 : size.height;
        const clamped = clampToViewport(newX, newY, currentWidth, currentHeight);
        
        if (!hasMovedRef.current) {
            const dx = Math.abs(clamped.x - position.x);
            const dy = Math.abs(clamped.y - position.y);
            if (dx > 3 || dy > 3) hasMovedRef.current = true;
        }
        setPosition({ x: clamped.x, y: clamped.y });
      }

      if (isResizing) {
          const dx = e.clientX - resizeStart.current.x;
          const dy = e.clientY - resizeStart.current.y;
          setSize({
              width: Math.max(340, resizeStart.current.w + dx),
              height: Math.max(400, resizeStart.current.h + dy)
          });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    // --- Touch Move Logic ---
    const handleTouchMove = (e: TouchEvent) => {
        if (isDragging) {
            e.preventDefault(); // Prevent scrolling while dragging HUD
            const touch = e.touches[0];
            const newX = touch.clientX - dragStart.current.x;
            const newY = touch.clientY - dragStart.current.y;
            const currentWidth = isCollapsed ? 48 : size.width;
            const currentHeight = isCollapsed ? 48 : size.height;
            const clamped = clampToViewport(newX, newY, currentWidth, currentHeight);

            if (!hasMovedRef.current) {
                const dx = Math.abs(clamped.x - position.x);
                const dy = Math.abs(clamped.y - position.y);
                if (dx > 3 || dy > 3) hasMovedRef.current = true;
            }
            setPosition({ x: clamped.x, y: clamped.y });
        }

        if (isResizing) {
            e.preventDefault();
            const touch = e.touches[0];
            const dx = touch.clientX - resizeStart.current.x;
            const dy = touch.clientY - resizeStart.current.y;
            setSize({
                width: Math.max(340, resizeStart.current.w + dx),
                height: Math.max(400, resizeStart.current.h + dy)
            });
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
        setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      // Add Touch Listeners to Window to track drags accurately
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, isResizing, position.x, position.y, size.width, size.height, isCollapsed]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file);
  };
  
  const handleConverter = () => {
      if(songFile && mapFile) {
          onConvertSheet(songFile, mapFile);
          // Reset
          setSongFile(null);
          setMapFile(null);
          setIsConverterOpen(false);
      }
  }

  // Helper to calculate time accumulators for rendering
  let currentAccumulatedTime = 0;

  // --- Render Minimized State ---
  if (isCollapsed) {
    return (
        <div 
            className={`fixed z-50 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-transform active:scale-95 hover:scale-105 pointer-events-auto ${
                mode === AppMode.RECORDING ? 'bg-red-500 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.6)]' : 
                mode === AppMode.PLAYING ? 'bg-amber-500 animate-pulse shadow-[0_0_20px_rgba(245,158,11,0.6)]' : 
                'bg-gray-700 glass-panel'
            }`}
            style={{ left: position.x, top: position.y, width: '48px', height: '48px' }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onClick={(e) => { 
                if (!hasMovedRef.current) {
                    setIsCollapsed(false);
                    // Core functionality: Stop active process when expanding from minimized
                    if (mode === AppMode.RECORDING) {
                        onRecordToggle();
                    } else if (mode === AppMode.PLAYING) {
                        onPlayToggle();
                    }
                }
            }}
        >
            {mode === AppMode.RECORDING ? <Square size={20} fill="white" className="text-white"/> : 
             mode === AppMode.PLAYING ? <Square size={20} fill="white" className="text-white"/> :
             <Maximize2 size={20} className="text-white"/>}
        </div>
    );
  }

  // --- Main Render ---
  return (
    <div
      className="fixed z-50 glass-panel rounded-xl shadow-2xl text-white flex flex-col transition-shadow duration-200 pointer-events-auto"
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      {/* Header / Drag Handle */}
      <div
        className="h-10 bg-white/10 rounded-t-xl flex items-center justify-between px-3 cursor-move hover:bg-white/20 transition-colors shrink-0 touch-none"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div className="flex items-center gap-2 text-base font-semibold text-gray-300 pointer-events-none">
           {isScriptLoaded ? (
               <button 
                onClick={(e) => { e.stopPropagation(); onCloseScript(); }}
                className="hover:text-white hover:bg-white/10 p-1 rounded transition-colors flex items-center gap-1 pointer-events-auto"
               >
                   <ChevronLeft size={14} />
                   <span>Back</span>
               </button>
           ) : (
               <div className="flex items-center gap-2">
                   <MousePointer2 size={14} />
                   <span>OMNICLICK</span>
               </div>
           )}
        </div>
        
        <div className="flex items-center gap-1">
            <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onExitApp(); 
                }}
                className="text-red-400 hover:text-red-200 hover:bg-red-500/20 p-1 rounded pointer-events-auto transition-colors mr-1"
                title="Exit App"
            >
                <Power size={14} />
            </button>
            <button 
                onClick={(e) => { e.stopPropagation(); setIsCollapsed(true); }}
                className="text-gray-400 hover:text-white p-1 hover:bg-white/10 rounded pointer-events-auto"
                onTouchEnd={(e) => { e.stopPropagation(); setIsCollapsed(true); }}
            >
                <Minimize2 size={14} />
            </button>
            <GripHorizontal size={16} className="text-gray-400" />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        
        {!isScriptLoaded ? (
            // === LIST VIEW ===
            <div className="flex flex-col h-full animate-in fade-in slide-in-from-left-4 duration-300 relative">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                        <Folder size={16} className="text-blue-400"/> My Scripts
                    </h2>
                    <button 
                        onClick={onCreateNew}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-base px-2 py-1 rounded flex items-center gap-1 transition-colors"
                    >
                        <Plus size={14} /> New
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 space-y-2 mb-20">
                    {savedScripts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-gray-500 text-base text-center border-2 border-dashed border-white/5 rounded-lg">
                            <p>No scripts saved.</p>
                            <p className="mt-1">Create new or import.</p>
                        </div>
                    ) : (
                        savedScripts.map(s => (
                            <div 
                                key={s.id} 
                                onClick={() => onLoadLocal(s.id)}
                                className="group bg-white/5 hover:bg-white/10 border border-white/5 hover:border-blue-500/50 rounded-lg p-3 cursor-pointer transition-all relative"
                            >
                                <div className="flex justify-between items-start">
                                    <div className="font-medium text-lg text-gray-200 group-hover:text-white truncate pr-6">{s.name}</div>
                                    <div className="text-[14px] text-gray-500">{new Date(s.updatedAt).toLocaleDateString()}</div>
                                </div>
                                <div className="text-[14px] text-gray-400 mt-1 flex gap-2">
                                    <span>{s.stepCount} steps</span>
                                </div>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onDeleteLocal(s.id); }}
                                    className="absolute bottom-2 right-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                    title="Delete"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))
                    )}
                    
                    {/* Fixed File Upload for Mobile: Overlay Input */}
                    <div className="relative mt-2 pt-2 border-t border-white/10">
                        <div className="flex items-center justify-center gap-2 py-2 text-base text-gray-400 hover:text-white transition-colors">
                            <Upload size={14} /> Import JSON File
                        </div>
                        <input 
                            type="file" 
                            onChange={handleFileChange} 
                            accept=".json" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                    </div>
                </div>

                {/* ADVANCED TOOLS SECTION */}
                <div className="absolute bottom-0 left-0 right-0 bg-[#2d3748] rounded-t-xl border-t border-blue-500/30 overflow-hidden shadow-2xl transition-all duration-300">
                    {!isConverterOpen ? (
                        <button 
                            onClick={() => setIsConverterOpen(true)}
                            className="w-full p-3 flex items-center justify-between text-blue-300 hover:text-white hover:bg-white/5"
                        >
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <ArrowRightLeft size={16}/> Advanced Features ➤ Sheet Converter
                            </div>
                        </button>
                    ) : (
                        <div className="p-4 bg-gray-800 border-t border-white/10">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2">
                                    <ArrowRightLeft size={16}/> Sheet Music Converter
                                </h3>
                                <button onClick={() => setIsConverterOpen(false)} className="text-gray-500 hover:text-white"><Minimize2 size={14}/></button>
                            </div>
                            
                            <div className="space-y-3">
                                <div className="flex flex-col gap-1 relative">
                                    <label className="text-[10px] text-gray-400 uppercase">1. Song Source (TXT/JSON)</label>
                                    <div className={`flex items-center gap-2 p-2 rounded text-xs border ${songFile ? 'bg-green-500/20 border-green-500/50 text-green-200' : 'bg-black/20 border-gray-600 text-gray-400'}`}>
                                        <Music size={14}/> {songFile ? songFile.name : "Select Song JSON..."}
                                    </div>
                                    <input 
                                        type="file" 
                                        accept=".json,.txt" 
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                                        onChange={(e) => setSongFile(e.target.files?.[0] || null)} 
                                    />
                                </div>

                                <div className="flex flex-col gap-1 relative">
                                    <label className="text-[10px] text-gray-400 uppercase">2. Layout Script (JSON - 15 pts)</label>
                                    <div className={`flex items-center gap-2 p-2 rounded text-xs border ${mapFile ? 'bg-green-500/20 border-green-500/50 text-green-200' : 'bg-black/20 border-gray-600 text-gray-400'}`}>
                                        <FileText size={14}/> {mapFile ? mapFile.name : "Select Layout Script..."}
                                    </div>
                                    <input 
                                        type="file" 
                                        accept=".json" 
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        onChange={(e) => setMapFile(e.target.files?.[0] || null)} 
                                    />
                                </div>

                                <button 
                                    onClick={handleConverter}
                                    disabled={!songFile || !mapFile}
                                    className="w-full py-2 mt-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-bold"
                                >
                                    Convert & Save
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        ) : (
            // === EDITOR VIEW ===
            <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
                {/* Script Name Input */}
                <input 
                    type="text" 
                    value={script.metadata.name}
                    onChange={(e) => setScriptName(e.target.value)}
                    className="bg-transparent border-b border-white/10 focus:border-blue-500 text-xl font-bold text-white px-1 py-1 mb-4 outline-none w-full"
                    placeholder="Script Name"
                />

                {/* Stats Bar */}
                <div className="flex justify-between items-end border-b border-white/10 pb-2 mb-2 shrink-0">
                  <div className="flex flex-col gap-2">
                    <div>
                        <div className="text-[14px] text-gray-400 uppercase tracking-wider">Status</div>
                        <div className={`text-lg font-bold ${mode === AppMode.RECORDING ? 'text-red-400 animate-pulse' : mode === AppMode.PLAYING ? 'text-green-400' : 'text-gray-200'}`}>
                          {mode}
                        </div>
                    </div>

                    {/* Playback Speed Slider */}
                    <div className="flex flex-col gap-1 w-32 border-t border-white/10 pt-2">
                        <label className="text-[10px] text-gray-400 uppercase tracking-wider flex justify-between items-center">
                            <div className="flex items-center gap-1"><Gauge size={10}/> Play Speed</div>
                            <span className="text-blue-300 font-mono">{playbackSpeed.toFixed(1)}x</span>
                        </label>
                        <input 
                            type="range" 
                            min="0.1" 
                            max="3.0" 
                            step="0.1" 
                            value={playbackSpeed} 
                            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                            className="h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 w-full"
                        />
                    </div>
                  </div>

                  <div className="flex gap-4">
                     <div className="text-right min-w-[80px]">
                        <div className="text-[14px] text-gray-400 uppercase tracking-wider">Duration</div>
                        <div className="text-lg font-mono text-white font-semibold">
                            {formatTime(displayDuration)}
                        </div>
                     </div>
                     <div className="text-right">
                        <div className="text-[14px] text-gray-400 uppercase tracking-wider">Steps</div>
                        <div className="text-lg font-mono text-gray-200">{script.steps.length}</div>
                     </div>
                  </div>
                </div>

                {/* Primary Actions */}
                <div className="grid grid-cols-2 gap-2 shrink-0">
                  <button
                    onClick={onRecordToggle}
                    className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg font-medium transition-all ${
                      mode === AppMode.RECORDING
                        ? 'bg-red-500/80 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]'
                        : 'bg-white/10 hover:bg-white/20 text-gray-200'
                    }`}
                  >
                    {mode === AppMode.RECORDING ? <Square size={16} fill="currentColor" /> : <Circle size={16} fill="currentColor" className="text-red-500" />}
                    {mode === AppMode.RECORDING ? 'STOP' : 'RECORD'}
                  </button>

                  <button
                    onClick={onPlayToggle}
                    disabled={script.steps.length === 0 || mode === AppMode.RECORDING}
                    className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg font-medium transition-all ${
                      mode === AppMode.PLAYING
                        ? 'bg-amber-500/80 hover:bg-amber-500 text-white shadow-[0_0_15px_rgba(245,158,11,0.5)]'
                        : 'bg-white/10 hover:bg-white/20 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    {mode === AppMode.PLAYING ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                    {mode === AppMode.PLAYING ? 'STOP' : 'PLAY'}
                  </button>
                </div>

                {/* Loop Option */}
                <div className="flex items-center justify-between px-1 py-2 shrink-0">
                    <label className="flex items-center gap-2 text-base text-gray-300 cursor-pointer select-none hover:text-white transition-colors">
                        <input 
                            type="checkbox" 
                            checked={script.metadata.loop}
                            onChange={(e) => setLoop(e.target.checked)}
                            className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-offset-gray-900" 
                        />
                        Infinite Loop Playback
                    </label>
                </div>

                {/* Step List */}
                <div className="flex-1 overflow-y-auto border border-white/10 rounded bg-black/20 p-1 custom-scrollbar min-h-0">
                    {script.steps.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-base text-gray-600 italic">
                            No clicks recorded yet.
                        </div>
                    ) : (
                        script.steps.map((step, idx) => {
                            // Calculate cumulative time for display
                            // Note: step.delay is wait BEFORE click.
                            currentAccumulatedTime += step.delay;
                            
                            // Scale the display time by speed
                            const displayTime = formatTime(currentAccumulatedTime / playbackSpeed);
                            
                            // If repeats exist, add their time to the running total for NEXT step's basis
                            if (step.repeat > 1) {
                                currentAccumulatedTime += (step.repeat - 1) * step.repeatInterval;
                            }
                            
                            return (
                              <div 
                                  key={step.id}
                                  onClick={() => onSelectStep(selectedStepId === step.id ? null : step.id)}
                                  className={`relative p-3 cursor-pointer rounded mb-1 transition-all border border-transparent ${
                                      selectedStepId === step.id 
                                      ? 'bg-blue-600 border-blue-400 text-white shadow-md translate-x-1' 
                                      : 'hover:bg-white/5 border-white/5 text-gray-300'
                                  }`}
                              >
                                  {/* GRID LAYOUT FOR ALIGNMENT */}
                                  <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                                      {/* Left: Label */}
                                      <div className="flex items-center gap-2 w-24">
                                          <span className={`font-mono text-lg opacity-70 ${selectedStepId === step.id ? 'text-blue-200' : 'text-gray-500'}`}>
                                              #{idx + 1}
                                          </span>
                                          <span className="font-semibold text-lg">Click</span>
                                      </div>
                                      
                                      {/* Center/Right: Time */}
                                      <div className="flex justify-end pr-4">
                                          <span className={`font-mono text-3xl font-black tabular-nums ${selectedStepId === step.id ? 'text-white' : 'text-gray-200'}`}>
                                              {displayTime}
                                          </span>
                                      </div>
                                      
                                      {/* Right: Coords (Fixed width to prevent time shift) */}
                                      <div className={`w-24 text-right font-mono text-[14px] ${selectedStepId === step.id ? 'text-blue-200' : 'text-gray-500'}`}>
                                          {Math.round(step.x)},{Math.round(step.y)}
                                      </div>
                                  </div>
                              </div>
                            );
                        })
                    )}
                </div>

                {/* Bottom Actions */}
                <div className="flex gap-2 border-t border-white/10 pt-3 mt-2 shrink-0 relative">
                  {showSaveFeedback && (
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-green-500 text-white text-base px-2 py-1 rounded shadow-lg flex items-center gap-1 animate-in fade-in zoom-in duration-200">
                          <Check size={12}/> Saved!
                      </div>
                  )}
                  
                  <button onClick={onSaveLocal} className="flex-1 flex flex-col items-center gap-1 p-2 rounded hover:bg-blue-500/20 transition-colors text-base text-gray-400 hover:text-blue-400 group">
                    <Save size={16} className="group-hover:scale-110 transition-transform"/>
                    <span>Save</span>
                  </button>
                  
                  <button onClick={onExport} className="flex-1 flex flex-col items-center gap-1 p-2 rounded hover:bg-white/10 transition-colors text-base text-gray-400 hover:text-white group">
                    <FileJson size={16} className="group-hover:scale-110 transition-transform"/>
                    <span>Export</span>
                  </button>

                  <button onClick={onClear} className="flex-1 flex flex-col items-center gap-1 p-2 rounded hover:bg-red-500/20 transition-colors text-base text-gray-400 hover:text-red-400 group">
                    <Trash2 size={16} className="group-hover:scale-110 transition-transform"/>
                    <span>Clear</span>
                  </button>
                </div>
            </div>
        )}
      </div>

      {/* Resize Handle */}
      <div 
        onMouseDown={handleResizeMouseDown}
        onTouchStart={handleResizeTouchStart}
        className="absolute bottom-0 right-0 w-8 h-8 cursor-se-resize flex items-center justify-center text-white/30 hover:text-white/80 transition-colors z-50 touch-none"
      >
          <CornerRightDown size={14} strokeWidth={3} />
      </div>
    </div>
  );
};