import { analyze, type AnalyzeEvent } from '@/lib/analyze';
import { jevConfigured } from '@/lib/jev';
import { allowed, MAX_BLOCKS, ndjson, readBlocks } from '@/lib/stream';

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!jevConfigured()) return Response.json({ error: 'Jev yapılandırılmamış. Analiz için sunucuda AI Gateway veya TypeSafe anahtarını tanımlayın.' }, { status: 503 });
  if (!allowed(request, Number(process.env.ANALYSES_PER_HOUR ?? 20))) return Response.json({ error: 'Saatlik analiz sınırına ulaşıldı. Daha sonra tekrar deneyin.' }, { status: 429 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: 'Geçerli bir JSON isteği gönderin.' }, { status: 400 });
  const blocks = readBlocks(body.blocks);
  if (!blocks) return Response.json({ error: `1 ile ${MAX_BLOCKS} arasında geçerli transkript parçası gönderin.` }, { status: 400 });
  const duration = Number(body.duration) || blocks[blocks.length - 1].end;
  return ndjson<AnalyzeEvent>((signal, emit) => analyze(String(body.title ?? '').slice(0, 300), blocks, duration, signal, emit));
}
