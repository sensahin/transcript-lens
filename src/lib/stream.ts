import type { Block } from './transcript';

/** NDJSON response driven by `run`; the stream's own cancel is the reliable sign the visitor left. */
export function ndjson<E>(run: (signal: AbortSignal, emit: (e: E) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const left = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: E) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + '\n')); } catch { left.abort(); }
      };
      try {
        await run(left.signal, emit);
      } catch (e) {
        emit({ type: 'error', message: e instanceof Error ? e.message : String(e) } as E);
      }
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      left.abort();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

export const MAX_BLOCKS = 700; // ~5 hours of speech

/** The page sends back the blocks the transcript route gave it; accept only that shape, and not too much of it. */
export function readBlocks(raw: unknown): Block[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_BLOCKS) return null;
  const out: Block[] = [];
  for (const [k, b] of raw.entries()) {
    if (!b || typeof b.text !== 'string' || typeof b.start !== 'number' || typeof b.end !== 'number' || !Number.isFinite(b.start) || !Number.isFinite(b.end) || b.start < 0 || b.end <= b.start || (k > 0 && b.start < out[k - 1].start) || b.text.length > 2500 || !b.text.trim()) return null;
    out.push({ i: k, start: b.start, end: b.end, text: b.text.slice(0, 2500) });
  }
  return out;
}

const WINDOW_MS = 60 * 60 * 1000;
const recent = new Map<string, number[]>();

/** Best effort, per instance: stops one busy tab, not a determined visitor. */
export function allowed(request: Request, perHour: number): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return true;
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= perHour) return false;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return true;
}
