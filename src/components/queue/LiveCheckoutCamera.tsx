import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Video,
  ShieldCheck,
  AlertTriangle,
  Layers,
  Sparkles,
  Info,
  Activity,
  Users,
  CheckCircle2,
} from 'lucide-react';
import type { CameraFeed, DetectionBox } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface LiveCheckoutCameraProps {
  currentFeed: CameraFeed;
  allFeeds: CameraFeed[];
  onSelectFeed: (feedId: string) => void;
  waitingCount: number | null;
  maxWaitMinutes: number | null;
}

export const LiveCheckoutCamera: React.FC<LiveCheckoutCameraProps> = ({
  currentFeed,
  allFeeds,
  onSelectFeed,
  waitingCount,
  maxWaitMinutes,
}) => {
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [showQueueRoi, setShowQueueRoi] = useState(true);
  const [showDwellTags, setShowDwellTags] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tick, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Subtle real-time oscillation for simulation
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      if (currentTime - lastTime > 450) {
        lastTime = currentTime;
        setTick((prev) => (prev + 1) % 100);
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Draw realistic overhead checkout CCTV scene on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background: Dark retail polished floor with subtle lighting
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#090e17');
    bgGradient.addColorStop(0.5, '#121b2b');
    bgGradient.addColorStop(1, '#080d15');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Floor grid tiles (subtle perspective)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 35) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Checkout Lanes Structure (Overhead 5 POS Stations)
    const laneWidth = width * 0.17;
    const lanes = [
      { name: 'POS 1 (Express)', x: width * 0.05, status: 'open', color: '#10b981', queueLength: 2 },
      { name: 'POS 2 (Standard)', x: width * 0.24, status: 'critical', color: '#ef4444', queueLength: 6 },
      { name: 'POS 3 (Standard)', x: width * 0.43, status: 'moderate', color: '#f59e0b', queueLength: 3 },
      { name: 'SCO 4 (Self-Checkout)', x: width * 0.62, status: 'open', color: '#3b82f6', queueLength: 1 },
      { name: 'POS 5 (Backup Standby)', x: width * 0.81, status: 'standby', color: '#94a3b8', queueLength: 0 },
    ];

    lanes.forEach((lane) => {
      // Counter top & conveyor belt
      ctx.fillStyle = lane.status === 'standby' ? 'rgba(51, 65, 85, 0.4)' : 'rgba(30, 41, 59, 0.85)';
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = lane.status === 'critical' ? 2 : 1;

      // Register desk
      ctx.fillRect(lane.x, height * 0.1, laneWidth, height * 0.14);
      ctx.strokeRect(lane.x, height * 0.1, laneWidth, height * 0.14);

      // Conveyor belt
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(lane.x + 5, height * 0.24, laneWidth - 10, height * 0.08);

      // Cashier icon/station
      ctx.fillStyle = lane.status === 'standby' ? '#64748b' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(lane.x + laneWidth / 2, height * 0.06, 7, 0, Math.PI * 2);
      ctx.fill();

      // Lane identifier label on floor
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.fillStyle = lane.color;
      ctx.fillText(lane.name, lane.x + 4, height * 0.09);

      // Draw Queue ROI Polygon if enabled
      if (showQueueRoi) {
        ctx.fillStyle =
          lane.status === 'critical'
            ? 'rgba(239, 68, 68, 0.12)'
            : lane.status === 'moderate'
            ? 'rgba(245, 158, 11, 0.10)'
            : lane.status === 'open'
            ? 'rgba(16, 185, 129, 0.08)'
            : 'rgba(148, 163, 184, 0.05)';
        ctx.strokeStyle =
          lane.status === 'critical'
            ? 'rgba(239, 68, 68, 0.7)'
            : lane.status === 'moderate'
            ? 'rgba(245, 158, 11, 0.6)'
            : lane.status === 'open'
            ? 'rgba(16, 185, 129, 0.5)'
            : 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);

        // Stanchion queue corridor
        ctx.beginPath();
        ctx.moveTo(lane.x, height * 0.34);
        ctx.lineTo(lane.x + laneWidth, height * 0.34);
        ctx.lineTo(lane.x + laneWidth, height * 0.94);
        ctx.lineTo(lane.x, height * 0.94);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]); // reset dash

        // Queue Zone Badge inside ROI
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = lane.color;
        ctx.fillText(`${lane.queueLength} in line`, lane.x + 6, height * 0.92);
      }
    });

    // Draw Simulated Person Bounding Boxes
    if (showBoundingBoxes && currentFeed.currentDetection?.detections) {
      currentFeed.currentDetection.detections.forEach((box: DetectionBox, idx: number) => {
        // Slight micro-jitter to simulate real continuous tracking
        const jitterX = Math.sin(tick * 0.2 + idx * 1.5) * 1.2;
        const jitterY = Math.cos(tick * 0.25 + idx * 2) * 1.0;

        const bx = (box.x / 100) * width + jitterX;
        const by = (box.y / 100) * height + jitterY;
        const bw = (box.width / 100) * width;
        const bh = (box.height / 100) * height;

        const isCritical = box.status === 'critical' || (box.dwellSeconds && box.dwellSeconds > 300);
        const boxColor = isCritical ? '#ef4444' : box.label.includes('Express') ? '#10b981' : '#38bdf8';

        // Person silhouette dot / circle overhead
        ctx.fillStyle = boxColor;
        ctx.beginPath();
        ctx.arc(bx + bw / 2, by + bh * 0.3, 6, 0, Math.PI * 2);
        ctx.fill();

        // Bounding rectangle
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = isCritical ? 2 : 1.5;
        ctx.strokeRect(bx, by, bw, bh);

        // Corner bracket accents
        const cornerSize = 4;
        ctx.fillStyle = boxColor;
        ctx.fillRect(bx - 1, by - 1, cornerSize, 2);
        ctx.fillRect(bx - 1, by - 1, 2, cornerSize);
        ctx.fillRect(bx + bw - cornerSize + 1, by - 1, cornerSize, 2);
        ctx.fillRect(bx + bw - 1, by - 1, 2, cornerSize);

        // Detection Tag
        if (showDwellTags) {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          const tagText = box.label.replace(/\s*\(.*\)/, '');
          ctx.font = 'bold 9px Inter, sans-serif';
          const textWidth = ctx.measureText(tagText).width;
          ctx.fillRect(bx - 1, by - 14, textWidth + 8, 14);

          ctx.fillStyle = isCritical ? '#fca5a5' : '#e2e8f0';
          ctx.fillText(tagText, bx + 3, by - 4);
        }
      });
    }

    // CCTV Timestamp and Sensor HUD overlay at top left
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(8, 8, 150, 22);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, 150, 22);

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`● LIVE  ${currentFeed.cameraCode}`, 14, 23);
  }, [currentFeed, showBoundingBoxes, showQueueRoi, showDwellTags, tick, waitingCount]);

  return (
    <>
      <Card className="overflow-hidden border-slate-200 bg-white shadow-card h-full flex flex-col">
        {/* Camera Header Bar */}
        <div className="flex flex-col items-start gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Camera className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{currentFeed.name.split(' (')[0]}</h3>
                <Badge variant="primary" size="sm" className="font-mono text-caption">
                  {currentFeed.cameraCode}
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                {currentFeed.zone}
              </p>
            </div>
          </div>

          {/* Camera View Switcher and AI Overlays Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Camera Switcher Dropdown */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
              {allFeeds.map((feed) => (
                <button
                  key={feed.id}
                  onClick={() => onSelectFeed(feed.id)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                    currentFeed.id === feed.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {feed.id === 'CAM-03' ? 'Overhead' : 'Side view'}
                </button>
              ))}
            </div>

            {/* Toggle Bounding Boxes */}
            <button
              onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                showBoundingBoxes
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Toggle AI Bounding Boxes"
            >
              {showBoundingBoxes ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span>Detections</span>
            </button>

            {/* Toggle Queue ROIs */}
            <button
              onClick={() => setShowQueueRoi(!showQueueRoi)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                showQueueRoi
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Toggle Queue Zone Polygon Overlays"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Queue zones</span>
            </button>

            {/* Fullscreen Modal Trigger */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(true)}
              className="h-7 px-2 border-slate-200 text-slate-600 hover:text-slate-900"
              title="Fullscreen Preview"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Video Canvas Container */}
        <div className="relative aspect-video max-h-[285px] w-full bg-slate-950 overflow-hidden select-none">
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="h-full w-full object-cover block"
          />

          {/* Floating Live AI Analytics Card (Bottom-Left) */}
          <div className="absolute bottom-3 left-3 hidden sm:flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/85 px-3 py-2 text-white shadow-lg backdrop-blur-md">
            <div className="flex items-center gap-1.5 border-r border-white/20 pr-3">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              <span className="text-caption font-semibold uppercase tracking-wider text-emerald-400">
                Live
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <div>
                <span className="text-slate-400 text-caption block">People In Line</span>
                <span className="font-semibold text-white">{waitingCount} Shoppers</span>
              </div>
              <div className="border-l border-white/20 pl-3">
                <span className="text-slate-400 text-caption block">Max Line Wait</span>
                <span className="font-semibold text-amber-400">{maxWaitMinutes} mins</span>
              </div>
              <div className="border-l border-white/20 pl-3">
                <span className="text-slate-400 text-caption block">Vision Confidence</span>
                <span className="font-semibold text-emerald-400">96.4%</span>
              </div>
            </div>
          </div>

        </div>

      </Card>

      {/* Fullscreen Video Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-white">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-blue-400" />
              <h2 className="text-base font-semibold">{currentFeed.name}</h2>
              <Badge variant="primary" size="sm">
                Live 4K
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(false)}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 gap-1"
            >
              <Minimize2 className="h-4 w-4" />
              <span>Exit Fullscreen</span>
            </Button>
          </div>

          <div className="relative mt-4 flex-1 flex items-center justify-center bg-black rounded-lg overflow-hidden">
            <canvas
              ref={canvasRef}
              width={1600}
              height={700}
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
};
