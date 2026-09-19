// Everything Jev does. It never writes a word of text: it only answers typed questions
// about the transcript's own blocks, and code turns the answers into views.
import { askJev, pool, type Answer, type Question } from './jev';
import type { Block } from './transcript';

export const CONCURRENCY = 64;

// ---------------------------------------------------------------- pass 1: every block, eight questions in one call

export const KINDS = {
  content: 'substantive discussion of the video\'s subject',
  intro: 'opening: greetings, cold-open teaser, introducing the show, the host or the guest',
  outro: 'closing: thanks for watching, goodbyes, subscribe or like requests, next episode',
  sponsor: 'a sponsor read, an ad, or self-promotion (merch, Patreon, a course, a newsletter)',
  housekeeping: 'logistics or meta talk: audio checks, scheduling, "as I said earlier", channel news',
  tangent: 'small talk or a tangent unrelated to the video\'s subject',
} as const;
export type Kind = keyof typeof KINDS;

const BLOCK_QUESTIONS = {
  kind: { type: 'choice', instructions: 'What is this block of the transcript doing?', criteria: KINDS },
  value: {
    type: 'choice',
    instructions: 'For someone reading this transcript for its substance, how much does this block matter?',
    criteria: {
      essential: 'a core point, insight, argument or piece of information; skipping it loses something important',
      useful: 'relevant supporting detail, example or context',
      skippable: 'filler, repetition, pleasantries, or nothing new',
    },
  },
  surprising: { type: 'noul', instructions: 'Does this block say something surprising or counter-intuitive?' },
  funny: { type: 'noul', instructions: 'Is this block funny: a joke, a witty line, a laugh?' },
  controversial: { type: 'noul', instructions: 'Is this block controversial: a provocative, divisive or strongly contested position?' },
  actionable: { type: 'noul', instructions: 'Does this block give practical advice the listener could act on?' },
  novel: { type: 'noul', instructions: 'Does this block contain an original idea or a perspective most people would not have heard before?' },
  emotional: { type: 'noul', instructions: 'Is this block emotionally charged: personal, moving, heated or vulnerable?' },
} satisfies Record<string, Question>;

export interface BlockScore {
  i: number;
  kind: Kind;
  kindP: Record<string, number>;
  value: 'essential' | 'useful' | 'skippable';
  valueP: Record<string, number>;
  signals: Record<'surprising' | 'funny' | 'controversial' | 'actionable' | 'novel' | 'emotional', number>;
}

const tail = (s: string, words: number) => s.split(' ').slice(-words).join(' ');
const head = (s: string, words: number) => s.split(' ').slice(0, words).join(' ');

async function scoreBlock(b: Block, prev: Block | undefined, title: string): Promise<BlockScore> {
  const state = `Video: "${title}"\n\n${prev ? `(Just before, for context: …${tail(prev.text, 30)})\n\n` : '(This is the very start of the video.)\n\n'}The block to judge:\n${b.text}`;
  const { answers } = await askJev(state, BLOCK_QUESTIONS);
  const a = answers as Record<keyof typeof BLOCK_QUESTIONS, Answer>;
  const n = (k: keyof typeof BLOCK_QUESTIONS) => a[k]?.noul ?? 0;
  return {
    i: b.i,
    kind: (a.kind?.choice ?? 'content') as Kind,
    kindP: a.kind?.probabilities ?? {},
    value: (a.value?.choice ?? 'useful') as BlockScore['value'],
    valueP: a.value?.probabilities ?? {},
    signals: { surprising: n('surprising'), funny: n('funny'), controversial: n('controversial'), actionable: n('actionable'), novel: n('novel'), emotional: n('emotional') },
  };
}

// ---------------------------------------------------------------- pass 2: adjacent windows, has a new section started?

const SEAM = {
  same: { type: 'noul', instructions: 'Is passage B still on the same topic as passage A? Answer no only if the conversation has clearly moved to a different subject.' },
  shift: { type: 'noul', instructions: 'Does passage B start a new section, story or subject, rather than continuing what A was about?' },
} satisfies Record<string, Question>;

/** p(a new section starts at block i), from the ~60 seconds before it against the ~60 seconds from it. */
async function seam(blocks: Block[], i: number): Promise<number> {
  const a = tail(blocks.slice(Math.max(0, i - 2), i).map((b) => b.text).join(' '), 110);
  const b = head(blocks.slice(i, i + 2).map((b) => b.text).join(' '), 110);
  const { answers } = await askJev(`Passage A:\n…${a}\n\nPassage B (what is said right after):\n${b}…`, SEAM);
  // "new section?" separates far better; "same topic?" steadies it
  return 0.65 * (answers.shift?.noul ?? 0) + 0.35 * (1 - (answers.same?.noul ?? 1));
}

// ---------------------------------------------------------------- pass 3: statements inside substantive blocks

export const STATEMENTS = {
  claim: 'a factual claim: asserts something is true about the world that could in principle be checked',
  opinion: 'an opinion, judgement or value statement',
  prediction: 'a prediction about the future',
  anecdote: 'a personal story or anecdote',
  question: 'a question being asked',
  other: 'none of these: filler, agreement, a fragment, or a transition',
} as const;
export type StatementKind = keyof typeof STATEMENTS;

const STATEMENT_QUESTIONS = {
  kind: { type: 'choice', instructions: 'What kind of statement is the highlighted sentence?', criteria: STATEMENTS },
} satisfies Record<string, Question>;

export interface Statement { block: number; start: number; text: string; kind: StatementKind; p: number }

/** Sentences if the captions are punctuated, ~25-word pieces if not; each gets a time by its position in the block. */
export function sentences(b: Block): { start: number; text: string }[] {
  const words = b.text.split(' ');
  const punctuated = /[.!?]/.test(b.text);
  const pieces: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    const end = punctuated ? /[.!?]["')\]]?$/.test(w) && cur.length >= 8 : cur.length >= 25;
    if (end || cur.length >= 45) { pieces.push(cur); cur = []; }
  }
  if (cur.length) cur.length < 6 && pieces.length ? pieces[pieces.length - 1].push(...cur) : pieces.push(cur);
  let at = 0;
  return pieces.map((p) => {
    const start = b.start + (b.end - b.start) * (at / words.length);
    at += p.length;
    return { start, text: p.join(' ').replace(/^- /, '') };
  });
}

async function classifySentence(b: Block, s: { start: number; text: string }): Promise<Statement> {
  const state = `Surrounding passage:\n${b.text}\n\nThe highlighted sentence:\n"${s.text}"`;
  const { answers } = await askJev(state, STATEMENT_QUESTIONS);
  const kind = (answers.kind?.choice ?? 'other') as StatementKind;
  return { block: b.i, start: s.start, text: s.text, kind, p: answers.kind?.probabilities?.[kind] ?? 0 };
}

// ---------------------------------------------------------------- chapters: boundaries from seams, names chosen by Jev from the chapter's own words

export interface Chapter { start: number; end: number; from: number; to: number; label: string; candidates: string[] }

export function cutChapters(blocks: Block[], boundary: (number | undefined)[], duration: number): { from: number; to: number }[] {
  const minLen = Math.max(90, Math.min(600, duration / 18)); // seconds: ~18 chapters at most
  const seams = boundary.map((p, i) => ({ i, p: p ?? 0 })).filter((s) => s.i > 0 && s.p >= 0.45).sort((a, b) => b.p - a.p);
  const cuts: number[] = [];
  const take = (list: { i: number }[], spacing: number) => {
    for (const s of list) {
      const t = blocks[s.i].start;
      if (t < spacing * 0.6 || duration - t < spacing * 0.6) continue;
      if (cuts.every((c) => Math.abs(blocks[c].start - t) >= spacing)) cuts.push(s.i);
    }
  };
  take(seams, minLen);
  // a long stretch with no confident seam still deserves a break: take its likeliest weaker one
  const weaker = boundary.map((p, i) => ({ i, p: p ?? 0 })).filter((s) => s.i > 0 && s.p >= 0.25 && s.p < 0.45).sort((a, b) => b.p - a.p);
  take(weaker, Math.max(minLen, 900));
  cuts.sort((a, b) => a - b);
  const edges = [0, ...cuts, blocks.length];
  return edges.slice(0, -1).map((from, k) => ({ from, to: edges[k + 1] - 1 }));
}

const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each even few for from further get got had has have having he her here hers him his how i if in into is it its itself just know kind like lot me more most much my no nor not now of off on once only or other our out over own really right said same say says she should so some something sort such than that the their them then there these they thing things think this those through to too under until up us very was we well were what when where which while who whom why will with would yeah you your yes okay oh um uh gonna wanna going go actually mean maybe people one two also way want let see look make made time lot little bit stuff guess sure whatever everything anything anyone someone kinda gotta talk talking saying tell told feel felt pretty quite great good doing done lots already still back first last next year years able another every many point part whole true real else never always need take come came give work works').split(' '));

/** Distinctive phrases per chapter (tf-idf over unigrams and bigrams). Deterministic; Jev only picks among them. */
export function candidatePhrases(chapterTexts: string[], k = 6): string[][] {
  const grams = chapterTexts.map((t) => {
    const words = t.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !w.includes("'") && !/^\d+$/.test(w) && !w.startsWith('-'));
    const counts = new Map<string, number>();
    for (let j = 0; j < words.length; j++) {
      const w = words[j];
      if (!STOP.has(w) && w.length > 3) counts.set(w, (counts.get(w) ?? 0) + 1);
      const w2 = words[j + 1];
      if (w2 && !STOP.has(w) && !STOP.has(w2)) counts.set(`${w} ${w2}`, (counts.get(`${w} ${w2}`) ?? 0) + 1.6);
    }
    return counts;
  });
  const df = new Map<string, number>();
  for (const g of grams) for (const w of g.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const N = grams.length;
  return grams.map((g) => {
    const ranked = [...g.entries()].filter(([, c]) => c >= 2).map(([w, c]) => [w, c * Math.log(1 + N / (df.get(w) ?? 1))] as const).sort((a, b) => b[1] - a[1]);
    const out: string[] = [];
    for (const [w] of ranked) {
      if (out.some((o) => o.includes(w) || w.includes(o))) continue;
      out.push(w);
      if (out.length >= k) break;
    }
    return out.length ? out : ['(untitled)'];
  });
}

async function nameChapter(text: string, candidates: string[]): Promise<string> {
  if (candidates.length < 2) return candidates[0];
  const criteria = Object.fromEntries(candidates.map((c, k) => [`c${k}`, c]));
  const words = text.split(' ');
  const sample = words.length > 700 ? [...words.slice(0, 350), '…', ...words.slice(-350)].join(' ') : text;
  const { answers } = await askJev(`A section of a video transcript:\n${sample}`, {
    label: { type: 'choice', instructions: 'Which phrase best names what this whole section is about?', criteria },
  });
  return criteria[answers.label?.choice ?? 'c0'] ?? candidates[0];
}

// ---------------------------------------------------------------- the whole run, streamed

export type AnalyzeEvent =
  | { type: 'plan'; blocks: number; seams: number }
  | { type: 'block'; score: BlockScore }
  | { type: 'seam'; i: number; boundary: number }
  | { type: 'chapters'; chapters: Chapter[] }
  | { type: 'statements-plan'; total: number }
  | { type: 'statement'; statement: Statement }
  | { type: 'done'; calls: number; failures: number; ms: number }
  | { type: 'error'; message: string };

export async function analyze(title: string, blocks: Block[], duration: number, signal: AbortSignal, emit: (e: AnalyzeEvent) => void) {
  const started = Date.now();
  let calls = 0, failures = 0;
  const guarded = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (signal.aborted) return null;
    calls++;
    try { return await fn(); } catch { failures++; return null; }
  };

  emit({ type: 'plan', blocks: blocks.length, seams: blocks.length - 1 });
  const scores: (BlockScore | null)[] = new Array(blocks.length).fill(null);
  const boundary: (number | undefined)[] = new Array(blocks.length).fill(undefined);

  // blocks and seams share one queue so the heatmap and the timeline fill in together
  const jobs = blocks.flatMap((b) => (b.i > 0 ? [{ t: 'block' as const, i: b.i }, { t: 'seam' as const, i: b.i }] : [{ t: 'block' as const, i: b.i }]));
  await pool(jobs, CONCURRENCY, async (j) => {
    if (j.t === 'block') {
      const s = await guarded(() => scoreBlock(blocks[j.i], blocks[j.i - 1], title));
      if (s) { scores[j.i] = s; emit({ type: 'block', score: s }); }
    } else {
      const p = await guarded(() => seam(blocks, j.i));
      if (p !== null) { boundary[j.i] = p; emit({ type: 'seam', i: j.i, boundary: p }); }
    }
  });
  if (signal.aborted) return;

  // chapters: cut, then let Jev pick each one's name from its own distinctive phrases
  const spans = cutChapters(blocks, boundary, duration);
  const texts = spans.map((s) => blocks.slice(s.from, s.to + 1).map((b) => b.text).join(' '));
  const cands = candidatePhrases(texts);
  const labels = await pool(spans.map((_, k) => k), CONCURRENCY, (k) => guarded(() => nameChapter(texts[k], cands[k])));
  emit({
    type: 'chapters',
    chapters: spans.map((s, k) => ({ ...s, start: blocks[s.from].start, end: blocks[s.to].end, label: labels[k] ?? cands[k][0], candidates: cands[k] })),
  });

  // statements: only inside blocks that are substantive — the cheap pass decides where the finer pass looks
  const worth = blocks.filter((b) => scores[b.i]?.kind === 'content' && scores[b.i]?.value !== 'skippable');
  const units = worth.flatMap((b) => sentences(b).filter((s) => s.text.split(' ').length >= 6).map((s) => ({ b, s })));
  emit({ type: 'statements-plan', total: units.length });
  await pool(units, CONCURRENCY, async ({ b, s }) => {
    const st = await guarded(() => classifySentence(b, s));
    if (st) emit({ type: 'statement', statement: st });
  });

  emit({ type: 'done', calls, failures, ms: Date.now() - started });
}

// ---------------------------------------------------------------- custom lens

export const RELEVANCE = {
  direct: 'directly about it: this passage discusses the subject itself',
  related: 'related: touches on it, mentions it in passing, or gives needed context',
  irrelevant: 'not about it',
} as const;

export type LensEvent =
  | { type: 'plan'; total: number }
  | { type: 'hit'; i: number; relevance: keyof typeof RELEVANCE; p: Record<string, number> }
  | { type: 'done'; calls: number; failures: number; ms: number };

export async function lens(query: string, blocks: Block[], signal: AbortSignal, emit: (e: LensEvent) => void) {
  const started = Date.now();
  let calls = 0, failures = 0;
  emit({ type: 'plan', total: blocks.length });
  const q = { relevance: { type: 'choice', instructions: `The viewer is looking for: "${query}". How relevant is this passage to what they are looking for?`, criteria: RELEVANCE } } satisfies Record<string, Question>;
  await pool(blocks, CONCURRENCY, async (b) => {
    if (signal.aborted) return;
    calls++;
    try {
      const prev = blocks[b.i - 1];
      const { answers } = await askJev(`${prev ? `(Just before: …${tail(prev.text, 25)})\n\n` : ''}Passage:\n${b.text}`, q);
      emit({ type: 'hit', i: b.i, relevance: (answers.relevance?.choice ?? 'irrelevant') as keyof typeof RELEVANCE, p: answers.relevance?.probabilities ?? {} });
    } catch {
      failures++;
    }
  });
  emit({ type: 'done', calls, failures, ms: Date.now() - started });
}
