import { fetchTranscript, videoId } from '@/lib/youtube';
import { parsePasted, toBlocks } from '@/lib/transcript';

export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: 'Geçerli bir JSON isteği gönderin.' }, { status: 400 });
  if (typeof body.pasted === 'string' && body.pasted.trim()) {
    if (body.pasted.length > 2_000_000) return Response.json({ error: 'Transkript en fazla 2 milyon karakter olabilir.' }, { status: 413 });
    const cues = parsePasted(body.pasted);
    if (!cues.length || cues.some((c, k) => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || (k > 0 && c.start < cues[k - 1].start))) return Response.json({ error: 'Transkript metnini ve zaman damgalarını kontrol edin.' }, { status: 400 });
    const id = videoId(String(body.url ?? '')) ?? '';
    const transcript = { id, title: String(body.title || 'Yapıştırılan transkript'), author: '', duration: cues[cues.length - 1].end, language: '', auto: false, estimated: !/(?:^|\n)\s*(?:\d+:)?\d{1,2}:\d{2}/.test(body.pasted), cues };
    return Response.json({ transcript, blocks: toBlocks(cues), source: 'pasted' });
  }
  const id = videoId(String(body.url ?? ''));
  if (!id) return Response.json({ error: 'Geçerli bir YouTube bağlantısı veya video kimliği girin.' }, { status: 400 });
  try {
    const transcript = await fetchTranscript(id);
    return Response.json({ transcript, blocks: toBlocks(transcript.cues), source: 'live' });
  } catch {
    return Response.json({
      error: 'YouTube altyazısı alınamadı. Video altyazısız olabilir veya YouTube bu sunucudan erişimi engelliyor olabilir. Kullanma izniniz olan transkripti elle yapıştırabilirsiniz.',
      blocked: true,
      id,
    }, { status: 502 });
  }
}
