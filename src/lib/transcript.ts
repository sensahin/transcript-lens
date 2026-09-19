// Pure, deterministic transcript handling shared by the server and the page:
// cues → blocks, and every export format. Nothing here calls a model.
import type { Cue, Transcript } from './youtube';

export type { Cue, Transcript };

/** A block is the unit Jev judges: ~20–40 seconds of consecutive speech, cut at a sentence end or a pause when there is one. */
export interface Block { i: number; start: number; end: number; text: string }

export function toBlocks(cues: Cue[], target = 28, max = 45): Block[] {
  const blocks: Block[] = [];
  let cur: Cue[] = [];
  const flush = () => {
    if (!cur.length) return;
    blocks.push({ i: blocks.length, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim() });
    cur = [];
  };
  for (let k = 0; k < cues.length; k++) {
    const c = cues[k];
    cur.push(c);
    const span = c.end - cur[0].start;
    const next = cues[k + 1];
    const sentenceEnd = /[.!?]["')\]]?$/.test(c.text);
    const pause = next ? next.start - c.end > 1.2 : true;
    if (span >= max || (span >= target && (sentenceEnd || pause)) || (span >= target * 1.3 && next && /^[A-Z]/.test(next.text))) flush();
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------- time formatting

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function stamp(sec: number, sep: ',' | '.'): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(r).padStart(3, '0')}`;
}

// ---------------------------------------------------------------- exports

export type Format = 'txt' | 'md' | 'srt' | 'vtt' | 'json';

/** Cues to export: all of them, or only those whose block is kept (clean / important-only views). */
export function keptCues(cues: Cue[], blocks: Block[], keep?: (b: Block) => boolean): Cue[] {
  if (!keep) return cues;
  const ranges = blocks.filter(keep).map((b) => [b.start, b.end] as const);
  return cues.filter((c) => ranges.some(([s, e]) => c.start >= s - 0.01 && c.start < e + 0.01));
}

export function render(format: Format, t: Pick<Transcript, 'id' | 'title' | 'author'>, cues: Cue[], blocks: Block[], label?: string): string {
  switch (format) {
    case 'txt':
      return paragraphs(cues, blocks).map((p) => p.text).join('\n\n') + '\n';
    case 'md': {
      const head = `# ${t.title}\n\n${t.author ? `*${t.author}* · ` : ''}[youtube.com/watch?v=${t.id}](https://www.youtube.com/watch?v=${t.id})${label ? ` · ${label}` : ''}\n\n`;
      let last = -1;
      return head + paragraphs(cues, blocks).map((p) => {
        const gap = last >= 0 && p.start - last > 5 ? '---\n\n' : '';
        last = p.end;
        return `${gap}**[${clock(p.start)}](https://www.youtube.com/watch?v=${t.id}&t=${Math.floor(p.start)}s)** ${p.text}`;
      }).join('\n\n') + '\n';
    }
    case 'srt':
      return cues.map((c, k) => `${k + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
    case 'vtt':
      return 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n');
    case 'json':
      return JSON.stringify({ video: { id: t.id, title: t.title, author: t.author }, view: label ?? 'full', cues: cues.map((c) => ({ start: +c.start.toFixed(3), end: +c.end.toFixed(3), text: c.text })) }, null, 2);
  }
}

/** Cues regrouped into readable paragraphs along block lines (a removed block leaves a seam). */
function paragraphs(cues: Cue[], blocks: Block[]): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let bi = 0;
  let cur: Cue[] = [];
  let curBlock = -1;
  for (const c of cues) {
    while (bi < blocks.length - 1 && c.start >= blocks[bi].end - 0.01) bi++;
    if (bi !== curBlock && cur.length) { out.push(join(cur)); cur = []; }
    curBlock = bi;
    cur.push(c);
  }
  if (cur.length) out.push(join(cur));
  return out;
}

const join = (cs: Cue[]) => ({ start: cs[0].start, end: cs[cs.length - 1].end, text: cs.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim() });

// ---------------------------------------------------------------- pasted transcripts (the fallback when YouTube refuses)

export function parsePasted(raw: string): Cue[] {
  const text = raw.replace(/\r/g, '').trim();
  const timed = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/;
  if (timed.test(text)) {
    const cues: Cue[] = [];
    for (const chunk of text.split(/\n\s*\n/)) {
      const lines = chunk.split('\n');
      const at = lines.findIndex((l) => timed.test(l));
      if (at < 0) continue;
      const [a, b] = lines[at].split('-->').map((s) => secs(s.trim().split(' ')[0]));
      const body = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (body) cues.push({ start: a, end: b, text: body });
    }
    return cues;
  }
  // "0:00 text" style (YouTube's own "show transcript" panel, copied)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const cues: Cue[] = [];
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].match(/^((?:\d+:)?\d{1,2}:\d{2})\s*(.*)$/);
    if (!m) { if (cues.length) cues[cues.length - 1].text += ' ' + lines[k]; continue; }
    cues.push({ start: secs(m[1]), end: 0, text: m[2] });
  }
  if (cues.length) {
    const out = cues.filter((c) => c.text.trim());
    out.forEach((c, k) => (c.end = out[k + 1]?.start ?? c.start + 4));
    return out;
  }
  // no timestamps at all: fake 3 words a second so the timeline still means something
  const words = text.split(/\s+/);
  const out: Cue[] = [];
  for (let k = 0; k < words.length; k += 12) out.push({ start: k / 3, end: (k + 12) / 3, text: words.slice(k, k + 12).join(' ') });
  return out;
}

function secs(s: string): number {
  const parts = s.replace(',', '.').split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
