// Whisper.cpp WASM loader — uses vendored /public/wasm/whisper/libmain.js
// The wasm binary is embedded inside libmain.js (single-file emscripten build).
// Output is captured from emscripten's print() callback as `[start --> end]  text` lines.

export type Segment = {
  id: number;
  start: number; // seconds
  end: number;   // seconds
  text: string;
};

type WhisperModule = {
  init: (path: string) => number;
  free: (idx: number) => void;
  full_default: (idx: number, audio: Float32Array, lang: string, threads: number, translate: boolean) => number;
  FS_createDataFile: (parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean, canOwn: boolean) => void;
  FS_unlink?: (path: string) => void;
};

let modulePromise: Promise<WhisperModule> | null = null;
let moduleInstance: WhisperModule | null = null;
let contextIdx: number | null = null;
let modelLoaded = false;

// Buffer for stdout collection during a transcription run.
let printBuffer: string[] = [];
let onPrintLine: ((line: string) => void) | null = null;

function emitLine(line: string) {
  printBuffer.push(line);
  onPrintLine?.(line);
}

async function loadScriptOnce(src: string): Promise<void> {
  if (document.querySelector(`script[data-src="${src}"]`)) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export async function loadWhisper(): Promise<WhisperModule> {
  if (moduleInstance) return moduleInstance;
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    if (typeof window !== "undefined" && !window.crossOriginIsolated) {
      throw new Error("This Whisper WASM build requires cross-origin isolation. Reload the app after the dev server sends COOP/COEP headers.");
    }

    // Pre-configure the global Module object that libmain.js looks for.
    (window as any).Module = {
      print: (text: string) => emitLine(text),
      printErr: (text: string) => emitLine(text),
      locateFile: (path: string) => `/wasm/whisper/${path}`,
      // Single-file build embeds wasm; no extra fetch needed.
    };

    await loadScriptOnce("/wasm/whisper/libmain.js");

    // Wait for the runtime to finish initializing.
    const mod = (window as any).Module as WhisperModule & { onRuntimeInitialized?: () => void; calledRun?: boolean };
    if (!(mod as any).calledRun) {
      await new Promise<void>((resolve) => {
        const prev = (mod as any).onRuntimeInitialized;
        (mod as any).onRuntimeInitialized = () => {
          prev?.();
          resolve();
        };
        // In case it already ran between the check and now
        if ((mod as any).calledRun) resolve();
      });
    }

    moduleInstance = mod;
    return mod;
  })();

  return modulePromise;
}

export async function loadModel(
  modelUrl: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  if (modelLoaded && contextIdx !== null) return;
  const mod = await loadWhisper();

  // Try IndexedDB cache first
  const cached = await idbGet(modelUrl);
  let bytes: Uint8Array;
  if (cached) {
    bytes = cached;
    onProgress?.(cached.byteLength, cached.byteLength);
  } else {
    const resp = await fetch(modelUrl);
    if (!resp.ok || !resp.body) throw new Error(`Failed to fetch model: ${resp.status}`);
    const total = Number(resp.headers.get("content-length") || 0);
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    await idbPut(modelUrl, bytes);
  }

  // Mount the model into MEMFS, then init.
  try {
    (mod as any).FS_unlink?.("whisper.bin");
  } catch {/* ignore */}
  mod.FS_createDataFile("/", "whisper.bin", bytes, true, true, true);
  const idx = mod.init("whisper.bin");
  if (!idx) throw new Error("whisper.init failed (idx=0)");
  contextIdx = idx;
  modelLoaded = true;
}

export type TranscribeOptions = {
  audio: Float32Array; // 16kHz mono PCM
  lang?: string;
  threads?: number;
  translate?: boolean;
  onProgressLine?: (line: string) => void;
};

const TS_LINE = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;

function parseTimestamp(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export async function transcribe(opts: TranscribeOptions): Promise<Segment[]> {
  const mod = await loadWhisper();
  if (contextIdx === null) throw new Error("Model not loaded");

  printBuffer = [];
  onPrintLine = opts.onProgressLine ?? null;

  const ret = mod.full_default(
    contextIdx,
    opts.audio,
    opts.lang ?? "en",
    opts.threads ?? Math.min(8, navigator.hardwareConcurrency || 4),
    opts.translate ?? false,
  );
  if (ret !== 0) throw new Error(`full_default returned ${ret}`);

  // The C++ code spawns a std::thread; we need to wait until processing is done.
  // The print callback emits "whisper_print_timings:" lines at the very end.
  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const timeoutMs = 30 * 60 * 1000;
    const check = () => {
      const last = printBuffer[printBuffer.length - 1] || "";
      const done = printBuffer.some((l) => /whisper_print_timings:.*total time/.test(l));
      if (done) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Transcription timed out"));
      setTimeout(check, 200);
    };
    check();
  });

  // Parse segments from buffered lines
  const segments: Segment[] = [];
  let id = 0;
  for (const raw of printBuffer) {
    const line = raw.trim();
    const m = line.match(TS_LINE);
    if (m) {
      const start = parseTimestamp(m[1], m[2], m[3], m[4]);
      const end = parseTimestamp(m[5], m[6], m[7], m[8]);
      const text = m[9].trim();
      if (text) segments.push({ id: id++, start, end, text });
    }
  }
  onPrintLine = null;
  return segments;
}

// --- Tiny IndexedDB cache for the model ---
const DB_NAME = "speakcut-models";
const STORE = "models";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  try {
    const db = await idbOpen();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* non-fatal */ }
}
