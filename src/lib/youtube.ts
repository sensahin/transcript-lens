// Deterministic: YouTube URL → caption track → timed cues. No model involved.

export interface Cue { start: number; end: number; text: string }
export interface Transcript { id: string; title: string; author: string; duration: number; language: string; auto: boolean; estimated?: boolean; cues: Cue[] }

const CLIENTS = [
  { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 }, ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' },
  { client: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2' }, ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)' },
];

export function videoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = u.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com'].includes(host)) return null;
    const v = u.searchParams.get('v');
    if (v) return /^[\w-]{11}$/.test(v) ? v : null;
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

interface Track { baseUrl: string; languageCode: string; kind?: string; name?: { runs?: { text: string }[]; simpleText?: string } }

export async function fetchTranscript(id: string, lang = 'en'): Promise<Transcript> {
  let lastError = 'YouTube did not return any captions for this video.';
  for (const { client, ua } of CLIENTS) {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': ua },
      body: JSON.stringify({ context: { client: { ...client, hl: 'en' } }, videoId: id }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!res?.ok) continue;
    const data = await res.json();
    const status = data.playabilityStatus?.status;
    if (status && status !== 'OK') { lastError = data.playabilityStatus?.reason ?? `YouTube says: ${status}`; continue; }
    const tracks: Track[] = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) { lastError = 'This video has no captions (not even auto-generated ones).'; continue; }
    // prefer human captions in the wanted language, then auto ones, then anything
    const pick = tracks.find((t) => t.languageCode.startsWith(lang) && t.kind !== 'asr')
      ?? tracks.find((t) => t.languageCode.startsWith(lang))
      ?? tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
    const url = pick.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
    const tt = await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!tt?.ok) { lastError = 'YouTube refused the caption download.'; continue; }
    const body = await tt.text();
    if (!body) { lastError = 'YouTube returned an empty caption file.'; continue; }
    const cues = parseJson3(JSON.parse(body));
    if (!cues.length) { lastError = 'The caption track was empty.'; continue; }
    const d = data.videoDetails ?? {};
    return { id, title: d.title ?? id, author: d.author ?? '', duration: Number(d.lengthSeconds) || cues[cues.length - 1].end, language: pick.languageCode, auto: pick.kind === 'asr', cues };
  }
  throw new Error(lastError);
}

interface Json3 { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] }

function parseJson3(j: Json3): Cue[] {
  const cues: Cue[] = [];
  for (const e of j.events ?? []) {
    if (!e.segs) continue;
    const text = e.segs.map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = (e.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (e.dDurationMs ?? 0) / 1000, text: decode(text) });
  }
  // auto captions overlap (each line stays up until the next is done); clip to the next start
  for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.max(cues[i].start + 0.1, Math.min(cues[i].end, cues[i + 1].start));
  return cues;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
