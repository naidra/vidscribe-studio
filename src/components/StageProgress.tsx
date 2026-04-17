import { motion } from "framer-motion";

type Props = {
  label: string;
  detail?: string;
  progress?: number; // 0..1, optional
};

export function StageProgress({ label, detail, progress }: Props) {
  const pct = progress != null ? Math.round(progress * 100) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-card p-6 md:p-8"
    >
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          {detail && (
            <p className="mt-1 text-sm text-foreground/80 truncate max-w-[60ch]">{detail}</p>
          )}
        </div>
        {pct != null && (
          <span className="font-mono text-2xl text-foreground tabular-nums">{pct}%</span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {progress != null ? (
          <motion.div
            className="h-full progress-bar rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        ) : (
          <div
            className="h-full progress-bar rounded-full"
            style={{
              width: "30%",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.6s linear infinite",
            }}
          />
        )}
      </div>
    </motion.div>
  );
}
