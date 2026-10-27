import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  Maximize2,
  Eye,
  EyeOff,
  Layers,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  PackageX,
} from 'lucide-react';
import type { CameraFeed, ShelfDetail } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { CameraFullscreenModal } from '../dashboard/CameraFullscreenModal';

interface LiveShelfCameraMonitoringProps {
  cameras: CameraFeed[];
  selectedCameraId: string;
  onSelectCameraId: (id: string) => void;
  selectedShelf: ShelfDetail | null;
}

const DEFAULT_SHELF_CAMERA: CameraFeed = {
  id: 'CAM-02',
  name: 'Camera 02 — Smart Shelves',
  cameraCode: 'CAM-SHF-02',
  type: 'shelf',
  zone: 'Aisle 3 (Dairy & Cold Beverages)',
  resolution: '2560x1440 @ 25fps',
  streamType: 'demo_canvas',
  fps: 25,
  status: 'demo',
  lastFrameTimestamp: 'Just now (live)',
  currentDetection: {
    timestamp: new Date().toISOString(),
    frameCount: 71092,
    peopleCount: 2,
    alertsDetected: 2,
    detections: [
      { id: 's1', label: 'Low: Almond Milk', confidence: 0.95, x: 16, y: 22, width: 28, height: 32, status: 'warning' },
      { id: 's2', label: 'OK: Organic Milk', confidence: 0.98, x: 48, y: 22, width: 26, height: 32, status: 'success' },
      { id: 's3', label: 'Empty: Sourdough', confidence: 0.92, x: 76, y: 22, width: 20, height: 32, status: 'critical' },
    ],
  },
  metrics: {
    primaryLabel: 'Shelf Fill Rate',
    primaryValue: '86.4%',
    secondaryLabel: 'Depletion Speed',
    secondaryValue: '14 items/hr',
    statusTag: '2 Shelves Alerting',
  },
};

export const LiveShelfCameraMonitoring: React.FC<LiveShelfCameraMonitoringProps> = ({
  cameras,
  selectedCameraId,
  onSelectCameraId,
  selectedShelf,
}) => {
  const [showDetections, setShowDetections] = useState(true);
  const [showPlanogramOverlay, setShowPlanogramOverlay] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tick, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeCamera =
    (cameras && cameras.find((c) => c.id === selectedCameraId)) ||
    (cameras && cameras.find((c) => c.type === 'shelf')) ||
    (cameras && cameras[0]) ||
    DEFAULT_SHELF_CAMERA;

  // Subtle simulated camera sensor jitter
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      if (currentTime - lastTime > 400) {
        lastTime = currentTime;
        setTick((prev) => (prev + 1) % 100);
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Render shelf CCTV simulation with shelf racks and product outlines
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background gradient for shelf interior lighting
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e293b');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Shelf architectural horizontal frame
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.lineWidth = 3;

    // Shelf Tiers (Tier 1, Tier 2, Tier 3)
    const tierHeights = [height * 0.28, height * 0.54, height * 0.80];
    tierHeights.forEach((y, idx) => {
      ctx.beginPath();
      ctx.moveTo(width * 0.08, y);
      ctx.lineTo(width * 0.92, y);
      ctx.stroke();

      // Shelf vertical dividers
      for (let x = width * 0.12; x <= width * 0.88; x += width * 0.16) {
        ctx.beginPath();
        ctx.moveTo(x, y - height * 0.22);
        ctx.lineTo(x, y);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Shelf label bar
      ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
      ctx.fillRect(width * 0.08, y, width * 0.84, 8);
    });

    // Planogram expected slot outline overlays
    if (showPlanogramOverlay) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      // Tier 1 Slots
      for (let x = width * 0.12; x < width * 0.84; x += width * 0.16) {
        ctx.strokeRect(x + 4, height * 0.08, width * 0.14, height * 0.19);
      }
      // Tier 2 Slots
      for (let x = width * 0.12; x < width * 0.84; x += width * 0.16) {
        ctx.strokeRect(x + 4, height * 0.34, width * 0.14, height * 0.19);
      }
      ctx.setLineDash([]);
    }

    // Scanlines & noise CCTV effect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let y = 0; y < height; y += 4) {
      ctx.fillRect(0, y, width, 1);
    }
  }, [showPlanogramOverlay, tick]);

  // Detected bounding boxes with subtle animated tracking
  const detectedBoxes = [
    {
      id: 'b1',
      label: 'Low: Almond Milk',
      status: 'warning',
      x: 14 + Math.sin(tick * 0.5) * 0.5,
      y: 10,
      w: 24,
      h: 18,
      confidence: 0.96,
    },
    {
      id: 'b2',
      label: 'OK: Oat Milk',
      status: 'success',
      x: 44,
      y: 10,
      w: 22,
      h: 18,
      confidence: 0.98,
    },
    {
      id: 'b3',
      label: 'Wrong item',
      status: 'misplaced',
      x: 70,
      y: 10,
      w: 18,
      h: 18,
      confidence: 0.91,
    },
    {
      id: 'b4',
      label: 'Empty: Sourdough',
      status: 'critical',
      x: 14,
      y: 36,
      w: 32,
      h: 17,
      confidence: 0.95,
      isGap: true,
    },
    {
      id: 'b5',
      label: 'OK: Ciabatta',
      status: 'success',
      x: 52,
      y: 36,
      w: 36,
      h: 17,
      confidence: 0.93,
    },
  ];

  return (
    <>
      <Card className="flex flex-col border-slate-200 shadow-card xl:h-full">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="flex items-center gap-2 whitespace-nowrap">
                <Video className="w-4 h-4 text-blue-600" />
                Shelf Camera
              </CardTitle>
              <Badge variant="warning" size="sm" dot>
                Live Feed
              </Badge>
            </div>
            <CardDescription>
              Spots empty shelf gaps.
            </CardDescription>
          </div>

          {/* Camera Selection and Toggles */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Camera Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold">
              <span className="text-slate-400">Feed:</span>
              <select
                value={activeCamera?.id || 'CAM-02'}
                onChange={(e) => onSelectCameraId(e.target.value)}
                className="bg-transparent text-slate-800 font-semibold focus:outline-none cursor-pointer"
              >
                {(cameras && cameras.length > 0 ? cameras : [DEFAULT_SHELF_CAMERA]).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.name.split('—')[1] || c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Planogram Overlay Toggle */}
            <button
              onClick={() => setShowPlanogramOverlay(!showPlanogramOverlay)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer ${
                showPlanogramOverlay
                  ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
              title="Show/hide target planogram slot wireframes"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Overlay</span>
            </button>

            {/* Detections Toggle */}
            <button
              onClick={() => setShowDetections(!showDetections)}
              className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                showDetections
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'
              }`}
              title="Toggle bounding boxes"
            >
              {showDetections ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>

            {/* Fullscreen Button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsFullscreen(true)}
              className="bg-white hover:bg-slate-50"
              title="Fullscreen video feed"
            >
              <Maximize2 className="w-4 h-4 text-slate-600" />
            </Button>
          </div>
        </CardHeader>

        {/* Video Canvas Container */}
        <div className="relative aspect-video xl:aspect-auto xl:flex-1 xl:min-h-[320px] w-full bg-slate-950 overflow-hidden select-none group">
          <canvas
            ref={canvasRef}
            width={854}
            height={480}
            className="w-full h-full object-cover block"
          />

          {/* Top HUD */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/75 border border-white/10 text-white font-mono text-caption backdrop-blur-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {activeCamera?.cameraCode || 'CAM-SHF-02'} &bull; {activeCamera?.fps || 25} FPS
            </span>
          </div>

          {/* Bottom HUD */}
          <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between text-xs text-white/90 font-mono pointer-events-none drop-shadow">
            <span className="bg-black/60 px-2 py-0.5 rounded text-caption">
              {selectedShelf ? selectedShelf.shelfCode : 'Aisle 3'}
            </span>
            <span className="bg-black/60 px-2 py-0.5 rounded text-blue-300 text-caption">
              Live
            </span>
          </div>

          {/* AI Bounding Boxes Overlays */}
          {showDetections &&
            detectedBoxes.map((box) => {
              const isCritical = box.status === 'critical';
              const isWarning = box.status === 'warning';
              const isMisplaced = box.status === 'misplaced';

              const boxClass = isCritical
                ? 'border-2 border-dashed border-rose-500 bg-rose-500/20 animate-pulse'
                : isMisplaced
                ? 'border-2 border-amber-400 bg-amber-400/20'
                : isWarning
                ? 'border-2 border-amber-500 bg-amber-500/15'
                : 'border-2 border-emerald-400 bg-emerald-400/15';

              const badgeColor = isCritical
                ? 'bg-rose-600 text-white'
                : isMisplaced
                ? 'bg-amber-600 text-white'
                : isWarning
                ? 'bg-amber-500 text-white'
                : 'bg-emerald-600 text-white';

              return (
                <div
                  key={box.id}
                  className={`absolute rounded transition-all duration-300 pointer-events-none ${boxClass}`}
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.w}%`,
                    height: `${box.h}%`,
                  }}
                >
                  <div
                    className={`absolute -top-5 ${box.x > 50 ? "right-0" : "left-0"} max-w-[14rem] truncate px-1.5 py-0.2 rounded text-caption font-mono font-semibold tracking-tight whitespace-nowrap shadow-sm flex items-center gap-1 ${badgeColor}`}
                  >
                    <span>{box.label}</span>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Video Telemetry Footer */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Shelf fill: <strong>78.4%</strong></span>
            </span>
            <span className="text-slate-300">&bull;</span>
            <span className="flex items-center gap-1.5 text-rose-600 font-semibold">
              <PackageX className="w-3.5 h-3.5" />
              <span>Shelf B2 is empty</span>
            </span>
          </div>

        </div>
      </Card>

      {/* Fullscreen Modal Reuse */}
      {isFullscreen && activeCamera && (
        <CameraFullscreenModal
          feed={activeCamera}
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          showDetections={showDetections}
          onToggleDetections={() => setShowDetections(!showDetections)}
        />
      )}
    </>
  );
};
