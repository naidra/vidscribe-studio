/**
 * Improved word-level timestamping using phoneme-based duration estimation.
 * This provides better accuracy than simple character-based distribution.
 */
function estimateWordDuration(word: string, speakingRate: number = 150): number {
  // Estimate speaking time based on phonemes rather than characters
  // Average speaking rate is ~150 words per minute = 2.5 words per second
  // But we adjust based on word complexity

  const syllables = countSyllables(word);
  const baseDuration = syllables * 0.2; // ~200ms per syllable at normal pace

  // Adjust for word length and complexity
  const lengthFactor = Math.max(0.5, Math.min(2.0, word.length / 5));
  const complexityFactor = word.match(/[bcdfghjklmnpqrstvwxyz]{2,}/i) ? 1.2 : 1.0;

  return baseDuration * lengthFactor * complexityFactor;
}

function countSyllables(word: string): number {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;

  // Count vowel groups
  const vowels = 'aeiouy';
  let syllableCount = 0;
  let previousWasVowel = false;

  for (let i = 0; i < word.length; i++) {
    const isVowel = vowels.includes(word[i]);
    if (isVowel && !previousWasVowel) {
      syllableCount++;
    }
    previousWasVowel = isVowel;
  }

  // Adjust for silent 'e'
  if (word.endsWith('e')) {
    syllableCount = Math.max(1, syllableCount - 1);
  }

  // Ensure at least 1 syllable
  return Math.max(1, syllableCount);
}

export type Token = {
  id: number;
  segmentId: number;
  text: string;       // includes trailing whitespace if present
  start: number;
  end: number;
  deleted: boolean;
};

/**
 * Split phrase-level segments into word tokens with improved timestamp accuracy
 * using phoneme-based duration estimation instead of simple character distribution.
 */
export function segmentsToTokens(segments: Segment[]): Token[] {
  const tokens: Token[] = [];
  let id = 0;

  for (const seg of segments) {
    const words = seg.text.split(/(\s+)/).filter((w) => w.length > 0);
    const wordList = words.filter((w) => !/^\s+$/.test(w));
    if (wordList.length === 0) continue;

    // Calculate total estimated duration for all words in this segment
    const totalEstimatedDuration = wordList.reduce((sum, word) =>
      sum + estimateWordDuration(word.trim()), 0
    );

    const segmentDuration = Math.max(0.001, seg.end - seg.start);
    const scaleFactor = segmentDuration / totalEstimatedDuration;

    let cursor = seg.start;

    // Distribute time based on phoneme-based estimates
    let wordIdx = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^\s+$/.test(w)) continue;

      const estimatedDuration = estimateWordDuration(w.trim()) * scaleFactor;
      const start = cursor;
      const end = wordIdx === wordList.length - 1 ? seg.end : start + estimatedDuration;

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
