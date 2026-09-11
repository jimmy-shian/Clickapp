import { v4 as uuidv4 } from 'uuid';
import { ClickScript, ClickStep } from '../types';

export interface ConvertedSheet {
  script: ClickScript;
  stepCount: number;
}

/** 樂譜 JSON + 版面腳本 JSON → 可播放腳本（純邏輯；失敗時 throw Error，訊息可直接 alert） */
export async function convertSheetFiles(songFile: File, mapFile: File): Promise<ConvertedSheet> {
  const songText = await songFile.text();
  const mapText = await mapFile.text();

  let songData;
  let mapData;
  try {
    songData = JSON.parse(songText);
    mapData = JSON.parse(mapText);
  } catch {
    throw new Error('Error parsing JSON files. Please check format.');
  }

  // 1. Process Song Data（相容陣列包裝）
  const songEntry = Array.isArray(songData) ? songData[0] : songData;
  if (!songEntry || !songEntry.songNotes) {
    throw new Error("Invalid Song JSON format. Missing 'songNotes'.");
  }
  const notes = songEntry.songNotes.sort((a: any, b: any) => a.time - b.time);

  // 2. Process Map Data
  if (!mapData.steps || mapData.steps.length < 15) {
    throw new Error('Layout script must have at least 15 steps (Key1 to Key15).');
  }

  // 3. Generate Steps
  const newSteps: ClickStep[] = [];
  let previousTime = 0;
  for (const note of notes) {
    const keyMatch = note.key && note.key.match(/Key(\d+)/);
    if (!keyMatch) continue;

    const keyNum = parseInt(keyMatch[1], 10);
    const stepIndex = keyNum - 1;
    if (stepIndex < 0 || stepIndex >= mapData.steps.length) {
      console.warn(`Key${keyNum} out of bounds for layout script.`);
      continue;
    }
    const targetPos = mapData.steps[stepIndex];
    const delay = Math.max(0, note.time - previousTime);
    newSteps.push({
      id: uuidv4(),
      x: targetPos.x,
      y: targetPos.y,
      delay,
      type: 'click',
      repeat: 1,
      repeatInterval: 100,
    });
    previousTime = note.time;
  }

  if (newSteps.length === 0) {
    throw new Error('No valid notes converted.');
  }

  const now = Date.now();
  const script: ClickScript = {
    metadata: {
      id: uuidv4(),
      name: `Converted: ${songEntry.name || 'Song'}`,
      version: '1.0',
      loop: false,
      loopCount: 0,
      createdAt: now,
      updatedAt: now,
      duration: previousTime + 1000,
    },
    steps: newSteps,
  };
  return { script, stepCount: newSteps.length };
}
