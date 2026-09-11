import { v4 as uuidv4 } from 'uuid';
import { ClickScript, SavedScriptSummary } from '../types';

const STORAGE_KEY = 'omniclick_scripts';

type StoredScripts = Record<string, ClickScript>;

function readAll(): StoredScripts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredScripts) : {};
  } catch (e) {
    console.error('Failed to read scripts from storage', e);
    return {};
  }
}

function writeAll(all: StoredScripts): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** 摘要列表（依更新時間新到舊） */
export function loadScriptSummaries(): SavedScriptSummary[] {
  try {
    const summary: SavedScriptSummary[] = Object.values(readAll()).map((s: any) => ({
      id: s.metadata.id,
      name: s.metadata.name,
      updatedAt: s.metadata.updatedAt || Date.now(),
      stepCount: s.steps.length,
    }));
    summary.sort((a, b) => b.updatedAt - a.updatedAt);
    return summary;
  } catch (e) {
    console.error('Failed to load scripts', e);
    return [];
  }
}

/** 儲存（自動刷新 updatedAt，回傳更新後的 script） */
export function saveScript(scriptToSave: ClickScript): ClickScript {
  try {
    const allScripts = readAll();
    const updatedScript: ClickScript = {
      ...scriptToSave,
      metadata: { ...scriptToSave.metadata, updatedAt: Date.now() },
    };
    allScripts[updatedScript.metadata.id] = updatedScript;
    writeAll(allScripts);
    return updatedScript;
  } catch (e) {
    console.error('Storage error', e);
    throw new Error('Failed to save to local storage.');
  }
}

/** 依 id 載入；不存在回傳 null */
export function loadScriptById(id: string): ClickScript | null {
  try {
    return readAll()[id] ?? null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** 依 id 刪除（不存在視為成功） */
export function deleteScriptById(id: string): void {
  try {
    const allScripts = readAll();
    if (allScripts[id]) {
      delete allScripts[id];
      writeAll(allScripts);
    }
  } catch (e) {
    console.error(e);
  }
}

const generateUniqueNewScriptName = (): string => {
  const baseName = 'New Script';
  try {
    if (typeof window === 'undefined') return `${baseName} #1`;
  } catch {
    return `${baseName} #1`;
  }

  try {
    const allScripts = Object.values(readAll());
    const regex = /^New Script(?: #(\d+))?$/;
    let maxIndex = 0;
    for (const s of allScripts) {
      const name: string | undefined = s && s.metadata && s.metadata.name;
      if (!name) continue;
      const match = name.match(regex);
      if (!match) continue;
      const n = match[1] ? parseInt(match[1], 10) : 0;
      if (!isNaN(n) && n > maxIndex) maxIndex = n;
    }
    return `${baseName} #${maxIndex + 1}`;
  } catch (e) {
    console.error('Failed to generate unique script name', e);
    return `${baseName} #1`;
  }
};

export function createNewScript(): ClickScript {
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
      duration: 0,
    },
    steps: [],
  };
}
