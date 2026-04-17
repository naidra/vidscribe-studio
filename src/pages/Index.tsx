import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Scissors, Cpu, Lock, Zap } from "lucide-react";
import { FileDrop } from "@/components/FileDrop";
import { StageProgress } from "@/components/StageProgress";
import { TranscriptEditor } from "@/components/TranscriptEditor";
import { extractAudio16kMono, cutAndConcat, getFFmpeg } from "@/lib/ffmpeg";
import { loadModel, transcribe, loadWhisper, type Segment } from "@/lib/whisper";
import { segmentsToTokens, tokensToKeepRanges, type Token } from "@/lib/transcript";
import { toast } from "sonner";

type Stage =
  | { kind: "idle" }
  | { kind: "loading-engine"; detail: string }
  | { kind: "loading-model"; progress: number; detail: string }
  | { kind: "extracting-audio"; progress: number }
  | { kind: "transcribing"; detail: string }
  | { kind: "ready" };

const MODEL_URL = "/models/ggml-tiny.en.bin";

export default function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [tokens, setTokens] = useState<Token[]>([]);
  const [duration, setDuration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const objectUrlRef = useRef<string | null>(null);

  // Cleanup object URL on unmount/reset
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setFile(null);
    setVideoUrl(null);
    setTokens([]);
    setDuration(0);
    setStage({ kind: "idle" });
  }, []);

  const handleFile = useCallback(async (f: File) => {
    try {
      setFile(f);
      const url = URL.createObjectURL(f);
      objectUrlRef.current = url;
      setVideoUrl(url);

      // 1. Load ffmpeg core
      setStage({ kind: "loading-engine", detail: "Loading ffmpeg.wasm (local)…" });
      await getFFmpeg();

      // 2. Load whisper engine
      setStage({ kind: "loading-engine", detail: "Loading whisper.cpp (local)…" });
      await loadWhisper();

      // 3. Load model (with progress)
      setStage({ kind: "loading-model", progress: 0, detail: "ggml-tiny.en (≈75 MB)" });
      await loadModel(MODEL_URL, (loaded, total) => {
        const p = total > 0 ? loaded / total : 0;
        setStage({
          kind: "loading-model",
          progress: p,
          detail: `ggml-tiny.en · ${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`,
        });
      });

      // 4. Extract audio
      setStage({ kind: "extracting-audio", progress: 0 });
      const { pcm, duration: dur } = await extractAudio16kMono(f, (p) =>
        setStage({ kind: "extracting-audio", progress: p }),
      );
      setDuration(dur);

      // 5. Transcribe
      setStage({ kind: "transcribing", detail: "Listening to your video…" });
      const segments: Segment[] = await transcribe({
        audio: pcm,
        lang: "en",
        onProgressLine: (line) => {
          // Surface only meaningful lines
          if (line.startsWith("whisper_") || line.startsWith("system_")) return;
          if (line.trim().length === 0) return;
          setStage({
            kind: "transcribing",
            detail: line.length > 80 ? line.slice(0, 80) + "…" : line,
          });
        },
      });

      const toks = segmentsToTokens(segments);
      if (toks.length === 0) {
        toast.error("No speech detected in this video.");
        reset();
        return;
      }
      setTokens(toks);
      setStage({ kind: "ready" });
      toast.success(`Transcribed ${toks.length} words.`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
      reset();
    }
  }, [reset]);

  const handleExport = useCallback(async () => {
    if (!file) return;
    const ranges = tokensToKeepRanges(tokens, duration);
    if (ranges.length === 0) {
      toast.error("Nothing left to export — all words are deleted.");
      return;
    }
    setExporting(true);
    setExportProgress(0);
    try {
      const blob = await cutAndConcat(file, ranges, (p) => setExportProgress(p));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = file.name.replace(/\.[^.]+$/, "");
      a.download = `${base}-edited.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("Exported! Check your downloads.");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }, [file, tokens, duration]);

  return (
    <main className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1 container max-w-7xl py-6 md:py-10">
        {stage.kind === "idle" && !file && <Hero onFile={handleFile} />}

        {stage.kind !== "idle" && stage.kind !== "ready" && (
          <ProcessingPanel stage={stage} fileName={file?.name} onCancel={reset} />
        )}

        {stage.kind === "ready" && file && videoUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="h-[calc(100vh-12rem)] min-h-[600px]"
          >
            <TranscriptEditor
              videoUrl={videoUrl}
              fileName={file.name}
              duration={duration}
              tokens={tokens}
              onChange={setTokens}
              onExport={handleExport}
              exporting={exporting}
              exportProgress={exportProgress}
              onReset={reset}
            />
          </motion.div>
        )}
      </div>

      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="border-b border-border/60 backdrop-blur-md bg-background/60 sticky top-0 z-30">
      <div className="container max-w-7xl flex items-center justify-between py-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-accent text-accent-foreground">
            <Scissors className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-serif text-xl leading-none">Speakcut</h1>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Edit video by deleting words
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> 100% local
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Cpu className="h-3 w-3" /> whisper.cpp WASM
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-3 w-3" /> ffmpeg.wasm
          </span>
        </div>
      </div>
    </header>
  );
}

function Hero({ onFile }: { onFile: (f: File) => void }) {
  return (
    <div className="grid gap-12 md:gap-16 py-8 md:py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.25, 1, 0.5, 1] }}
        className="text-center max-w-3xl mx-auto space-y-5"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1 text-xs">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent" />
          </span>
          <span className="text-muted-foreground">Runs entirely in your browser. Your video never leaves this tab.</span>
        </div>
        <h2 className="font-serif text-5xl md:text-7xl leading-[1.05] tracking-tight">
          Edit video like a <em className="text-accent not-italic">document</em>.
          <br />
          Delete words, the cuts follow.
        </h2>
        <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
          Upload a video. We transcribe it locally with whisper.cpp, then let you
          remove sentences with a click. Export the final cut with ffmpeg.wasm —
          no servers, no uploads.
        </p>
      </motion.div>

      <div className="max-w-2xl w-full mx-auto">
        <FileDrop onFile={onFile} />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto"
      >
        <Feature n="01" title="Local transcription" body="whisper.cpp compiled to WASM runs the tiny.en model in your browser. The model is cached after first download." />
        <Feature n="02" title="Edit in the transcript" body="Click any phrase to remove it from the timeline. Selection ranges supported with Shift-click." />
        <Feature n="03" title="Frame-accurate export" body="ffmpeg.wasm cuts and re-encodes the kept ranges into a clean MP4 you can download." />
      </motion.div>
    </div>
  );
}

function Feature({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="surface-card p-5">
      <p className="font-mono text-xs text-accent">{n}</p>
      <h3 className="mt-2 font-serif text-xl">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function ProcessingPanel({
  stage,
  fileName,
  onCancel,
}: {
  stage: Exclude<Stage, { kind: "idle" } | { kind: "ready" }>;
  fileName?: string;
  onCancel: () => void;
}) {
  const { label, detail, progress } = useMemo(() => {
    switch (stage.kind) {
      case "loading-engine":
        return { label: "Booting engines", detail: stage.detail, progress: undefined };
      case "loading-model":
        return { label: "Downloading model", detail: stage.detail, progress: stage.progress };
      case "extracting-audio":
        return { label: "Extracting audio", detail: "ffmpeg → 16kHz mono PCM", progress: stage.progress };
      case "transcribing":
        return { label: "Transcribing", detail: stage.detail, progress: undefined };
    }
  }, [stage]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto py-12 md:py-20 space-y-6"
    >
      <div className="text-center space-y-2">
        <h2 className="font-serif text-3xl md:text-4xl">Working on it…</h2>
        {fileName && (
          <p className="text-sm text-muted-foreground font-mono truncate">{fileName}</p>
        )}
      </div>
      <StageProgress label={label} detail={detail} progress={progress} />
      <div className="text-center">
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel and start over
        </button>
      </div>
    </motion.div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 mt-auto">
      <div className="container max-w-7xl py-5 flex items-center justify-between text-xs text-muted-foreground">
        <p>© Speakcut · Built with whisper.cpp & ffmpeg.wasm</p>
        <p className="font-mono">No data leaves your browser.</p>
      </div>
    </footer>
  );
}
