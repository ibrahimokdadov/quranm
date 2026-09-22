const DB_NAME = "tarteel-models";
const STORE_NAME = "models";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getFromCache(key: string): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveToCache(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(data, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Model storage failed")); };
    req.onerror = () => reject(req.error);
  });
}

export async function loadModel(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
  cacheKey: string = url,
): Promise<ArrayBuffer> {
  // Try IndexedDB cache first
  const cached = await getFromCache(cacheKey);
  if (cached) return cached;

  // Download with progress
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Model download failed: ${response.status}`);
  const total = parseInt(response.headers.get("content-length") || "0");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }

  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  await saveToCache(cacheKey, buffer.buffer);
  return buffer.buffer;
}
