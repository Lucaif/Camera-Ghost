import type { Project } from './types';

const DB_NAME = 'ghost-camera';
const STORE = 'kv';
const KEY = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

export async function loadProjects(): Promise<Project[]> {
  try {
    const raw = await tx<unknown>('readonly', s => s.get(KEY));
    return Array.isArray(raw) ? (raw as Project[]) : [];
  } catch {
    return [];
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await tx('readwrite', s => s.put(projects, KEY));
}
