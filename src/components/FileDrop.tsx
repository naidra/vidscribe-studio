import { motion } from "framer-motion";
import { UploadCloud, FileVideo } from "lucide-react";
import { useCallback, useRef, useState } from "react";

type Props = {
  onFile: (file: File) => void;
  maxBytes?: number;
};

const SOFT_LIMIT = 500 * 1024 * 1024;

export function FileDrop({ onFile, maxBytes = SOFT_LIMIT }: Props) {
  const [drag, setDrag] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) {
        setWarn("Please choose a video file (MP4, MOV, WebM, MKV).");
        return;
      }
      if (file.size > maxBytes) {
        const mb = Math.round(file.size / 1024 / 1024);
        const ok = window.confirm(
          `This file is ${mb} MB which is above the recommended 500 MB. Browser memory limits may cause export to fail. Continue anyway?`,
        );
        if (!ok) return;
      }
      setWarn(null);
      onFile(file);
    },
    [onFile, maxBytes],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
      className="w-full"
    >
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handle(f);
        }}
        className={[
          "relative block cursor-pointer rounded-2xl border-2 border-dashed p-12 md:p-16 text-center transition-all",
          "bg-card/50 backdrop-blur-sm",
          drag
            ? "border-accent bg-accent/5 scale-[1.01]"
            : "border-border hover:border-accent/50 hover:bg-card/80",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handle(f);
          }}
        />
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-accent/20 blur-2xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-accent text-accent-foreground shadow-glow">
              <UploadCloud className="h-7 w-7" strokeWidth={2} />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="font-serif text-3xl md:text-4xl text-foreground">
              Drop a video to begin
            </h3>
            <p className="text-sm text-muted-foreground">
              MP4 · MOV · WebM · MKV — up to 500 MB recommended
            </p>
          </div>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-muted-foreground">
            <FileVideo className="h-3.5 w-3.5" />
            Or click anywhere in this area
          </div>
        </div>
        {warn && (
          <p className="mt-4 text-sm text-destructive">{warn}</p>
        )}
      </label>
    </motion.div>
  );
}
