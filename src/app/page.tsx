'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyzeEvent, BlockScore, Chapter, LensEvent, Statement, StatementKind } from '@/lib/analyze';
import { clock, keptCues, render, type Block, type Format, type Transcript } from '@/lib/transcript';
import { DROPS, dropReason, importantSet, lensRanges, peaks, signal, span, type Drop, type Relevance, type Signal, type Span } from '@/lib/views';
import { Player, type PlayerHandle } from './Player';
import { Heatmap } from './Heatmap';

type View = 'full' | 'clean' | 'important' | 'chapters' | 'claims' | 'highlights' | 'lens';
const VIEWS: { key: View; label: string }[] = [
  { key: 'full', label: 'Tam metin' },
  { key: 'clean', label: 'Temiz metin' },
  { key: 'important', label: 'Önemli kısımlar' },
  { key: 'chapters', label: 'Bölümler' },
  { key: 'claims', label: 'İddialar' },
  { key: 'highlights', label: 'Öne çıkanlar' },
  { key: 'lens', label: 'Anlamsal arama' },
];
const SIGNALS: { key: Signal; label: string }[] = [
  { key: 'interest', label: 'dikkat çekenler' },
  { key: 'essential', label: 'önemli' },
  { key: 'surprising', label: 'şaşırtıcı' },
  { key: 'novel', label: 'özgün' },
  { key: 'controversial', label: 'tartışmalı' },
  { key: 'funny', label: 'komik' },
  { key: 'actionable', label: 'uygulanabilir' },
  { key: 'emotional', label: 'duygusal' },
];
const STATEMENT_LABELS: Record<StatementKind, string> = { claim: 'iddia', opinion: 'görüş', prediction: 'öngörü', anecdote: 'anı', question: 'soru', other: 'diğer' };
const SAMPLE = `WEBVTT

00:00.000 --> 00:30.000
Bugün küçük bir ekiple düzenli yayın yapmayı konuşuyoruz. İlk adım, her hafta tekrarlanabilen bir kayıt düzeni kurmak. Mikrofonu hazır bırakmak ve üç soru hazırlamak başlangıcı kolaylaştırır.

00:30.000 --> 01:00.000
Kurguda en önemli kural, konuşmacının anlamını korumak. Bir duraklamayı silmek ile bir cümleyi bağlamından koparmak aynı şey değil. Alıntıyı kullanmadan önce çevresindeki cümleleri de okuyun.

01:00.000 --> 01:30.000
Arşiv, yeni bölüm hazırlarken değer kazanır. Eski konuşmalarda aynı konunun nerede geçtiğini bulmak araştırma süresini kısaltır. Kayıt sırasında kısa notlar almak daha sonra doğru bölüme dönmeyi kolaylaştırır.

01:30.000 --> 02:00.000
Gelecek bölümde uzaktan röportajları ele alacağız. Konukların rahat hissetmesi ve ses kontrolünün önceden yapılması iyi bir başlangıç sağlar. Dinlediğiniz için teşekkür ederiz.
`;

async function readStream<E>(res: Response, on: (e: E) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) on(JSON.parse(line));
    }
  }
}

function download(name: string, body: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchMs, setFetchMs] = useState(0);
  const [source, setSource] = useState<'live' | 'pasted' | undefined>();

  const [t, setT] = useState<Transcript | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [scores, setScores] = useState<(BlockScore | undefined)[]>([]);
  const [same, setSame] = useState<(number | undefined)[]>([]);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [stTotal, setStTotal] = useState(0);
  const [done, setDone] = useState<{ calls: number; failures: number; ms: number } | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [view, setView] = useState<View>('full');
  const [sig, setSig] = useState<Signal>('interest');
  const [drops, setDrops] = useState<Set<Drop>>(new Set(['intro', 'outro', 'sponsor', 'housekeeping', 'filler']));
  const [share, setShare] = useState(0.2);
  const [stKind, setStKind] = useState<StatementKind>('claim');
  const [follow, setFollow] = useState(false);

  const [query, setQuery] = useState('');
  const [lensQuery, setLensQuery] = useState('');
  const [rel, setRel] = useState<(Relevance | undefined)[]>([]);
  const [lensDone, setLensDone] = useState<{ calls: number; ms: number } | null>(null);
  const [lensBusy, setLensBusy] = useState(false);

  const [now, setNow] = useState(0);
  const player = useRef<PlayerHandle>(null);
  const runRef = useRef<AbortController | null>(null);
  const lensRef = useRef<AbortController | null>(null);

  const seek = useCallback((sec: number) => {
    player.current?.seek(sec);
    setNow(sec);
  }, []);

  useEffect(() => () => { runRef.current?.abort(); lensRef.current?.abort(); }, []);

  const reset = () => {
    runRef.current?.abort();
    lensRef.current?.abort();
    setScores([]); setSame([]); setChapters(null); setStatements([]); setStTotal(0); setDone(null); setAnalyzeError(null);
    setRel([]); setLensDone(null); setLensQuery(''); setView('full');
  };

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    const target = url;
    if (!target.trim() && !pasted.trim()) return;
    reset();
    setLoading(true); setError(null); setT(null); setBlocks([]);
    const t0 = performance.now();
    try {
    const res = await fetch('/api/transcript', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pasting ? { pasted, url: target } : { url: target }) });
    const data = await res.json().catch(() => ({ error: 'Sunucu yanıtı okunamadı.' }));
    if (!res.ok) { setError(data.error ?? 'Transkript alınamadı.'); if (data.blocked) setPasting(true); return; }
    setFetchMs(performance.now() - t0);
    setSource(data.source);
    setT(data.transcript); setBlocks(data.blocks);
    setScores(new Array(data.blocks.length).fill(undefined));
    setSame(new Array(data.blocks.length).fill(undefined));
    analyze(data.transcript, data.blocks);
    } catch {
      setError('Transkript alınırken bağlantı kesildi. Tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  }

  async function analyze(tr: Transcript, bl: Block[]) {
    const ctl = new AbortController();
    runRef.current = ctl;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: tr.title, duration: tr.duration, blocks: bl }), signal: ctl.signal });
      if (!res.ok) { setAnalyzeError((await res.json().catch(() => ({}))).error ?? `Analiz başarısız (${res.status}).`); return; }
      // batch React updates: events arrive by the hundred
      let pendingScores: BlockScore[] = [], pendingSame: [number, number][] = [], pendingSt: Statement[] = [];
      const flush = () => {
        if (pendingScores.length) { const s = pendingScores; pendingScores = []; setScores((prev) => { const n = [...prev]; for (const x of s) n[x.i] = x; return n; }); }
        if (pendingSame.length) { const s = pendingSame; pendingSame = []; setSame((prev) => { const n = [...prev]; for (const [i, p] of s) n[i] = p; return n; }); }
        if (pendingSt.length) { const s = pendingSt; pendingSt = []; setStatements((prev) => [...prev, ...s]); }
      };
      timer = setInterval(flush, 120);
      await readStream<AnalyzeEvent>(res, (e) => {
        if (e.type === 'block') pendingScores.push(e.score);
        else if (e.type === 'seam') pendingSame.push([e.i, e.boundary]);
        else if (e.type === 'statement') pendingSt.push(e.statement);
        else if (e.type === 'chapters') { flush(); setChapters(e.chapters); }
        else if (e.type === 'statements-plan') setStTotal(e.total);
        else if (e.type === 'done') { flush(); setDone(e); }
        else if (e.type === 'error') setAnalyzeError(e.message);
      });
      flush();
    } catch (err) {
      if (!ctl.signal.aborted) setAnalyzeError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
    }
  }

  async function runLens(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || !blocks.length) return;
    lensRef.current?.abort();
    const ctl = new AbortController();
    lensRef.current = ctl;
    setLensQuery(q); setRel(new Array(blocks.length).fill(undefined)); setLensDone(null); setLensBusy(true); setView('lens');
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const res = await fetch('/api/lens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, blocks }), signal: ctl.signal });
      if (!res.ok) { setAnalyzeError((await res.json().catch(() => ({}))).error ?? 'Anlamsal arama başarısız.'); return; }
      let pending: [number, Relevance][] = [];
      const flush = () => { if (!pending.length) return; const s = pending; pending = []; setRel((prev) => { const n = [...prev]; for (const [i, r] of s) n[i] = r; return n; }); };
      timer = setInterval(flush, 100);
      await readStream<LensEvent>(res, (ev) => {
        if (ev.type === 'hit') pending.push([ev.i, ev.relevance]);
        else if (ev.type === 'done') { flush(); setLensDone(ev); }
      });
      flush();
    } catch {
      if (!ctl.signal.aborted) setAnalyzeError('Arama bağlantısı kesildi. Kısmi sonuçlar gösteriliyor.');
    } finally {
      clearInterval(timer);
      if (lensRef.current === ctl) setLensBusy(false);
    }
  }

  // ---------------------------------------------------------------- derived views

  const scored = scores.filter(Boolean).length;
  const total = useMemo(() => blocks.reduce((a, b) => a + (b.end - b.start), 0), [blocks]);
  const important = useMemo(() => importantSet(blocks, scores, share), [blocks, scores, share]);
  const lensSpans = useMemo(() => lensRanges(blocks, rel), [blocks, rel]);
  const lensSet = useMemo(() => { const s = new Set<number>(); for (const r of lensSpans) for (let i = r.from; i <= r.to; i++) s.add(i); return s; }, [lensSpans]);
  const heat = useMemo(() => {
    if (view === 'lens' && rel.some(Boolean)) return blocks.map((b) => (rel[b.i] === 'direct' ? 1 : rel[b.i] === 'related' ? 0.4 : rel[b.i] ? 0.02 : -1));
    // stretch to this video's own range, so its peaks stand out whatever its baseline
    const own = blocks.map((b) => (scores[b.i] ? signal(scores[b.i], sig) : -1));
    // on long videos one block is a hairline: blend in the neighbours so the peaks read as regions
    const w = blocks.length > 150 ? 0.25 : 0;
    const raw = own.map((v, i) => { if (v < 0 || !w) return v; const a = own[i - 1] ?? -1, b = own[i + 1] ?? -1; return (1 - 2 * w) * v + w * (a < 0 ? v : a) + w * (b < 0 ? v : b); });
    const got = raw.filter((v) => v >= 0).sort((a, b) => a - b);
    if (got.length < 4) return raw;
    const lo = got[0], hi = got[got.length - 1];
    // half rank (spreads the colours evenly), half absolute (keeps a flat video looking flat)
    const rank = (v: number) => { let k = 0; while (k < got.length && got[k] < v) k++; return k / (got.length - 1); };
    return raw.map((v) => (v < 0 ? v : (0.6 * rank(v) + 0.4 * ((v - lo) / Math.max(1e-6, hi - lo))) ** 1.6));
  }, [blocks, scores, sig, view, rel]);
  const highlights = useMemo(() => (scored === blocks.length && blocks.length ? peaks(blocks, blocks.map((b) => signal(scores[b.i], sig))) : []), [blocks, scores, sig, scored]);

  /** Which blocks the current transcript view keeps (null = all). */
  const keep = useMemo<((b: Block) => boolean) | null>(() => {
    if (view === 'clean') return (b) => !dropReason(scores[b.i], drops);
    if (view === 'important') return (b) => important.has(b.i);
    if (view === 'lens' && lensQuery) return (b) => lensSet.has(b.i);
    return null;
  }, [view, scores, drops, important, lensSet, lensQuery]);
  const keptTime = keep ? blocks.filter(keep).reduce((a, b) => a + (b.end - b.start), 0) : total;

  const current = useMemo(() => { let lo = 0; for (let k = 0; k < blocks.length; k++) if (blocks[k].start <= now) lo = k; return lo; }, [blocks, now]);
  useEffect(() => {
    if (!follow) return;
    document.getElementById(`b${current}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current, follow]);

  const exportLabel = view === 'clean' ? 'temiz metin' : view === 'important' ? `en önemli %${Math.round(share * 100)}` : view === 'lens' && lensQuery ? `arama: ${lensQuery}` : 'tam metin';
  function exportAs(f: Format) {
    if (!t) return;
    const cues = keptCues(t.cues, blocks, keep ?? undefined);
    const body = render(f, t, cues, blocks, exportLabel === 'tam metin' ? undefined : exportLabel);
    const slug = (t.title || t.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'transcript';
    const suffix = exportLabel === 'tam metin' ? '' : `.${view}`;
    download(`${slug}${suffix}.${f}`, body, { txt: 'text/plain', md: 'text/markdown', srt: 'application/x-subrip', vtt: 'text/vtt', json: 'application/json' }[f]);
  }

  const counts = useMemo(() => {
    const c: Record<StatementKind, number> = { claim: 0, opinion: 0, prediction: 0, anecdote: 0, question: 0, other: 0 };
    for (const s of statements) if (s.p >= 0.7) c[s.kind]++;
    return c;
  }, [statements]);
  const shownStatements = useMemo(() => statements.filter((s) => s.kind === stKind && s.p >= 0.7).sort((a, b) => a.start - b.start), [statements, stKind]);

  const elapsed = done ? done.ms / 1000 : null;
  const phase = !t || analyzeError ? '' : !chapters ? `Parçalar değerlendiriliyor · ${scored}/${blocks.length}` : !done ? `Cümleler sınıflandırılıyor · ${statements.length}/${stTotal}` : '';

  // ---------------------------------------------------------------- render

  return (
    <main>
      <header className={t ? 'top compact' : 'top'}>
        <div className="brand" onClick={() => { reset(); setT(null); setBlocks([]); setError(null); }}>
          <span className="logo">◐</span> Transcript Lens
        </div>
        {!t && (
          <>
            <h1>Bir YouTube bağlantısı yapıştırın.<br /><span>Transkripti alın, anlamına göre keşfedin.</span></h1>
            <p className="lede">YouTube altyazısını alın veya kendi transkriptinizi yapıştırın. <b>Jev</b> yaklaşık 30 saniyelik parçaları değerlendirir: ne anlatılıyor, hangi kısımlar önemli, konu nerede değişiyor? Görünümler metni yeniden yazmadan özgün sözcükleri seçer.</p>
          </>
        )}
        <form onSubmit={load} className="urlform">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" spellCheck={false} autoFocus />
          <button disabled={loading}>{loading ? 'Alınıyor…' : 'Transkripti al'}</button>
        </form>
        {!t && (
          <div className="examples">
            <span>deneyin</span>
            <button type="button" onClick={() => { setUrl(''); setPasted(SAMPLE); setPasting(true); }}>Türkçe örnek transkript</button>
            <button className="link" onClick={() => setPasting((v) => !v)}>{pasting ? 'metin alanını gizle' : 'veya transkript yapıştır'}</button>
          </div>
        )}
        {pasting && !t && (
          <div className="paste">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'SRT, VTT veya zaman damgalı transkript yapıştırın. Oynatıcı için yukarıya video bağlantısını ekleyebilirsiniz. Zaman damgası olmayan metinde süreler yalnızca tahmindir.'} />
            <button onClick={() => load()} disabled={!pasted.trim() || loading}>Bu transkripti kullan</button>
          </div>
        )}
        {error && <div className="error">{error}{!pasting && <> — <button className="link" onClick={() => setPasting(true)}>transkripti elle yapıştırın</button></>}</div>}
      </header>

      {t && (
        <div className="grid">
          <section className="left">
            {t.id ? <Player ref={player} id={t.id} onTime={setNow} /> : <div className="noplayer">Video yok · yapıştırılan transkript</div>}
            <div className="meta">
              <div className="title">{t.title}</div>
              <div className="sub">{t.author && <>{t.author} · </>}{span(t.duration)} · {t.cues.length.toLocaleString()} altyazı satırı · {t.auto ? 'otomatik' : 'manuel'} altyazı{t.language && ` (${t.language})`} · {source === 'pasted' ? 'elle yapıştırıldı' : `${(fetchMs / 1000).toFixed(1)} sn içinde alındı`}</div>
              {t.estimated && <p className="note">Zaman damgası yok: süreler okuma hızından tahmin edilmiştir. Gerçek video konumları değildir.</p>}
            </div>

            <Heatmap blocks={blocks} values={heat} duration={t.duration} now={now} chapters={chapters} highlights={view === 'highlights' ? highlights : view === 'lens' ? lensSpans : []} onSeek={seek} lens={view === 'lens' && rel.some(Boolean)} />
            {!(view === 'lens' && rel.some(Boolean)) && (
              <div className="chips signals">
                <span>ısı haritası</span>
                {SIGNALS.map((s) => <button key={s.key} className={sig === s.key ? 'on' : ''} onClick={() => setSig(s.key)}>{s.label}</button>)}
              </div>
            )}

            <div className="status">
              {phase && <span className="pulse">{phase}</span>}
              {analyzeError && <span className="bad">{analyzeError}</span>}
              {done && <span>Jev: <b>{done.calls.toLocaleString()}</b> çağrı, {(scored * 8 + same.filter((x) => x !== undefined).length + statements.length + (chapters?.length ?? 0)).toLocaleString()} yapılandırılmış yanıt, <b>{elapsed!.toFixed(1)} sn</b>{done.failures ? ` · ${done.failures} başarısız` : ''}</span>}
            </div>

            <div className="exports">
              <span>indir <b>{exportLabel}</b> · {span(keptTime)}</span>
              {(['txt', 'md', 'srt', 'vtt', 'json'] as Format[]).map((f) => <button key={f} onClick={() => exportAs(f)}>.{f}</button>)}
            </div>
          </section>

          <section className="right">
            <nav className="tabs">
              {VIEWS.map((v) => (
                <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>
                  {v.label}
                  {v.key === 'claims' && statements.length > 0 && <em>{counts.claim}</em>}
                  {v.key === 'chapters' && chapters && <em>{chapters.length}</em>}
                </button>
              ))}
            </nav>

            {view === 'clean' && (
              <div className="toolbar">
                <span>çıkar</span>
                {DROPS.map((d) => (
                  <button key={d.key} className={drops.has(d.key) ? 'on' : ''} onClick={() => setDrops((prev) => { const n = new Set(prev); n.has(d.key) ? n.delete(d.key) : n.add(d.key); return n; })}>{d.label}</button>
                ))}
                <b className="keptinfo">{span(keptTime)} / {span(total)}</b>
              </div>
            )}
            {view === 'important' && (
              <div className="toolbar">
                <span>en önemli kısımları tut</span>
                <input aria-label="Tutulacak önemli içerik oranı" type="range" min={0.05} max={0.6} step={0.01} value={share} onChange={(e) => setShare(Number(e.target.value))} />
                <b className="keptinfo">{span(keptTime)} / {span(total)}</b>
              </div>
            )}
            {view === 'lens' && (
              <form className="lensform" onSubmit={runLens}>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ne arıyorsunuz? Örn. kayıt düzeniyle ilgili öneriler" />
                <button disabled={!query.trim()}>{lensBusy ? 'Aranıyor…' : 'Ara'}</button>
              </form>
            )}

            <div className="pane">
              {(view === 'full' || view === 'clean' || view === 'important' || (view === 'lens' && lensQuery)) && (
                <TranscriptView blocks={blocks} scores={scores} keep={keep} drops={drops} view={view} current={current} onSeek={seek} rel={rel} lensSpans={lensSpans} lensQuery={lensQuery} lensBusy={lensBusy} lensDone={lensDone} />
              )}
              {view === 'lens' && !lensQuery && (
                <div className="empty">
                  <p>Bir konu yazın. Jev her parçayı sorunuza göre <b>doğrudan ilgili</b>, <b>bağlantılı</b> veya <b>ilgisiz</b> olarak değerlendirir. Sonuçlar özet yerine transkriptteki pasajları ve zaman aralıklarını gösterir.</p>
                  <div className="chips">{['kayıt düzeniyle ilgili öneriler', 'girişimcilere tavsiyeler', 'geleceğe dair öngörüler', 'fikir ayrılıkları'].map((q) => <button key={q} onClick={() => setQuery(q)}>{q}</button>)}</div>
                </div>
              )}
              {view === 'chapters' && <ChaptersView chapters={chapters} duration={t.duration} now={now} onSeek={seek} blocks={blocks} scores={scores} />}
              {view === 'claims' && (
                <div>
                  <div className="toolbar sticky">
                    {(Object.keys(STATEMENT_LABELS) as StatementKind[]).filter((k) => k !== 'other').map((k) => (
                      <button key={k} className={stKind === k ? 'on' : ''} onClick={() => setStKind(k)}>{counts[k]} {STATEMENT_LABELS[k]}</button>
                    ))}
                  </div>
                  {!chapters && <div className="empty">Parçaların değerlendirilmesi bekleniyor. Cümle sınıflandırması yalnızca içerik taşıyan parçalarda yapılır; doğruluk kontrolü değildir.</div>}
                  {shownStatements.map((s, k) => (
                    <button key={k} className={`claim ${s.kind}`} onClick={() => seek(s.start)}>
                      <span className="ts">{clock(s.start)}</span>
                      <span className="txt">{s.text}</span>
                      <span className="conf" title="Jev modelinin bu sınıf için olasılık tahmini">{Math.round(s.p * 100)}%</span>
                    </button>
                  ))}
                </div>
              )}
              {view === 'highlights' && (
                <div>
                  <div className="toolbar"><span>öne çıkan ölçüt</span>{SIGNALS.map((s) => <button key={s.key} className={sig === s.key ? 'on' : ''} onClick={() => setSig(s.key)}>{s.label}</button>)}</div>
                  {!highlights.length && <div className="empty">Tüm parçalar değerlendirildiğinde öne çıkanlar görünür.</div>}
                  {highlights.map((h, k) => <Highlight key={k} h={h} blocks={blocks} scores={scores} onSeek={seek} />)}
                </div>
              )}
            </div>
            <label className="follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> oynatmayı takip et</label>
          </section>
        </div>
      )}
      <footer>Altyazı: YouTube veya yapıştırılan metin. Değerlendirme: TypeSafe Jev. Model yeni metin yazmaz; sınıflandırma yapar. Yalnızca kullanma izniniz olan içeriklerle deneyin.</footer>
    </main>
  );
}

// ---------------------------------------------------------------- transcript (full / clean / important / lens)

const REASON: Record<Drop, string> = { intro: 'giriş', outro: 'kapanış', sponsor: 'sponsor', housekeeping: 'duyurular', filler: 'dolgu', tangent: 'konu dışı' };

function TranscriptView({ blocks, scores, keep, drops, view, current, onSeek, rel, lensSpans, lensQuery, lensBusy, lensDone }: {
  blocks: Block[]; scores: (BlockScore | undefined)[]; keep: ((b: Block) => boolean) | null; drops: Set<Drop>; view: View; current: number; onSeek: (s: number) => void;
  rel: (Relevance | undefined)[]; lensSpans: Span[]; lensQuery: string; lensBusy: boolean; lensDone: { calls: number; ms: number } | null;
}) {
  // runs of removed blocks collapse into one seam line
  const rows: ({ kind: 'block'; b: Block } | { kind: 'gap'; from: Block; to: Block; reasons: string[] })[] = [];
  for (const b of blocks) {
    if (!keep || keep(b)) { rows.push({ kind: 'block', b }); continue; }
    const reason = view === 'clean' ? dropReason(scores[b.i], drops) : null;
    const last = rows[rows.length - 1];
    const r = reason ? REASON[reason] : view === 'important' ? 'daha az önemli' : 'ilgili değil';
    if (last?.kind === 'gap') { last.to = b; if (!last.reasons.includes(r)) last.reasons.push(r); } else rows.push({ kind: 'gap', from: b, to: b, reasons: [r] });
  }
  const scoredLens = rel.filter(Boolean).length;
  return (
    <div className="transcript">
      {view === 'lens' && (
        <div className="lensresult">
          <div>
            <b>“{lensQuery}”</b> — {lensBusy ? `${scoredLens}/${blocks.length} parça okunuyor…` : `${lensSpans.length} aralık · ${span(lensSpans.reduce((a, s) => a + s.end - s.start, 0))}`}{lensDone && ` · ${lensDone.calls} Jev çağrısı · ${(lensDone.ms / 1000).toFixed(1)} sn`}
          </div>
          <div className="ranges">{lensSpans.map((s, k) => <button key={k} onClick={() => onSeek(s.start)}>{clock(s.start)}–{clock(s.end)}</button>)}</div>
        </div>
      )}
      {rows.map((r, k) => r.kind === 'gap' ? (
        <div key={`g${k}`} className="gap" onClick={() => onSeek(r.from.start)}>
          <span>✂ {clock(r.from.start)}–{clock(r.to.end)}</span> {span(r.to.end - r.from.start)} çıkarıldı · {r.reasons.join(', ')}
        </div>
      ) : (
        <Para key={r.b.i} b={r.b} s={scores[r.b.i]} current={current === r.b.i} onSeek={onSeek} rel={view === 'lens' ? rel[r.b.i] : undefined} />
      ))}
    </div>
  );
}

const TAG_LABELS: Record<string, string> = { intro: 'giriş', outro: 'kapanış', sponsor: 'sponsor', housekeeping: 'duyuru', tangent: 'konu dışı', essential: 'önemli', surprising: 'şaşırtıcı', funny: 'komik', controversial: 'tartışmalı', actionable: 'uygulanabilir', novel: 'özgün', emotional: 'duygusal', relevant: 'ilgili', related: 'bağlantılı' };

function Para({ b, s, current, onSeek, rel }: { b: Block; s?: BlockScore; current: boolean; onSeek: (t: number) => void; rel?: Relevance }) {
  const imp = s ? signal(s, 'essential') : 0;
  const tags: string[] = [];
  if (s) {
    if (s.kind !== 'content') tags.push(s.kind);
    if (s.value === 'essential') tags.push('essential');
    for (const [k, v] of Object.entries(s.signals)) if (v >= 0.6) tags.push(k);
  }
  if (rel && rel !== 'irrelevant') tags.unshift(rel === 'direct' ? 'relevant' : 'related');
  return (
    <div id={`b${b.i}`} className={`para${current ? ' now' : ''}${rel === 'direct' ? ' hit' : ''}`} style={{ ['--imp' as string]: s ? imp.toFixed(2) : '0' }}>
      <button className="ts" onClick={() => onSeek(b.start)}>{clock(b.start)}</button>
      <div>
        <p>{b.text}</p>
        {tags.length > 0 && <div className="tags">{tags.map((x) => <span key={x} className={`tag ${x}`}>{TAG_LABELS[x] ?? x}</span>)}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- chapters

function ChaptersView({ chapters, duration, now, onSeek, blocks, scores }: { chapters: Chapter[] | null; duration: number; now: number; onSeek: (t: number) => void; blocks: Block[]; scores: (BlockScore | undefined)[] }) {
  if (!chapters) return <div className="empty">Bölümler, komşu pasajlar karşılaştırıldıktan sonra görünür: <i>burada yeni bir konu başlıyor mu?</i></div>;
  const youtube = chapters.map((c) => `${clock(c.start)} ${c.label}`).join('\n');
  return (
    <div className="chapters">
      <p className="note">Sınırlar komşu pasajların konu karşılaştırmasından çıkarılır. Başlıklar transkriptteki ayırt edici ifadeler arasından seçilir; yeni başlık metni üretilmez.</p>
      {chapters.map((c, k) => {
        const len = c.end - c.start;
        const imp = blocks.slice(c.from, c.to + 1).reduce((a, b) => a + (scores[b.i] ? signal(scores[b.i], 'essential') : 0), 0) / (c.to - c.from + 1);
        const active = now >= c.start && now < c.end;
        return (
          <button key={k} className={`chapter${active ? ' now' : ''}`} onClick={() => onSeek(c.start)}>
            <span className="ts">{clock(c.start)}</span>
            <span className="bar"><i style={{ width: `${Math.max(2, (len / duration) * 100 * 3)}%`, opacity: 0.35 + imp }} /></span>
            <span className="label">{c.label}<small>{c.candidates.filter((x) => x !== c.label).slice(0, 3).join(' · ')}</small></span>
            <span className="len">{span(len)}</span>
          </button>
        );
      })}
      <button className="copy" onClick={() => navigator.clipboard.writeText(youtube)}>Bölüm zamanlarını kopyala</button>
    </div>
  );
}

function Highlight({ h, blocks, scores, onSeek }: { h: Span; blocks: Block[]; scores: (BlockScore | undefined)[]; onSeek: (t: number) => void }) {
  const bs = blocks.slice(h.from, h.to + 1);
  const why = new Map<string, number>();
  for (const b of bs) for (const [k, v] of Object.entries(scores[b.i]?.signals ?? {})) why.set(k, Math.max(why.get(k) ?? 0, v));
  const reasons = [...why.entries()].filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const text = bs.map((b) => b.text).join(' ');
  return (
    <button className="highlight" onClick={() => onSeek(h.start)}>
      <div className="hhead"><span className="ts">{clock(h.start)}–{clock(h.end)}</span>{reasons.map((r) => <span key={r} className={`tag ${r}`}>{TAG_LABELS[r] ?? r}</span>)}<span className="score">{Math.round(h.score * 100)}</span></div>
      <p>{text.length > 420 ? text.slice(0, 420) + '…' : text}</p>
    </button>
  );
}
