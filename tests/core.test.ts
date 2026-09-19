import test from 'node:test';
import assert from 'node:assert/strict';
import { videoId } from '../src/lib/youtube';
import { parsePasted, toBlocks, render } from '../src/lib/transcript';
import { readBlocks } from '../src/lib/stream';
import { jevProvider } from '../src/lib/jev';
import { analyze, lens, type AnalyzeEvent, type LensEvent } from '../src/lib/analyze';

const sample = '1\n00:00:00,000 --> 00:00:30,000\nThis original recording explains how small teams can preserve context while editing an interview.\n\n2\n00:00:30,000 --> 00:01:00,000\nPreparing useful questions helps a guest explain their ideas clearly during a remote recording.';

test('YouTube bağlantıları ve kimlikleri', () => {
  assert.equal(videoId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  assert.equal(videoId('https://youtu.be/abcdefghijk?t=12'), 'abcdefghijk');
  assert.equal(videoId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  for (const value of ['https://example.com/?v=abcdefghijk', 'https://notyoutu.be/abcdefghijk', 'https://youtube.com/watch?v=short', 'file://youtube.com/watch?v=abcdefghijk']) assert.equal(videoId(value), null);
});

test('SRT ve VTT metni ile kaynak zamanları korunur', () => {
  const cues = parsePasted(sample), blocks = toBlocks(cues);
  assert.equal(cues.length, 2); assert.equal(cues[1].start, 30);
  for (const format of ['srt', 'vtt'] as const) assert.deepEqual(parsePasted(render(format, { id: '', title: 'Örnek', author: '' }, cues, blocks)), cues);
  assert.match(render('txt', { id: '', title: 'Örnek', author: '' }, cues, blocks), /preserve context/);
});

test('Geçersiz zamanlar ve büyük parça girdileri reddedilir', () => {
  const valid = { start: 0, end: 1, text: 'Örnek' };
  assert.equal(readBlocks([valid])?.length, 1);
  for (const blocks of [[], [{ ...valid, start: NaN }], [{ ...valid, end: Infinity }], [{ ...valid, end: 0 }], [{ ...valid, start: -1 }], [{ ...valid, text: 'a'.repeat(2501) }], [{ start: 3, end: 4, text: 'x' }, valid]]) assert.equal(readBlocks(blocks), null);
});

test('Düz metin için özgün yaklaşık zamanlama davranışı', () => {
  const cues = parsePasted('Bu örnek düz metnin gerçek zaman damgası yoktur.');
  assert.equal(cues[0].start, 0); assert.ok(cues[0].end > 0);
});

test('Sağlayıcı yoksa analiz yapılandırılmış sayılmaz', () => {
  const names = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'TYPESAFE_API_KEY', 'JEV_PROVIDER'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try { for (const name of names) delete process.env[name]; assert.equal(jevProvider(), null); }
  finally { for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; } }
});

test('Analiz ve anlamsal arama akışı: ağ ve ücretli çağrı olmadan', async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.JEV_PROVIDER, originalKey = process.env.TYPESAFE_API_KEY;
  process.env.JEV_PROVIDER = 'typesafe'; process.env.TYPESAFE_API_KEY = 'test-placeholder';
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests++;
    const { questions } = JSON.parse(String(init?.body));
    const answers = Object.fromEntries(Object.entries(questions).map(([key, raw]) => {
      const q = raw as { type: string; criteria?: Record<string, string> };
      if (q.type === 'choice') {
        const choice = Object.keys(q.criteria!)[0];
        return [key, { type: 'choice', choice, probabilities: { [choice]: 0.9 } }];
      }
      return [key, { type: 'noul', noul: 0.8 }];
    }));
    return Response.json({ answers, model: 'test-double' });
  };
  try {
    const blocks = toBlocks(parsePasted(sample));
    const events: AnalyzeEvent[] = [];
    await analyze('Original sample', blocks, 60, new AbortController().signal, event => events.push(event));
    assert.equal(events.filter(event => event.type === 'block').length, blocks.length);
    assert.ok(events.some(event => event.type === 'chapters'));
    const done = events.at(-1); assert.equal(done?.type, 'done');
    if (done?.type === 'done') assert.equal(done.failures, 0);
    const search: LensEvent[] = [];
    await lens('recording', blocks, new AbortController().signal, event => search.push(event));
    assert.equal(search.filter(event => event.type === 'hit').length, blocks.length);
    assert.ok(requests > 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProvider === undefined) delete process.env.JEV_PROVIDER; else process.env.JEV_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = originalKey;
  }
});
