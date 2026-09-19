// TypeSafe Jev (System One) client. One call = one state + many typed questions.
export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface Answer {
  type: Question['type'];
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface JevResult { answers: Record<string, Answer>; ms: number; model: string }

const API = 'https://api.typesafe.ai/v1/systemone';
const GATEWAY_MODEL = 'typesafe-ai/jev';

/** Vercel AI Gateway (OIDC on Vercel, or AI_GATEWAY_API_KEY) unless JEV_PROVIDER=typesafe forces the direct API. */
export function jevProvider(): 'gateway' | 'typesafe' | null {
  const gateway = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
  const direct = Boolean(process.env.TYPESAFE_API_KEY);
  if (process.env.JEV_PROVIDER === 'typesafe') return direct ? 'typesafe' : null;
  if (process.env.JEV_PROVIDER === 'gateway') return gateway ? 'gateway' : null;
  return gateway ? 'gateway' : direct ? 'typesafe' : null;
}

export const jevConfigured = () => jevProvider() !== null;

export async function askJev(state: string, questions: Record<string, Question>): Promise<JevResult> {
  const provider = jevProvider();
  if (provider === 'gateway') {
    try {
      // Jev answers in ~1.5s; a call that has not answered in 7s is stuck, so ask again rather than wait
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { return await askGateway(state, questions); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 250 * 2 ** attempt)); }
      }
      throw last;
    } catch (e) {
      if (!process.env.TYPESAFE_API_KEY) throw e;
      console.warn('AI Gateway call failed, falling back to the TypeSafe API', e instanceof Error ? e.message : e);
      return askDirect(state, questions);
    }
  }
  if (provider === 'typesafe') return askDirect(state, questions);
  throw new Error('Jev is not configured: set up Vercel AI Gateway or TYPESAFE_API_KEY');
}

async function askGateway(state: string, questions: Record<string, Question>): Promise<JevResult> {
  const { experimental_evaluate: evaluate } = await import('ai');
  const started = Date.now();
  // the AI SDK calls yes/no questions "boolean"; TypeSafe calls them "noul"
  const mapped = Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, q.type === 'noul' ? { type: 'boolean' as const, instructions: q.instructions } : q]));
  const result = await evaluate({ model: GATEWAY_MODEL, state, questions: mapped, maxRetries: 0, abortSignal: AbortSignal.timeout(7000) });
  const answers: Record<string, Answer> = {};
  for (const [k, a] of Object.entries(result.answers as Record<string, { type: string; choice?: string; score?: number; probability?: number; probabilities?: Record<string, number> }>)) {
    if (a.type === 'boolean') answers[k] = { type: 'noul', noul: a.probability };
    else if (a.type === 'choice') answers[k] = { type: 'choice', choice: a.choice, probabilities: a.probabilities };
    else answers[k] = { type: 'score', score: a.score, probabilities: a.probabilities };
  }
  return { answers, ms: Date.now() - started, model: result.response?.modelId ?? GATEWAY_MODEL };
}

async function askDirect(state: string, questions: Record<string, Question>): Promise<JevResult> {
  const key = process.env.TYPESAFE_API_KEY!;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state, questions }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { answers: data.answers ?? {}, ms: Date.now() - started, model: data.model ?? 'jev' };
      last = new Error(`Jev ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  throw last;
}

/** Runs async tasks with a concurrency cap. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}
