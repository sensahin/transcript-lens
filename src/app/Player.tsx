'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface PlayerHandle { seek: (sec: number) => void }

interface YTPlayer { seekTo(s: number, allow: boolean): void; playVideo(): void; getCurrentTime(): number; destroy(): void }
declare global {
  interface Window { YT?: { Player: new (el: HTMLElement, o: object) => YTPlayer }; onYouTubeIframeAPIReady?: () => void }
}

let api: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  api ??= new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return api;
}

export const Player = forwardRef<PlayerHandle, { id: string; onTime: (t: number) => void }>(function Player({ id, onTime }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const pendingSeek = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    seek(sec: number) {
      if (player.current && ready.current) { player.current.seekTo(sec, true); player.current.playVideo(); } else pendingSeek.current = sec;
    },
  }), []);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setInterval>;
    loadApi().then(() => {
      if (dead || !host.current) return;
      const el = document.createElement('div');
      host.current.innerHTML = '';
      host.current.appendChild(el);
      player.current = new window.YT!.Player(el, {
        videoId: id,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            ready.current = true;
            if (pendingSeek.current !== null) { player.current!.seekTo(pendingSeek.current, true); player.current!.playVideo(); pendingSeek.current = null; }
          },
        },
      });
      timer = setInterval(() => { if (ready.current) onTime(player.current!.getCurrentTime() || 0); }, 300);
    });
    return () => { dead = true; clearInterval(timer); ready.current = false; player.current?.destroy(); player.current = null; };
  }, [id, onTime]);

  return <div className="player"><div ref={host} /></div>;
});
