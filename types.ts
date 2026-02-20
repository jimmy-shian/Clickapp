
export interface ClickStep {
  id: string;
  x: number;
  y: number;
  delay: number; // Milliseconds to wait BEFORE this step executes (relative to previous step or start)
  type: 'click' | 'double-click' | 'hold' | 'swipe';
  label?: string;

  // Swipe end coordinates (only used when type === 'swipe')
  endX?: number;
  endY?: number;
  swipeDuration?: number; // Duration of the swipe gesture in ms (default 300)

  // New fields for advanced editing
  repeat: number; // How many times to click at this location (default 1)
  repeatInterval: number; // Time between repeats in ms (default 100)
}

export interface ScriptMetadata {
  id: string; // Unique ID for storage
  name: string;
  version: string;
  loop: boolean;
  loopCount: number; // 0 for infinite
  duration?: number; // Total duration of the script in ms (start to stop)
  createdAt?: number;
  updatedAt?: number;
}

export interface ClickScript {
  metadata: ScriptMetadata;
  steps: ClickStep[];
}

export interface SavedScriptSummary {
  id: string;
  name: string;
  updatedAt: number;
  stepCount: number;
}

export enum AppMode {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PLAYING = 'PLAYING',
  EDITING = 'EDITING',
  COUNTDOWN = 'COUNTDOWN'
}
