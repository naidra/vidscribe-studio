let modulePromise = null;
let moduleInstance = null;
let contextIdx = null;
let modelLoaded = false;
let activeRequestId = null;

function postSuccess(id, payload) {
  self.postMessage({ id, type: "success", payload });
}

function postError(id, error) {
  const message = error instanceof Error ? error.message : String(error);
  self.postMessage({ id, type: "error", error: message });
}

function postModelProgress(id, loaded, total) {
  self.postMessage({ id, type: "model-progress", loaded, total });
}

function postProgressLine(line) {
  if (activeRequestId == null) return;
  self.postMessage({ id: activeRequestId, type: "progress-line", line });
}

async function loadWhisperRuntime() {
  if (moduleInstance) return moduleInstance;
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    self.Module = {
      print: (text) => postProgressLine(text),
      printErr: (text) => postProgressLine(text),
      locateFile: (path) => `/wasm/whisper/${path}`,
    };

    self.importScripts("/wasm/whisper/libmain.js");

    const mod = self.Module;
    if (!mod.calledRun) {
      await new Promise((resolve) => {
        const prev = mod.onRuntimeInitialized;
        mod.onRuntimeInitialized = () => {
          if (typeof prev === "function") prev();
          resolve();
        };
        if (mod.calledRun) resolve();
      });
    }

    const init = mod.cwrap("init", "number", ["string"]);
    const freeContext = mod.cwrap("free_context", null, ["number"]);
    const whisperFullExport = mod.cwrap("whisper_full_export", "number", ["number", "number", "number", "string", "number", "boolean", "number"]);
    const nSegments = mod.cwrap("whisper_full_n_segments_export", "number", ["number"]);
    const segT0 = mod.cwrap("whisper_full_get_segment_t0_export", "number", ["number", "number"]);
    const segT1 = mod.cwrap("whisper_full_get_segment_t1_export", "number", ["number", "number"]);
    const segText = mod.cwrap("whisper_full_get_segment_text_export", "string", ["number", "number"]);

    mod.init = init;
    mod.freeContext = freeContext;
    mod.whisperFull = (idx, audio, lang, threads, translate, mode) => {
      const ptr = mod._malloc(audio.length * audio.BYTES_PER_ELEMENT);
      try {
        mod.HEAPF32.set(audio, ptr / Float32Array.BYTES_PER_ELEMENT);
        return whisperFullExport(idx, ptr, audio.length, lang, threads, translate, mode);
      } finally {
        mod._free(ptr);
      }
    };
    mod.whisperFullNSegments = nSegments;
    mod.whisperFullGetSegmentT0 = segT0;
    mod.whisperFullGetSegmentT1 = segT1;
    mod.whisperFullGetSegmentText = segText;

    moduleInstance = mod;
    return mod;
  })();

  return modulePromise;
}

const DB_NAME = "speakcut-models";
const STORE = "models";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // non-fatal
  }
}

async function ensureModelLoaded(id, modelUrl) {
  if (modelLoaded && contextIdx !== null) return;

  const mod = await loadWhisperRuntime();
  const cached = await idbGet(modelUrl);
  let bytes;

  if (cached) {
    bytes = cached;
    postModelProgress(id, cached.byteLength, cached.byteLength);
  } else {
    const resp = await fetch(modelUrl);
    if (!resp.ok || !resp.body) throw new Error(`Failed to fetch model: ${resp.status}`);

    const total = Number(resp.headers.get("content-length") || 0);
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        postModelProgress(id, received, total);
      }
    }

    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    await idbPut(modelUrl, bytes);
  }

  try {
    mod.FS_unlink && mod.FS_unlink("whisper.bin");
  } catch {
    // ignore
  }

  mod.FS_createDataFile("/", "whisper.bin", bytes, true, true, true);
  const idx = mod.init("whisper.bin");
  if (!idx) throw new Error("whisper.init failed (idx=0)");

  contextIdx = idx;
  modelLoaded = true;
}

function modeToFlag(mode) {
  return mode === "precise" ? 1 : 0;
}

function toNumber(value) {
  return typeof value === "bigint" ? Number(value) : value;
}

async function transcribeInWorker(id, data) {
  const mod = await loadWhisperRuntime();
  if (contextIdx === null) throw new Error("Model not loaded");

  activeRequestId = id;
  try {
    const audio = new Float32Array(data.audioBuffer);
    const ret = mod.whisperFull(
      contextIdx,
      audio,
      data.lang || "en",
      data.threads || 4,
      !!data.translate,
      modeToFlag(data.mode),
    );
    if (ret !== 0) throw new Error(`whisper_full returned ${ret}`);

    const segments = [];
    const count = mod.whisperFullNSegments(contextIdx);
    for (let i = 0; i < count; i++) {
      const text = mod.whisperFullGetSegmentText(contextIdx, i).trim();
      if (text) {
        const start = toNumber(mod.whisperFullGetSegmentT0(contextIdx, i));
        const end = toNumber(mod.whisperFullGetSegmentT1(contextIdx, i));
        segments.push({
          id: i,
          start: start / 100,
          end: end / 100,
          text,
        });
      }
    }
    return segments;
  } finally {
    activeRequestId = null;
  }
}

self.onmessage = async (event) => {
  const data = event.data;
  const id = data.id;

  try {
    switch (data.type) {
      case "loadWhisper":
        await loadWhisperRuntime();
        postSuccess(id, null);
        break;
      case "loadModel":
        await ensureModelLoaded(id, data.modelUrl);
        postSuccess(id, null);
        break;
      case "transcribe": {
        const segments = await transcribeInWorker(id, data);
        postSuccess(id, segments);
        break;
      }
      default:
        throw new Error(`Unknown whisper worker message: ${data.type}`);
    }
  } catch (error) {
    postError(id, error);
  }
};
