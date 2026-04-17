import type { Segment } from "./whisper";

export type Token = {
  id: number;
  segmentId: number;
  text: string;       // includes trailing whitespace if present
  start: number;
  end: number;
  deleted: boolean;
};

/**
 * Split phrase-level segments into pseudo word tokens by distributing the
 * segment time range proportionally across whitespace-separated tokens.
 * This is the best we can do without recompiling whisper.cpp with custom
 * bindings, but it produces a good interactive editor experience.
 */
export function segmentsToTokens(segments: Segment[]): Token[] {
  const tokens: Token[] = [];
  let id = 0;
  for (const seg of segments) {
    const words = seg.text.split(/(\s+)/).filter((w) => w.length > 0);
    const wordList = words.filter((w) => !/^\s+$/.test(w));
    if (wordList.length === 0) continue;

    const totalChars = wordList.reduce((acc, w) => acc + w.length, 0);
    const dur = Math.max(0.001, seg.end - seg.start);
    let cursor = seg.start;

    // Walk through words+spaces, but only emit chips for actual words.
    let wordIdx = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^\s+$/.test(w)) continue;
      const share = w.length / totalChars;
      const start = cursor;
      const end = wordIdx === wordList.length - 1 ? seg.end : start + dur * share;
      // Append trailing space if next part is whitespace
      const trailing = words[i + 1] && /^\s+$/.test(words[i + 1]) ? " " : "";
      tokens.push({
        id: id++,
        segmentId: seg.id,
        text: w + trailing,
        start,
        end,
        deleted: false,
      });
      cursor = end;
      wordIdx++;
    }
  }
  return tokens;
}

export type KeepRange = { start: number; end: number };

/**
 * Compute the contiguous keep ranges from the non-deleted tokens.
 * Adjacent kept tokens are merged into a single range.
 * Pads the range slightly to avoid clipping.
 */
export function tokensToKeepRanges(tokens: Token[], duration: number, pad = 0.04): KeepRange[] {
  const ranges: KeepRange[] = [];
  let cur: KeepRange | null = null;
  for (const t of tokens) {
    if (t.deleted) {
      if (cur) {
        ranges.push(cur);
        cur = null;
      }
      continue;
    }
    const s = Math.max(0, t.start - pad);
    const e = Math.min(duration, t.end + pad);
    if (!cur) cur = { start: s, end: e };
    else if (s <= cur.end + 0.05) cur.end = Math.max(cur.end, e);
    else {
      ranges.push(cur);
      cur = { start: s, end: e };
    }
  }
  if (cur) ranges.push(cur);
  return ranges;
}

export function totalKeepDuration(ranges: KeepRange[]): number {
  return ranges.reduce((acc, r) => acc + (r.end - r.start), 0);
}

export function formatTime(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
