export type Segment = {
  id: number;
  start: number;
  end: number;
  text: string;
};

export type TranscriptionMode = "fast" | "precise";

export type TranscribeOptions = {
  audio: Float32Array;
  lang?: string;
  threads?: number;
  translate?: boolean;
  mode?: TranscriptionMode;
  onProgressLine?: (line: string) => void;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  onModelProgress?: (loaded: number, total: number) => void;
  onProgressLine?: (line: string) => void;
};

type WorkerSuccessMessage = {
  id: number;
  type: "success";
  payload?: any;
};

type WorkerErrorMessage = {
  id: number;
  type: "error";
  error: string;
};

type WorkerModelProgressMessage = {
  id: number;
  type: "model-progress";
  loaded: number;
  total: number;
};

type WorkerProgressLineMessage = {
  id: number;
  type: "progress-line";
  line: string;
};

type WorkerMessage =
  | WorkerSuccessMessage
  | WorkerErrorMessage
  | WorkerModelProgressMessage
  | WorkerProgressLineMessage;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker("/whisper-worker.js");
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    const request = pending.get(msg.id);
    if (!request) return;

    if (msg.type === "model-progress") {
      request.onModelProgress?.(msg.loaded, msg.total);
      return;
    }

    if (msg.type === "progress-line") {
      request.onProgressLine?.(msg.line);
      return;
    }

    pending.delete(msg.id);

    if (msg.type === "success") {
      request.resolve(msg.payload);
      return;
    }

    request.reject(new Error(msg.error));
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || "Whisper worker crashed.");
    for (const [, request] of pending) {
      request.reject(error);
    }
    pending.clear();
    worker = null;
  };

  return worker;
}

function callWorker<T>(
  type: string,
  payload: Record<string, unknown> = {},
  transfer: Transferable[] = [],
  hooks: Pick<PendingRequest, "onModelProgress" | "onProgressLine"> = {},
): Promise<T> {
  const id = nextRequestId++;
  const instance = getWorker();

  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, ...hooks });
    instance.postMessage({ id, type, ...payload }, transfer);
  });
}

export async function loadWhisper(): Promise<void> {
  await callWorker("loadWhisper");
}

export async function loadModel(
  modelUrl: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  await callWorker(
    "loadModel",
    { modelUrl },
    [],
    { onModelProgress: onProgress },
  );
}

export async function transcribe(opts: TranscribeOptions): Promise<Segment[]> {
  const audio = opts.audio;
  return await callWorker<Segment[]>(
    "transcribe",
    {
      audioBuffer: audio.buffer,
      lang: opts.lang ?? "en",
      threads: opts.threads ?? Math.min(8, navigator.hardwareConcurrency || 4),
      translate: opts.translate ?? false,
      mode: opts.mode ?? "fast",
    },
    [audio.buffer],
    { onProgressLine: opts.onProgressLine },
  );
}
