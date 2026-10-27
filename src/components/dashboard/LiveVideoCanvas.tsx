import React, { useEffect, useRef } from 'react';
import type { FrameMeta } from '../../services/liveCameraService';

export type StreamPhase = 'connecting' | 'streaming' | 'reconnecting';

interface LiveVideoCanvasProps {
  url: string;
  showOverlay: boolean;
  fit?: 'cover' | 'contain';
  /** Called at most ~10x/second with the metadata of the frame currently on screen. */
  onMeta?: (meta: FrameMeta) => void;
  onPhase?: (phase: StreamPhase) => void;
  className?: string;
}

/** Overlay lagging more than this many source frames behind the video is hidden rather than shown misaligned. */
const MAX_OVERLAY_LAG_FRAMES = 8;
const HEADER_END = [13, 10, 13, 10];

const inPoly = (x: number, y: number, poly: number[][]): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

type Box = { x: number; y: number; w: number; h: number };
interface Motion { frame: number; box: Box; vx: number; vy: number }

/** Detections are computed on a frame a few frames older than the frame being shown. For a person who moves fast that makes the box trail behind
 *  the picture, so each tracked box is shifted by its own measured velocity times the number of frames it is behind (bounded, per track id). */
function compensate(motion: Map<number, Motion>, id: number, b: Box, frameId: number, lag: number): Box {
  const prev = motion.get(id);
  let vx = prev?.vx ?? 0;
  let vy = prev?.vy ?? 0;
  if (!prev || frameId > prev.frame) {
    if (prev && frameId - prev.frame <= 6) {
      const dt = frameId - prev.frame;
      vx = 0.5 * vx + 0.5 * ((b.x - prev.box.x) / dt);
      vy = 0.5 * vy + 0.5 * ((b.y - prev.box.y) / dt);
    } else {
      vx = 0;
      vy = 0;
    }
    motion.set(id, { frame: frameId, box: { ...b }, vx, vy });
  }
  const sx = Math.max(-0.2, Math.min(0.2, vx * lag));
  const sy = Math.max(-0.2, Math.min(0.2, vy * lag));
  return { x: Math.max(0, Math.min(1 - b.w, b.x + sx)), y: Math.max(0, Math.min(1 - b.h, b.y + sy)), w: b.w, h: b.h };
}

/** The box that is DRAWN. When a person fills the frame (cut off at the bottom, e.g. a laptop webcam) the detector's box runs to the picture edge; only the
 *  head-and-shoulders part is outlined so the marker stays small. Counting and regions still use the detector's real box. */
function displayBox(b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  if (b.y + b.h < 0.97) return b;
  return { x: b.x + b.w * 0.12, y: b.y, w: b.w * 0.76, h: b.h * 0.55 };
}

/** Reference point of a person: the feet, or the middle of the box when the person is cut off by the bottom of the picture (same rule as the worker). */
function refPoint(b: { x: number; y: number; w: number; h: number }): [number, number] {
  return b.y + b.h >= 0.97 ? [b.x + b.w / 2, b.y + b.h * 0.5] : [b.x + b.w / 2, b.y + b.h];
}

/** The region of THIS camera a person is in, and what that means for this camera's role (waiting in a lane, being served at a counter, browsing an aisle). */
function roleFor(ctx: FrameMeta['context'], b: { x: number; y: number; w: number; h: number }): { show: boolean; label: string } {
  if (!ctx) return { show: true, label: '' };
  const [fx, fy] = refPoint(b);
  const hit = (rs?: { name: string; poly: number[][] }[]) => rs?.find((r) => inPoly(fx, fy, r.poly));
  if (ctx.kind === 'queue') {
    const r = hit(ctx.queues);
    return { show: !!r, label: r ? `${r.name.split(' (')[0]} · waiting` : '' };
  }
  if (ctx.kind === 'checkout') {
    const r = hit(ctx.counters);
    return { show: !!r, label: r ? `${r.name.split(' (')[0]} · serving` : '' };
  }
  if (ctx.kind === 'aisle') {
    const r = hit(ctx.zones);
    return { show: !!r, label: r ? `${r.name.split(' - ')[0]} · browsing` : '' };
  }
  if (ctx.kind === 'exit') {
    const r = hit(ctx.counters);
    return { show: true, label: r ? `${r.name.split(' (')[0]}` : 'leaving' };
  }
  return { show: true, label: ctx.kind === 'entrance' ? 'entering' : '' };
}

function drawContext(g: CanvasRenderingContext2D, c: NonNullable<FrameMeta['context']>, W: number, H: number): void {
  const font = Math.max(11, Math.round(W / 60));
  g.save();
  g.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  g.textBaseline = 'top';
  const poly = (pts: number[][], stroke: string, fill: string, label: string) => {
    if (pts.length < 3) return;
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * W, y * H) : g.lineTo(x * W, y * H)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = stroke;
    g.stroke();
    // the label must fit inside its own region: drop the "(webcam strip)" style suffix, then shorten with an ellipsis if it is still too wide
    const xs = pts.map((q) => q[0] * W);
    const room = Math.max(...xs) - Math.min(...xs) - 8;
    let text = label.replace(/\s*\([^)]*\)/g, '');
    while (text.length > 3 && g.measureText(text).width > room) text = `${text.slice(0, -2)}…`;
    g.fillStyle = stroke;
    g.fillText(text, Math.min(...xs) + 4, Math.min(...pts.map((q) => q[1] * H)) + 3);
  };
  for (const z of c.zones ?? []) poly(z.poly, z.n > 0 ? '#22c55e' : 'rgba(148,163,184,0.9)', z.n > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.04)', `${z.name.split(' - ')[0]}: ${z.n}`);
  for (const q of c.queues ?? []) poly(q.poly, q.n > 0 ? '#f59e0b' : 'rgba(148,163,184,0.9)', q.n > 0 ? 'rgba(245,158,11,0.14)' : 'rgba(148,163,184,0.04)', `${q.name.split(' (')[0]}: ${q.n}`);
  for (const k of c.counters ?? []) {
    poly(k.poly, k.n > 0 ? '#10b981' : '#3b82f6', k.n > 0 ? 'rgba(16,185,129,0.16)' : 'rgba(59,130,246,0.07)', `${k.name.split(' (')[0]}${k.n > 0 ? ` · ${k.n}` : ''}`);
    // numbered marker pin at the counter
    const xs = k.poly.map((q) => q[0]);
    const ys = k.poly.map((q) => q[1]);
    const mx = ((Math.min(...xs) + Math.max(...xs)) / 2) * W;
    const my = ((Math.min(...ys) + Math.max(...ys)) / 2) * H;
    const r = Math.max(12, Math.round(W / 40));
    g.beginPath();
    g.arc(mx, my, r, 0, Math.PI * 2);
    g.fillStyle = k.n > 0 ? '#10b981' : '#2563eb';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(/(\d+)/.exec(k.name)?.[1] ?? '•', mx, my + 1);
    g.textAlign = 'left';
    g.textBaseline = 'top';
  }
  for (const s of c.shelves ?? []) poly(s.poly, '#a78bfa', 'rgba(167,139,250,0.06)', `${s.name}${s.n == null ? '' : `: ${s.n}`}`);
  for (const l of c.lines ?? []) {
    g.beginPath();
    g.moveTo(l.p1[0] * W, l.p1[1] * H);
    g.lineTo(l.p2[0] * W, l.p2[1] * H);
    g.lineWidth = 3;
    g.strokeStyle = '#38bdf8';
    g.setLineDash([10, 6]);
    g.stroke();
    g.setLineDash([]);
    const mx = ((l.p1[0] + l.p2[0]) / 2) * W;
    const my = ((l.p1[1] + l.p2[1]) / 2) * H;
    g.beginPath();
    g.moveTo(mx, my);
    const dirSign = l.countOnly === 'out' ? -1 : 1;
    g.lineTo(mx + dirSign * l.inDir[0] * W * 0.35, my + dirSign * l.inDir[1] * H * 0.35);
    g.strokeStyle = l.countOnly === 'out' ? '#f97316' : '#22c55e';
    g.lineWidth = 3;
    g.stroke();
    if (l.countOnly !== 'out') {
      g.fillStyle = '#22c55e';
      g.fillText(`IN ${l.in}`, mx + l.inDir[0] * W * 0.35 + 6, my + l.inDir[1] * H * 0.35 - font / 2);
    }
    if (l.countOnly !== 'in') {
      g.fillStyle = '#f97316';
      g.fillText(`OUT ${l.out}`, mx - l.inDir[0] * W * 0.35 - 70, my - l.inDir[1] * H * 0.35 - font / 2);
    }
  }
  g.strokeStyle = '#f59e0b';
  g.lineWidth = 2;
  for (const it of c.items ?? []) g.strokeRect(it[0] * W, it[1] * H, it[2] * W, it[3] * H);
  g.restore();
}

function indexOfHeaderEnd(buf: Uint8Array, from: number): number {
  for (let i = from; i + 3 < buf.length; i++) {
    if (buf[i] === HEADER_END[0] && buf[i + 1] === HEADER_END[1] && buf[i + 2] === HEADER_END[2] && buf[i + 3] === HEADER_END[3]) {
      return i;
    }
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Plays the backend's multipart MJPEG stream on a canvas. Every part carries the metadata of
 * its own frame (including the detections that apply to it), so boxes are drawn on the exact frame
 * they were computed for. No raw RTSP and no credentials ever reach the browser.
 */
export const LiveVideoCanvas: React.FC<LiveVideoCanvasProps> = ({ url, showOverlay, fit = 'cover', onMeta, onPhase, className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef(showOverlay);
  const metaCb = useRef(onMeta);
  const phaseCb = useRef(onPhase);
  useEffect(() => {
    overlayRef.current = showOverlay;
    metaCb.current = onMeta;
    phaseCb.current = onPhase;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    let lastMetaAt = 0;
    const motion = new Map<number, Motion>();

    const draw = async (jpeg: Uint8Array, meta: FrameMeta) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
      if (cancelled) {
        bitmap.close();
        return;
      }
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const camCtx = meta.context;
      if (overlayRef.current && camCtx) drawContext(ctx, camCtx, canvas.width, canvas.height);
      const ov = meta.overlay;
      if (overlayRef.current && ov && ov.lagFrames <= MAX_OVERLAY_LAG_FRAMES && camCtx?.kind !== 'shelf') {
        const W = canvas.width;
        const H = canvas.height;
        const line = Math.max(1, Math.round(W / 640));
        const font = Math.max(9, Math.round(W / 80));
        ctx.lineWidth = line;
        ctx.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = 'top';
        for (const b of ov.boxes) {
          const role = roleFor(camCtx, b);
          if (!role.show) continue; // a person outside this camera's regions is not what this camera is detecting
          const d = displayBox(compensate(motion, b.id, b, ov.frameId, ov.lagFrames));
          const x = d.x * W;
          const y = d.y * H;
          const w = d.w * W;
          const h = d.h * H;
          ctx.strokeStyle = '#38bdf8';
          ctx.fillStyle = 'rgba(56,189,248,0.12)';
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
          const label = `${role.label ? `${role.label} · ` : ''}#${b.id} ${Math.round(b.c * 100)}%`;
          const tw = ctx.measureText(label).width + 8;
          const ly = y - font - 6 < 0 ? y : y - font - 6;
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(x, ly, tw, font + 6);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, x + 4, ly + 3);
        }
      }
      const now = performance.now();
      if (metaCb.current && now - lastMetaAt > 100) {
        lastMetaAt = now;
        metaCb.current(meta);
      }
    };

    const run = async () => {
      let delay = 1000;
      let first = true;
      while (!cancelled) {
        phaseCb.current?.(first ? 'connecting' : 'reconnecting');
        first = false;
        try {
          const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          const reader = res.body.getReader();
          let buf: Uint8Array = new Uint8Array(0);
          let busy = false;
          let pending: { jpeg: Uint8Array; meta: FrameMeta } | null = null;

          const pump = async () => {
            // Always draw the newest decoded frame; older queued ones are skipped to stay live.
            if (busy) return;
            busy = true;
            while (pending && !cancelled) {
              const job = pending;
              pending = null;
              try {
                await draw(job.jpeg, job.meta);
              } catch {
                /* a corrupt frame must not kill the stream */
              }
            }
            busy = false;
          };

          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf = concat(buf, value);
            for (;;) {
              const end = indexOfHeaderEnd(buf, 0);
              if (end < 0) break;
              const head = new TextDecoder('ascii').decode(buf.subarray(0, end));
              const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? NaN);
              const metaRaw = /x-frame-meta:\s*(.+)/i.exec(head)?.[1];
              if (!Number.isFinite(len) || !metaRaw) {
                buf = buf.subarray(end + 4);
                continue;
              }
              if (buf.length < end + 4 + len + 2) break;
              const jpeg = buf.slice(end + 4, end + 4 + len);
              buf = buf.slice(end + 4 + len + 2);
              try {
                pending = { jpeg, meta: JSON.parse(metaRaw) as FrameMeta };
              } catch {
                continue;
              }
              if (!busy) {
                phaseCb.current?.('streaming');
                delay = 1000;
              }
              void pump();
            }
          }
        } catch {
          if (cancelled) return;
        }
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 10000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [url]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={360}
      className={className ?? `w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} block bg-slate-950`}
    />
  );
};
