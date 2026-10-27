import React, { useState, useEffect, useRef } from 'react';
import {
  Maximize2,
  Eye,
  EyeOff,
  AlertTriangle,
  RefreshCw,
  VideoOff,
} from 'lucide-react';
import type { CameraFeed, DetectionBox } from '../../types/retail';
import { contextMetrics } from '../../services/liveCameraService';
import type { FrameMeta, LiveCamera } from '../../services/liveCameraService';
import { LiveVideoCanvas } from './LiveVideoCanvas';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { CameraFullscreenModal } from './CameraFullscreenModal';

interface CameraFeedCardProps {
  feed: CameraFeed;
  /** Backend camera for this feed (only when live cameras are enabled). */
  live?: LiveCamera;
  /** True when the dashboard reads cameras from the backend; placeholder scenes are then never shown. */
  liveMode?: boolean;
}

const fmtMs = (v: number | null | undefined) => (v == null ? '--' : `${v.toFixed(v < 10 ? 1 : 0)} ms`);
const fmtFps = (v: number | null | undefined) => (v == null ? '--' : v.toFixed(1));

export const CameraFeedCard: React.FC<CameraFeedCardProps> = ({ feed, live, liveMode = false }) => {
  const [showDetections, setShowDetections] = useState(true);
  const [meta, setMeta] = useState<FrameMeta | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [tick, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Subtle simulated motion oscillation for bounding boxes
  useEffect(() => {
    if (liveMode) return;
    let animationFrameId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      if (currentTime - lastTime > 400) {
        lastTime = currentTime;
        setTick((prev) => (prev + 1) % 100);
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [liveMode]);

  // Draw simulated CCTV camera scene on canvas with realistic store environment
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background gradient for CCTV lighting
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    if (feed.type === 'entrance') {
      bgGradient.addColorStop(0, '#0f172a');
      bgGradient.addColorStop(0.5, '#1e293b');
      bgGradient.addColorStop(1, '#020617');
    } else if (feed.type === 'shelf') {
      bgGradient.addColorStop(0, '#111827');
      bgGradient.addColorStop(0.5, '#1f2937');
      bgGradient.addColorStop(1, '#030712');
    } else if (feed.type === 'checkout') {
      bgGradient.addColorStop(0, '#0c1a2f');
      bgGradient.addColorStop(0.5, '#162b48');
      bgGradient.addColorStop(1, '#050c18');
    } else {
      bgGradient.addColorStop(0, '#131b2e');
      bgGradient.addColorStop(0.5, '#1e2d4d');
      bgGradient.addColorStop(1, '#0a101d');
    }
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Architectural perspective lines for store layout
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;

    // Vanishing point lines
    const vpX = width * 0.5;
    const vpY = height * 0.35;

    ctx.beginPath();
    ctx.moveTo(0, height * 0.95);
    ctx.lineTo(vpX, vpY);
    ctx.moveTo(width, height * 0.95);
    ctx.lineTo(vpX, vpY);
    ctx.moveTo(width * 0.25, height);
    ctx.lineTo(vpX, vpY);
    ctx.moveTo(width * 0.75, height);
    ctx.lineTo(vpX, vpY);
    ctx.stroke();

    // Subtle horizontal aisle / floor tiles
    for (let i = 1; i <= 4; i++) {
      const y = vpY + (height - vpY) * (i / 4.5);
      ctx.beginPath();
      ctx.moveTo(width * 0.1, y);
      ctx.lineTo(width * 0.9, y);
      ctx.stroke();
    }

    // Specific scene features depending on camera type
    if (feed.type === 'entrance') {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.strokeRect(width * 0.2, height * 0.2, width * 0.6, height * 0.65);
      ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';
      ctx.fillRect(width * 0.25, height * 0.75, width * 0.5, height * 0.15);
    } else if (feed.type === 'shelf') {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(width * 0.12, height * 0.2, width * 0.76, height * 0.55);
      ctx.beginPath();
      ctx.moveTo(width * 0.12, height * 0.38);
      ctx.lineTo(width * 0.88, height * 0.38);
      ctx.moveTo(width * 0.12, height * 0.55);
      ctx.lineTo(width * 0.88, height * 0.55);
      ctx.stroke();
    } else if (feed.type === 'checkout') {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(width * 0.1, height * 0.45, width * 0.2, height * 0.45);
      ctx.fillRect(width * 0.4, height * 0.45, width * 0.2, height * 0.45);
      ctx.fillRect(width * 0.7, height * 0.45, width * 0.2, height * 0.45);
    }

    // Scanline & noise CCTV effect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let y = 0; y < height; y += 4) {
      ctx.fillRect(0, y, width, 1);
    }
  }, [feed.type, tick]);

  const streaming = Boolean(liveMode && live && live.status === 'live' && live.stream.available && live.stream.url);

  const getStatusBadge = () => {
    if (liveMode) {
      const st = live?.status;
      if (st === 'live') {
        return (
          <>
            {live?.isDemo && (
              <Badge variant="warning" size="sm">
                DEMO
              </Badge>
            )}
            <Badge variant="success" size="sm" dot>
              LIVE
            </Badge>
          </>
        );
      }
      if (st === 'connecting' || st === 'reconnecting' || st === 'buffering') {
        return (
          <Badge variant="primary" size="sm" dot>
            CONNECTING...
          </Badge>
        );
      }
      return (
        <Badge variant="error" size="sm" dot>
          OFFLINE
        </Badge>
      );
    }
    switch (feed.status) {
      case 'live':
        return (
          <Badge variant="success" size="sm" dot>
            LIVE
          </Badge>
        );
      case 'demo':
        return (
          <Badge variant="success" size="sm" dot>
            LIVE
          </Badge>
        );
      case 'connecting':
        return (
          <Badge variant="primary" size="sm" dot>
            CONNECTING...
          </Badge>
        );
      default:
        return (
          <Badge variant="error" size="sm" dot>
            OFFLINE
          </Badge>
        );
    }
  };

  // Adjust coordinates slightly for live tracking effect
  const detections = feed.currentDetection.detections.map((box, idx) => {
    const jitterX = Math.sin((tick + idx * 2) * 0.5) * 0.8;
    const jitterY = Math.cos((tick + idx * 2) * 0.5) * 0.6;
    return {
      ...box,
      x: Math.max(2, Math.min(88, box.x + jitterX)),
      y: Math.max(2, Math.min(88, box.y + jitterY)),
    };
  });

  const cm = contextMetrics(meta?.context, meta?.overlay ? meta.overlay.boxes.length : live?.peopleCount ?? null, live?.inferenceFps ?? null);
  return (
    <>
      <Card hoverEffect className="flex flex-col h-full bg-white border border-slate-200">
        {/* Card Header: Camera ID, Name, Status, Actions */}
        <div className="px-3 py-1.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 bg-slate-50/50">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 basis-full order-last">
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-slate-900 truncate leading-tight">{feed.name}</h4>
            </div>
          </div>

          <span className="font-mono text-caption font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 shrink-0">
            {feed.cameraCode || feed.id}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {getStatusBadge()}
            <button
              onClick={() => setShowDetections(!showDetections)}
              className={`p-1 rounded-md border text-xs transition-colors cursor-pointer ${
                showDetections
                  ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                  : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600'
              }`}
              title={showDetections ? 'Hide AI bounding boxes' : 'Show AI bounding boxes'}
            >
              {showDetections ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
            <button
              onClick={() => setIsFullscreen(true)}
              className="p-1 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
              title="Fullscreen view"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Video Canvas Container */}
        <div className="relative aspect-video max-h-[285px] w-full bg-slate-950 overflow-hidden select-none group">
          {liveMode ? (
            streaming && live?.stream.url ? (
              <>
                <LiveVideoCanvas url={live.stream.url} showOverlay={showDetections} onMeta={setMeta} />
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 pointer-events-none">
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/70 border border-white/10 text-white font-mono text-caption backdrop-blur-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {feed.cameraCode} &bull; {fmtFps(meta?.inputFps ?? live.inputFps)} FPS
                  </span>
                </div>
                <div className="absolute bottom-2 left-2.5 right-2.5 z-10 flex items-center justify-between text-caption text-white/80 font-mono pointer-events-none drop-shadow">
                  <span>{meta ? new Date(meta.ts).toLocaleTimeString([], { hour12: false }) : ''}</span>
                  <span className="bg-black/60 px-1.5 py-0.5 rounded text-blue-300">
                    {cm.badge} &bull; {fmtMs(live.inferenceMs)}
                  </span>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                <VideoOff className="w-7 h-7 text-slate-500 mb-2" />
                <p className="text-xs font-medium text-slate-300">
                  {live ? (live.status === 'live' ? 'No video' : live.status === 'offline' || live.status === 'error' ? 'Offline' : 'Connecting') : 'Not registered'}
                </p>
                <p className="text-caption text-slate-500 mt-1 line-clamp-2">
                  {live ? live.message ?? live.stream.reason ?? '' : 'Camera service unreachable'}
                </p>
              </div>
            )
          ) : hasError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-4">
              <AlertTriangle className="w-8 h-8 text-amber-500 mb-2" />
              <p className="text-xs font-medium">Video Stream Adapter Offline</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHasError(false)}
                className="mt-3 text-xs bg-slate-900 border-slate-700 text-slate-200"
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Retry Connection
              </Button>
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                width={640}
                height={360}
                className="w-full h-full object-cover block"
              />

              {/* Top HUD overlay */}
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 pointer-events-none">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/70 border border-white/10 text-white font-mono text-caption backdrop-blur-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {feed.cameraCode} &bull; {feed.fps ?? '--'} FPS
                </span>
              </div>

              {/* Bottom HUD overlay */}
              <div className="absolute bottom-2 left-2.5 right-2.5 z-10 flex items-center justify-between text-caption text-white/80 font-mono pointer-events-none drop-shadow">
                <span>{feed.lastFrameTimestamp}</span>
                <span className="bg-black/60 px-1.5 py-0.5 rounded text-blue-300">
                  {feed.currentDetection.peopleCount ?? '--'} Persons in Zone
                </span>
              </div>

              {/* AI Detection Overlays */}
              {showDetections &&
                detections.map((box: DetectionBox) => {
                  const isCritical = box.status === 'critical';
                  const isWarning = box.status === 'warning';
                  const isSuccess = box.status === 'success' || box.status === 'optimal';

                  const boxClass = isCritical
                    ? 'border-rose-500 bg-rose-500/15'
                    : isWarning
                    ? 'border-amber-400 bg-amber-400/15'
                    : isSuccess
                    ? 'border-emerald-400 bg-emerald-400/15'
                    : 'border-blue-400 bg-blue-500/15';

                  const badgeClass = isCritical
                    ? 'bg-rose-600 text-white'
                    : isWarning
                    ? 'bg-amber-500 text-white'
                    : isSuccess
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 text-white';

                  return (
                    <div
                      key={box.id}
                      className={`absolute border-2 rounded transition-all duration-300 pointer-events-none ${boxClass}`}
                      style={{
                        left: `${box.x}%`,
                        top: `${box.y}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                      }}
                    >
                    </div>
                  );
                })}
            </>
          )}
        </div>

        {/* Detection Metrics Summary Footer */}
        <div className="px-3 py-1.5 bg-white border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <p className="text-caption text-slate-400 leading-none">{liveMode ? cm.primaryLabel : feed.metrics.primaryLabel}</p>
            <p className="text-xs font-semibold text-slate-900 mt-0.5 leading-tight">
              {liveMode ? (streaming ? cm.primaryValue : '--') : feed.metrics.primaryValue}
            </p>
          </div>

          <div className="min-w-0 border-l border-slate-100 pl-2">
            <p className="text-caption text-slate-400 leading-none">{liveMode ? cm.secondaryLabel : feed.metrics.secondaryLabel}</p>
            <p className="text-xs font-semibold text-slate-900 mt-0.5 leading-tight">
              {liveMode ? (streaming ? cm.secondaryValue : '--') : feed.metrics.secondaryValue}
            </p>
          </div>

          <div className="shrink-0">
            <button
              onClick={() => setIsFullscreen(true)}
              className="inline-flex items-center gap-0.5 text-caption font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
            >
              Expand
              <Maximize2 className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      </Card>

      {/* Fullscreen Modal */}
      <CameraFullscreenModal
        feed={feed}
        live={live}
        liveMode={liveMode}
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        showDetections={showDetections}
        onToggleDetections={() => setShowDetections(!showDetections)}
      />
    </>
  );
};
