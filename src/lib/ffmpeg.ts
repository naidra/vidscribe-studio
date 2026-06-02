// FFmpeg.wasm wrapper using local /public/wasm/ffmpeg files (no CDN).
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const inst = new FFmpeg();
    if (onLog) inst.on("log", ({ message }) => onLog(message));
    // Use absolute URLs so the worker (which has its own base) resolves them correctly.
    // We pass `classWorkerURL` pointing at our own vendored worker in /public/ to
    // bypass Vite's dep-pre-bundling of the package's internal worker.js (which
    // 404s as /node_modules/.vite/deps/worker.js in dev).
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const baseUrl = `${origin}${import.meta.env.BASE_URL}`;
    await inst.load({
      coreURL: new URL("wasm/ffmpeg/ffmpeg-core.js", baseUrl).href,
      wasmURL: new URL("wasm/ffmpeg/ffmpeg-core.wasm", baseUrl).href,
      classWorkerURL: new URL("wasm/ffmpeg/worker.js", baseUrl).href,
    });
    ffmpeg = inst;
    return inst;
  })();
  return loadPromise;
}

/**
 * Extract 16kHz mono PCM (Float32) from a video/audio file.
 * Returns the Float32Array and the original duration in seconds.
 */
export async function extractAudio16kMono(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ pcm: Float32Array; duration: number }> {
  const ff = await getFFmpeg();
  const inputName = `in_${Date.now()}_${sanitize(file.name)}`;
  const outputName = `out_${Date.now()}.pcm`;

  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress)));
  };
  ff.on("progress", progressHandler);

  await ff.writeFile(inputName, await fetchFile(file));
  // s16le PCM 16k mono is the most reliable; we'll convert to Float32 in JS.
  await ff.exec([
    "-i", inputName,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    outputName,
  ]);
  const data = await ff.readFile(outputName);
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);
  ff.off("progress", progressHandler);

  const u8 = data as Uint8Array;
  const i16 = new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
  const pcm = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) pcm[i] = i16[i] / 32768;
  const duration = pcm.length / 16000;
  return { pcm, duration };
}

export type KeepRange = { start: number; end: number };

/**
 * Cut the input file to keep only the given ranges, then concatenate them.
 * Uses re-encoding for frame-accurate cuts.
 */
export async function cutAndConcat(
  file: File,
  keep: KeepRange[],
  onProgress?: (pct: number) => void,
  onLog?: (msg: string) => void,
): Promise<Blob> {
  if (keep.length === 0) throw new Error("Nothing to keep — all words deleted.");
  const ff = await getFFmpeg(onLog);
  const inputName = `src_${Date.now()}_${sanitize(file.name)}`;
  await ff.writeFile(inputName, await fetchFile(file));

  const ext = guessExt(file.name);
  const outName = `out_${Date.now()}.${ext}`;

  // Build a single ffmpeg command using the concat filter for frame-accurate cuts.
  const args: string[] = ["-i", inputName];
  const filters: string[] = [];
  let n = 0;
  for (const { start, end } of keep) {
    if (end - start < 0.02) continue;
    filters.push(`[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS[v${n}]`);
    filters.push(`[0:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS[a${n}]`);
    n++;
  }
  if (n === 0) throw new Error("All ranges too short.");

  const concatInputs = Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${concatInputs}concat=n=${n}:v=1:a=1[outv][outa]`);
  args.push("-filter_complex", filters.join(";"));
  args.push("-map", "[outv]", "-map", "[outa]");
  // Reasonable defaults: H.264 + AAC for broad MP4 compatibility
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22");
  args.push("-c:a", "aac", "-b:a", "160k");
  args.push("-movflags", "+faststart");
  args.push(outName);

  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress)));
  };
  ff.on("progress", progressHandler);

  await ff.exec(args);
  const data = await ff.readFile(outName);
  await ff.deleteFile(inputName);
  await ff.deleteFile(outName);
  ff.off("progress", progressHandler);

  const u8 = data as Uint8Array;
  // Copy into a fresh ArrayBuffer to satisfy BlobPart typing.
  const buf = new Uint8Array(u8.byteLength);
  buf.set(u8);
  return new Blob([buf], { type: ext === "mp4" ? "video/mp4" : "video/webm" });
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

function guessExt(name: string): string {
  const m = name.toLowerCase().match(/\.(mp4|mov|m4v|webm|mkv)$/);
  if (!m) return "mp4";
  if (m[1] === "webm") return "webm";
  return "mp4";
}
