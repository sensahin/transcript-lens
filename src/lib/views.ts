// Turning Jev's answers into views. Plain arithmetic over probabilities; runs in the page.
import type { BlockScore, Kind, RELEVANCE } from './analyze';
import type { Block } from './transcript';

export type Signal = 'interest' | 'essential' | 'surprising' | 'funny' | 'controversial' | 'actionable' | 'novel' | 'emotional';

const p = (m: Record<string, number> | undefined, k: string) => m?.[k] ?? 0;

/** How much a block is worth reading: essential counts fully, useful half, and only for substance. */
export function importance(s: BlockScore): number {
  return (p(s.valueP, 'essential') + 0.45 * p(s.valueP, 'useful')) * (0.3 + 0.7 * p(s.kindP, 'content'));
}

export function signal(s: BlockScore | undefined, which: Signal): number {
  if (!s) return 0;
  if (which === 'essential') return importance(s);
  if (which !== 'interest') return s.signals[which];
  // "the good parts": the two strongest of the six signals, plus importance, only for substance
  const top = Object.values(s.signals).sort((a, b) => b - a);
  return Math.min(1, (0.6 * (top[0] + top[1]) / 2 + 0.4 * importance(s)) * (0.25 + 0.75 * p(s.kindP, 'content')) * 1.25);
}

// ---------------------------------------------------------------- clean: drop what is not the talk itself

export type Drop = Exclude<Kind, 'content'> | 'filler';
export const DROPS: { key: Drop; label: string }[] = [
  { key: 'intro', label: 'giriş' },
  { key: 'outro', label: 'kapanış' },
  { key: 'sponsor', label: 'sponsor ve tanıtım' },
  { key: 'housekeeping', label: 'duyurular' },
  { key: 'filler', label: 'dolgu ve tekrar' },
  { key: 'tangent', label: 'konu dışı' },
];

export function dropReason(s: BlockScore | undefined, drops: Set<Drop>): Drop | null {
  if (!s) return null;
  if (s.kind !== 'content' && drops.has(s.kind as Drop)) return s.kind as Drop;
  if (drops.has('filler') && p(s.valueP, 'skippable') >= 0.6) return 'filler';
  return null;
}

// ---------------------------------------------------------------- important-only: the best X% of the runtime, in the original order

export function importantSet(blocks: Block[], scores: (BlockScore | undefined)[], share: number): Set<number> {
  const total = blocks.reduce((a, b) => a + (b.end - b.start), 0);
  const ranked = blocks.filter((b) => scores[b.i]).sort((a, b) => importance(scores[b.i]!) - importance(scores[a.i]!));
  const keep = new Set<number>();
  let t = 0;
  for (const b of ranked) {
    if (t >= total * share) break;
    keep.add(b.i);
    t += b.end - b.start;
  }
  return keep;
}

// ---------------------------------------------------------------- highlights: peaks of a signal, as short runs of blocks

export interface Span { from: number; to: number; start: number; end: number; score: number }

export function peaks(blocks: Block[], values: number[], count = 8): Span[] {
  const sm = values.map((v, i) => (0.25 * (values[i - 1] ?? v) + 0.5 * v + 0.25 * (values[i + 1] ?? v)));
  const sorted = [...sm].filter((v) => v > 0).sort((a, b) => b - a);
  const bar = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.12))] ?? 1;
  const runs: Span[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (sm[i] < bar) continue;
    let j = i;
    while (j + 1 < blocks.length && sm[j + 1] >= bar * 0.9 && j - i < 3) j++;
    const vals = values.slice(i, j + 1);
    runs.push({ from: i, to: j, start: blocks[i].start, end: blocks[j].end, score: Math.max(...vals) });
    i = j;
  }
  return runs.sort((a, b) => b.score - a.score).slice(0, count).sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- lens: relevance → time ranges

export type Relevance = keyof typeof RELEVANCE;

/** Directly relevant blocks, joined across short related or unscored gaps, padded by related neighbours. */
export function lensRanges(blocks: Block[], rel: (Relevance | undefined)[]): Span[] {
  const hit = (i: number) => rel[i] === 'direct';
  const soft = (i: number) => rel[i] === 'related';
  const out: Span[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!hit(i)) continue;
    let from = i, to = i;
    for (;;) {
      if (to + 1 < blocks.length && hit(to + 1)) { to++; continue; }
      if (to + 2 < blocks.length && soft(to + 1) && hit(to + 2)) { to += 2; continue; }
      break;
    }
    if (from > 0 && soft(from - 1)) from--;
    if (to + 1 < blocks.length && soft(to + 1)) to++;
    const directCount = blocks.slice(from, to + 1).filter((b) => hit(b.i)).length;
    out.push({ from, to, start: blocks[from].start, end: blocks[to].end, score: directCount });
    i = to;
  }
  return out;
}

export function span(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return `${Math.round(sec)} sn`;
  return m >= 60 ? `${Math.floor(m / 60)} sa ${String(m % 60).padStart(2, '0')} dk` : `${m} dk`;
}
