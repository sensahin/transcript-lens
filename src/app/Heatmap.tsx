'use client';

import { useState } from 'react';
import type { Chapter } from '@/lib/analyze';
import { clock, type Block } from '@/lib/transcript';
import type { Span } from '@/lib/views';

// cold → hot, readable on the dark background
const STOPS: [number, number, number][] = [[28, 36, 62], [52, 92, 170], [120, 90, 220], [240, 110, 140], [255, 196, 90]];
export function heatColor(v: number): string {
  const x = Math.max(0, Math.min(1, v)) * (STOPS.length - 1);
  const k = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - k;
  const [a, b] = [STOPS[k], STOPS[k + 1]];
  return `rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * f)).join(',')})`;
}
const LENS: (v: number) => string = (v) => (v >= 0.9 ? '#5fe3a1' : v >= 0.3 ? '#2f7d63' : '#1a2230');

const W = 1000;

export function Heatmap({ blocks, values, duration, now, chapters, highlights, onSeek, lens }: {
  blocks: Block[]; values: number[]; duration: number; now: number; chapters: Chapter[] | null; highlights: Span[]; onSeek: (t: number) => void; lens: boolean;
}) {
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);
  const d = Math.max(duration, blocks[blocks.length - 1]?.end ?? 1);
  const x = (t: number) => (t / d) * W;
  const H = 64;

  const at = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * d;
    let i = 0;
    for (let k = 0; k < blocks.length; k++) if (blocks[k].start <= t) i = k;
    return { t, i, px: e.clientX - r.left, w: r.width };
  };

  return (
    <div className="heatwrap">
      <svg viewBox={`0 0 ${W} ${H + 26}`} preserveAspectRatio="none" className="heat"
        onMouseMove={(e) => { const a = at(e); setHover({ x: a.px / a.w, i: a.i }); }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { const a = at(e); onSeek(blocks[a.i].start); }}>
        {blocks.map((b, i) => {
          const v = values[i];
          const h = v < 0 ? 6 : 8 + v * (H - 8);
          return <rect key={i} x={x(b.start)} y={H - h} width={Math.max(0.6, x(b.end) - x(b.start) - 0.4)} height={h} fill={v < 0 ? '#1b1f2b' : lens ? LENS(v) : heatColor(v)} className={v < 0 ? 'pending' : ''} />;
        })}
        {highlights.map((s, k) => <rect key={`h${k}`} x={x(s.start)} y={0} width={Math.max(2, x(s.end) - x(s.start))} height={H} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.2} vectorEffect="non-scaling-stroke" rx={1} />)}
        {chapters?.map((c, k) => (
          <g key={`c${k}`}>
            <rect x={x(c.start)} y={H + 6} width={Math.max(1, x(c.end) - x(c.start) - 1.5)} height={16} fill={k % 2 ? '#262c3d' : '#323a51'} rx={2} />
          </g>
        ))}
        <line x1={x(now)} x2={x(now)} y1={0} y2={H + 24} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {chapters && (
        <div className="chaplabels">
          {chapters.map((c, k) => (
            <span key={k} style={{ left: `${(c.start / d) * 100}%`, width: `${((c.end - c.start) / d) * 100}%` }} title={`${clock(c.start)} ${c.label}`} onClick={() => onSeek(c.start)}>{c.label}</span>
          ))}
        </div>
      )}
      {hover && blocks[hover.i] && (
        <div className="tip" style={{ left: `${Math.min(78, Math.max(0, hover.x * 100 - 11))}%` }}>
          <b>{clock(blocks[hover.i].start)}</b> {values[hover.i] >= 0 && <em>{Math.round(values[hover.i] * 100)}</em>}
          <div>{blocks[hover.i].text.slice(0, 150)}…</div>
        </div>
      )}
      <div className="axis"><span>0:00</span><span>{clock(d / 2)}</span><span>{clock(d)}</span></div>
    </div>
  );
}
