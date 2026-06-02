import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Cpu, Lock, Scissors, ShieldCheck, Zap } from "lucide-react";
import { FileDrop } from "@/components/FileDrop";
import { StageProgress } from "@/components/StageProgress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TranscriptEditor } from "@/components/TranscriptEditor";
import { extractAudio16kMono, cutAndConcat, createPreviewVideo, getFFmpeg } from "@/lib/ffmpeg";
import { loadModel, transcribe, loadWhisper, type Segment, type TranscriptionMode } from "@/lib/whisper";
import { segmentsToTokens, tokensToKeepRanges, type Token } from "@/lib/transcript";
import { toast } from "sonner";

type Stage =
  | { kind: "idle" }
  | { kind: "loading-engine"; detail: string }
  | { kind: "loading-model"; progress: number; detail: string }
  | { kind: "extracting-audio"; progress: number }
  | { kind: "creating-preview"; progress: number }
  | { kind: "transcribing"; detail: string }
  | { kind: "ready" };

const MODEL_URL = `${import.meta.env.BASE_URL}models/ggml-tiny.en.bin`;

export default function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [tokens, setTokens] = useState<Token[]>([]);
  const [duration, setDuration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>(() => {
    const saved = window.localStorage.getItem("speakcut-transcription-mode");
    return saved === "precise" ? "precise" : "fast";
  });

  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("speakcut-transcription-mode", transcriptionMode);
  }, [transcriptionMode]);

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

      setStage({ kind: "loading-engine", detail: "Loading ffmpeg.wasm (local)…" });
      await getFFmpeg();

      setStage({ kind: "loading-engine", detail: "Loading whisper.cpp (local)…" });
      await loadWhisper();

      setStage({ kind: "loading-model", progress: 0, detail: "ggml-tiny.en (≈75 MB)" });
      await loadModel(MODEL_URL, (loaded, total) => {
        const p = total > 0 ? loaded / total : 0;
        setStage({
          kind: "loading-model",
          progress: p,
          detail: `ggml-tiny.en · ${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`,
        });
      });

      setStage({ kind: "extracting-audio", progress: 0 });
      const { pcm, duration: dur } = await extractAudio16kMono(f, (p) =>
        setStage({ kind: "extracting-audio", progress: p }),
      );
      setDuration(dur);

      setStage({ kind: "creating-preview", progress: 0 });
      try {
        const previewBlob = await createPreviewVideo(f, (p) =>
          setStage({ kind: "creating-preview", progress: p }),
        );
        const previewUrl = URL.createObjectURL(previewBlob);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = previewUrl;
        setVideoUrl(previewUrl);
      } catch (previewErr) {
        console.warn("Preview transcode failed, falling back to original video.", previewErr);
      }

      setStage({ kind: "transcribing", detail: "Listening to your video…" });
      const segments: Segment[] = await transcribe({
        audio: pcm,
        lang: "en",
        mode: transcriptionMode,
        onProgressLine: (line) => {
          if (line.startsWith("whisper_") || line.startsWith("system_")) return;
          if (line.trim().length === 0) return;
          setStage({
            kind: "transcribing",
            detail: line.length > 80 ? `${line.slice(0, 80)}…` : line,
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
  }, [reset, transcriptionMode]);

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

      <div className="container max-w-7xl flex-1 py-6 md:py-10">
        {stage.kind === "idle" && !file && (
          <Hero
            onFile={handleFile}
            modePicker={<TranscriptionModePicker mode={transcriptionMode} onModeChange={setTranscriptionMode} />}
          />
        )}

        {stage.kind !== "idle" && stage.kind !== "ready" && (
          <ProcessingPanel stage={stage} fileName={file?.name} onCancel={reset} mode={transcriptionMode} />
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

function TranscriptionModePicker({
  mode,
  onModeChange,
}: {
  mode: TranscriptionMode;
  onModeChange: (mode: TranscriptionMode) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-[24px] border border-border/70 bg-panel/75 p-4 shadow-[var(--shadow-elev)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Transcription mode</p>
        <p className="text-sm text-muted-foreground">
          Fast is quicker for most clips. Precise uses stricter Whisper timing for finer word splits.
        </p>
      </div>
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(value) => {
          if (value === "fast" || value === "precise") onModeChange(value);
        }}
        className="justify-start rounded-full border border-border/70 bg-card/70 p-1"
      >
        <ToggleGroupItem value="fast" className="rounded-full px-4 text-xs font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          Fast
        </ToggleGroupItem>
        <ToggleGroupItem value="precise" className="rounded-full px-4 text-xs font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          Precise
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container max-w-7xl flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-accent text-accent-foreground glow-ring">
            <Scissors className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-serif text-xl leading-none">Speakcut</h1>
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-muted-foreground">
              Edit video by deleting words
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
      </div>
    </header>
  );
}

function Hero({ onFile, modePicker }: { onFile: (f: File) => void; modePicker: ReactNode }) {
  return (
    <div className="grid gap-12 py-8 md:gap-16 md:py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.25, 1, 0.5, 1] }}
        className="mx-auto max-w-4xl space-y-6 text-center"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs shadow-sm backdrop-blur-md">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-sky opacity-75 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          <span className="text-muted-foreground">Runs entirely in your browser. Your video never leaves this tab.</span>
        </div>

        <div className="space-y-4">
          <h2 className="font-serif text-5xl leading-[1.02] tracking-tight md:text-7xl">
            Edit video like a <em className="text-accent not-italic">document</em>.
            <br />
            Delete words, the cuts follow.
          </h2>
        </div>
      </motion.div>

      <div className="mx-auto w-full max-w-2xl space-y-4">
        {modePicker}
        <FileDrop onFile={onFile} />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3"
      >
        <Feature
          n="01"
          title="Local transcription"
          body="whisper.cpp compiled to WASM runs the tiny.en model directly in your browser. The model is cached after the first download."
        />
        <Feature
          n="02"
          title="Transcript-first editing"
          body="Click words and phrases to remove them from the cut. Shift-click range selection keeps edits fast and precise."
        />
        <Feature
          n="03"
          title="Reliable export"
          body="ffmpeg.wasm trims, re-encodes, and packages the kept ranges into a download-ready MP4 with a polished finish."
        />
      </motion.div>
    </div>
  );
}

function Feature({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="surface-card rounded-[24px] p-6">
      <p className="font-mono text-xs text-accent">{n}</p>
      <h3 className="mt-3 font-serif text-xl">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function ProcessingPanel({
  stage,
  fileName,
  onCancel,
  mode,
}: {
  stage: Exclude<Stage, { kind: "idle" } | { kind: "ready" }>;
  fileName?: string;
  onCancel: () => void;
  mode: TranscriptionMode;
}) {
  const { label, detail, progress } = useMemo(() => {
    switch (stage.kind) {
      case "loading-engine":
        return { label: "Booting engines", detail: stage.detail, progress: undefined };
      case "loading-model":
        return { label: "Downloading model", detail: stage.detail, progress: stage.progress };
      case "extracting-audio":
        return { label: "Extracting audio", detail: "ffmpeg -> 16kHz mono PCM", progress: stage.progress };
      case "creating-preview":
        return { label: "Preparing preview", detail: "Creating a browser-friendly MP4 preview", progress: stage.progress };
      case "transcribing":
        return { label: "Transcribing", detail: stage.detail, progress: undefined };
    }
  }, [stage]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-2xl space-y-6 py-12 md:py-20"
    >
      <div className="space-y-2 text-center">
        <h2 className="font-serif text-3xl md:text-4xl">Working on it…</h2>
        {fileName && (
          <p className="truncate font-mono text-sm text-muted-foreground">{fileName}</p>
        )}
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {mode === "fast" ? "Fast mode" : "Precise mode"}
        </p>
      </div>
      <StageProgress label={label} detail={detail} progress={progress} />
      <div className="text-center">
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel and start over
        </button>
      </div>
    </motion.div>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="container max-w-7xl flex items-center justify-between py-5 text-xs text-muted-foreground">
        <p>© Speakcut · Built with whisper.cpp & ffmpeg.wasm</p>
      </div>
    </footer>
  );
}
