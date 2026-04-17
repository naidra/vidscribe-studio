import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, Trash2, RotateCcw, Download, Sparkles, Volume2 } from "lucide-react";
import type { Token } from "@/lib/transcript";
import { formatTime, tokensToKeepRanges, totalKeepDuration } from "@/lib/transcript";
import { Button } from "@/components/ui/button";

type Props = {
  videoUrl: string;
  fileName: string;
  duration: number;
  tokens: Token[];
  onChange: (tokens: Token[]) => void;
  onExport: () => void;
  exporting: boolean;
  exportProgress: number;
  onReset: () => void;
};

export function TranscriptEditor({
  videoUrl,
  fileName,
  duration,
  tokens,
  onChange,
  onExport,
  exporting,
  exportProgress,
  onReset,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);

  const keepRanges = useMemo(
    () => tokensToKeepRanges(tokens, duration),
    [tokens, duration],
  );
  const finalDuration = useMemo(() => totalKeepDuration(keepRanges), [keepRanges]);
  const deletedCount = useMemo(() => tokens.filter((t) => t.deleted).length, [tokens]);

  // Sync video time
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onT = () => setTime(v.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onT);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onT);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [videoUrl]);

  // Preview mode: when playing, skip over deleted regions
  useEffect(() => {
    if (!previewMode) return;
    const v = videoRef.current;
    if (!v) return;
    const tick = () => {
      const t = v.currentTime;
      // Find current token at time t
      const token = tokens.find((tok) => t >= tok.start && t < tok.end);
      if (token?.deleted) {
        // Jump to next non-deleted token's start
        const next = tokens.find((tok) => tok.start >= t && !tok.deleted);
        if (next) v.currentTime = next.start;
        else v.pause();
      }
    };
    const id = window.setInterval(tick, 80);
    return () => window.clearInterval(id);
  }, [previewMode, tokens]);

  // Auto-scroll active token into view
  const activeId = useMemo(() => {
    const t = tokens.find((tok) => time >= tok.start && time < tok.end);
    return t?.id ?? null;
  }, [tokens, time]);

  useEffect(() => {
    if (activeId == null) return;
    const el = transcriptRef.current?.querySelector<HTMLElement>(`[data-tid="${activeId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId]);

  function toggleToken(id: number, withRange = false) {
    if (withRange && selectionStart != null) {
      const a = Math.min(selectionStart, id);
      const b = Math.max(selectionStart, id);
      const target = !tokens.find((t) => t.id === selectionStart)?.deleted;
      onChange(tokens.map((t) => (t.id >= a && t.id <= b ? { ...t, deleted: target } : t)));
      setSelectionStart(null);
      return;
    }
    setSelectionStart(id);
    onChange(tokens.map((t) => (t.id === id ? { ...t, deleted: !t.deleted } : t)));
  }

  function restoreAll() {
    onChange(tokens.map((t) => ({ ...t, deleted: false })));
  }

  function seek(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  // Group tokens by paragraph (by segmentId, but coalesce small ones)
  const paragraphs = useMemo(() => {
    const groups: Token[][] = [];
    let cur: Token[] = [];
    let lastSeg = -1;
    for (const t of tokens) {
      if (t.segmentId !== lastSeg && cur.length > 12) {
        groups.push(cur);
        cur = [];
      }
      cur.push(t);
      lastSeg = t.segmentId;
    }
    if (cur.length) groups.push(cur);
    return groups;
  }, [tokens]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 h-full">
      {/* Video panel */}
      <div className="space-y-4">
        <div className="surface-card overflow-hidden">
          <div className="relative bg-black aspect-video">
            <video
              ref={videoRef}
              src={videoUrl}
              className="h-full w-full"
              onClick={togglePlay}
              playsInline
            />
          </div>
          <div className="p-4 space-y-3">
            {/* Timeline visualization */}
            <div className="relative h-8 rounded-lg bg-muted overflow-hidden">
              {keepRanges.map((r, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 bg-accent/30"
                  style={{
                    left: `${(r.start / duration) * 100}%`,
                    width: `${((r.end - r.start) / duration) * 100}%`,
                  }}
                />
              ))}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-foreground"
                style={{ left: `${(time / duration) * 100}%` }}
              />
              <button
                className="absolute inset-0 cursor-pointer"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  seek(pct * duration);
                }}
                aria-label="Seek"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="default"
                onClick={togglePlay}
                className="h-10 w-10 rounded-full bg-foreground text-background hover:bg-foreground/90"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </Button>
              <div className="font-mono text-sm tabular-nums text-muted-foreground">
                {formatTime(time)} <span className="text-border">/</span> {formatTime(duration)}
              </div>
              <div className="flex-1" />
              <button
                onClick={() => setPreviewMode((v) => !v)}
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  previewMode
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
                ].join(" ")}
                title="Preview the result by skipping over deleted parts during playback"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Preview cuts
              </button>
            </div>
          </div>
        </div>

        {/* Stats card */}
        <div className="surface-card p-5">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Original" value={formatTime(duration)} />
            <Stat label="Final" value={formatTime(finalDuration)} accent={finalDuration < duration} />
            <Stat
              label="Removed"
              value={formatTime(duration - finalDuration)}
              destructive={deletedCount > 0}
            />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button
              onClick={onExport}
              disabled={exporting || finalDuration < 0.1}
              className="flex-1 bg-gradient-accent text-accent-foreground hover:opacity-90 shadow-glow border-0 h-11 font-medium"
            >
              {exporting ? (
                <>
                  <Volume2 className="h-4 w-4 mr-2 animate-pulse" />
                  Exporting {Math.round(exportProgress * 100)}%
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export edited video
                </>
              )}
            </Button>
            {deletedCount > 0 && (
              <Button variant="outline" onClick={restoreAll} className="h-11">
                <RotateCcw className="h-4 w-4 mr-2" />
                Restore all
              </Button>
            )}
          </div>
          {exporting && (
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full progress-bar rounded-full transition-all"
                style={{ width: `${exportProgress * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Transcript panel */}
      <div className="surface-card flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Transcript
            </p>
            <p className="text-sm text-foreground truncate max-w-[40ch]">{fileName}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Trash2 className="h-3.5 w-3.5" />
            {deletedCount} word{deletedCount === 1 ? "" : "s"} cut
          </div>
        </div>

        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-xs text-muted-foreground">
            Click a word to remove it · Shift-click to select a range · Click again to restore
          </p>
        </div>

        <div
          ref={transcriptRef}
          className="flex-1 overflow-y-auto px-5 py-6 space-y-6 text-[1.05rem] leading-relaxed"
        >
          <AnimatePresence>
            {paragraphs.map((para, i) => (
              <motion.p
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.02 }}
                className="font-serif text-foreground/90"
              >
                {para.map((tok) => (
                  <span
                    key={tok.id}
                    data-tid={tok.id}
                    className={[
                      "word-chip",
                      tok.deleted ? "deleted" : "",
                      activeId === tok.id ? "active" : "",
                    ].join(" ")}
                    onClick={(e) => {
                      if (e.shiftKey) toggleToken(tok.id, true);
                      else {
                        seek(tok.start);
                        toggleToken(tok.id);
                      }
                    }}
                    onDoubleClick={() => seek(tok.start)}
                    title={`${formatTime(tok.start)} → ${formatTime(tok.end)}`}
                  >
                    {tok.text}
                  </span>
                ))}
              </motion.p>
            ))}
          </AnimatePresence>
        </div>

        <div className="border-t border-border px-5 py-3 flex items-center justify-between">
          <button
            onClick={onReset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Start over with a different video
          </button>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            All processing local · whisper.cpp + ffmpeg.wasm
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  destructive,
}: {
  label: string;
  value: string;
  accent?: boolean;
  destructive?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={[
          "mt-1 font-mono text-2xl tabular-nums",
          accent ? "text-accent" : "",
          destructive ? "text-destructive" : "",
          !accent && !destructive ? "text-foreground" : "",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}
