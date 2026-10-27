import React, { useState } from 'react';
import type { CameraFeed, DetectionBox } from '../../types/retail';
import type { FrameMeta, LiveCamera } from '../../services/liveCameraService';
import { contextMetrics } from '../../services/liveCameraService';
import { LiveVideoCanvas } from './LiveVideoCanvas';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import {
  Eye,
  EyeOff,
  Minimize2,
  Video,
  Activity,
  Layers,
} from 'lucide-react';

interface CameraFullscreenModalProps {
  feed: CameraFeed | null;
  live?: LiveCamera;
  liveMode?: boolean;
  isOpen: boolean;
  onClose: () => void;
  showDetections: boolean;
  onToggleDetections: () => void;
}

const fmtMs = (v: number | null | undefined) => (v == null ? '--' : `${v.toFixed(v < 10 ? 1 : 0)} ms`);
const fmtFps = (v: number | null | undefined) => (v == null ? '--' : v.toFixed(1));

export const CameraFullscreenModal: React.FC<CameraFullscreenModalProps> = ({
  feed,
  live,
  liveMode = false,
  isOpen,
  onClose,
  showDetections,
  onToggleDetections,
}) => {
  const [selectedBox, setSelectedBox] = useState<DetectionBox | null>(null);
  const [meta, setMeta] = useState<FrameMeta | null>(null);
  const [fill, setFill] = useState(true); // fill the whole page (crops the picture edges) or fit the complete picture

  if (!isOpen || !feed) return null;

  const detections = liveMode ? [] : feed.currentDetection.detections;
  const streaming = Boolean(liveMode && live && live.status === 'live' && live.stream.available && live.stream.url);
  const liveBoxes = streaming ? meta?.overlay?.boxes ?? [] : [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full" className="fixed inset-0 z-[60] m-0 h-screen max-h-none w-screen max-w-none rounded-none border-0 flex flex-col p-0 bg-slate-950">
      <div className="flex flex-col h-full min-h-0">
      {/* Modal Top Bar */}
      <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <span className="p-1.5 rounded-lg bg-blue-600/30 text-blue-400 border border-blue-500/30">
            <Video className="w-4 h-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-white">{feed.name}</h3>
              {liveMode && live?.isDemo && (
                <Badge variant="warning" size="sm">
                  DEMO
                </Badge>
              )}
              <Badge variant={liveMode && !streaming ? 'error' : 'success'} size="sm" dot>
                {liveMode ? (streaming ? 'Live' : live?.status === 'connecting' || live?.status === 'reconnecting' ? 'Connecting' : 'Offline') : 'Live'}
              </Badge>
            </div>
            <p className="text-caption text-slate-400">{feed.cameraCode}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleDetections}
            className="bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 text-xs"
          >
            {showDetections ? <Eye className="w-3.5 h-3.5 mr-1" /> : <EyeOff className="w-3.5 h-3.5 mr-1" />}
            {showDetections ? 'Hide AI Overlays' : 'Show AI Overlays'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFill((f) => !f)}
            className="bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 text-xs"
            title={fill ? 'Show the complete picture (black bars may appear)' : 'Fill the whole page (edges of the picture are cropped)'}
          >
            {fill ? 'Fit picture' : 'Fill page'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Expanded Body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-slate-950">
        {/* Stream View Container */}
        <div className="flex-1 min-w-0 relative flex items-center justify-center bg-black">
          <div className="relative w-full h-full bg-black overflow-hidden flex items-center justify-center">
            {liveMode ? (
              streaming && live?.stream.url ? (
                <LiveVideoCanvas url={live.stream.url} showOverlay={showDetections} fit={fill ? 'cover' : 'contain'} onMeta={setMeta} />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-center p-6">
                  <p className="text-sm font-medium text-slate-300">{live ? (live.status === 'offline' || live.status === 'error' ? 'Offline' : 'Connecting') : 'Not registered'}</p>
                  <p className="text-caption text-slate-500 mt-1">{live ? live.message ?? live.stream.reason ?? '' : 'Camera service unreachable'}</p>
                </div>
              )
            ) : null}
            {/* Backdrop for the placeholder scene */}
            {!liveMode && <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-slate-900/60 to-slate-950/90 pointer-events-none" />}

            {/* Architectural perspective grid */}
            {!liveMode && <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
              <line x1="0" y1="90%" x2="50%" y2="40%" stroke="#38BDF8" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="100%" y1="90%" x2="50%" y2="40%" stroke="#38BDF8" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="20%" y1="100%" x2="50%" y2="40%" stroke="#38BDF8" strokeWidth="1" />
              <line x1="80%" y1="100%" x2="50%" y2="40%" stroke="#38BDF8" strokeWidth="1" />
              <circle cx="50%" cy="40%" r="8" fill="#38BDF8" opacity="0.3" />
            </svg>}

            {/* Feed Overlay HUD */}
            <div className="absolute top-4 left-4 z-20 flex flex-col gap-1 font-mono text-caption text-white/90 drop-shadow-md">
              <div className="flex items-center gap-2 bg-black/70 px-2.5 py-1 rounded-md backdrop-blur-xs border border-white/10">
                {(!liveMode || streaming) && <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />}
                <span className="text-red-400 font-semibold uppercase tracking-wider">{liveMode ? (streaming ? 'LIVE' : 'OFF') : 'REC'}</span>
                <span className="text-white">{feed.cameraCode}</span>
                <span className="text-slate-400">|</span>
                <span className="text-emerald-400">{liveMode ? fmtFps(meta?.inputFps ?? live?.inputFps) : feed.fps} FPS</span>
              </div>
              <span className="bg-black/60 px-2 py-0.5 rounded text-caption text-slate-300 w-fit">
                {liveMode ? `AI ${fmtMs(live?.inferenceMs)} • ${fmtFps(live?.inferenceFps)} FPS` : 'AI detection • 14 ms'}
              </span>
            </div>

            <div className="absolute bottom-4 left-4 z-20 bg-black/70 px-3 py-1.5 rounded-lg text-white font-mono text-xs border border-white/10 backdrop-blur-xs">
              Zone: <span className="text-blue-400 font-semibold">{feed.zone}</span>
            </div>

            {/* AI Bounding Boxes Overlays */}
            {!liveMode && showDetections &&
              detections.map((box) => {
                const isSelected = selectedBox?.id === box.id;
                const isCritical = box.status === 'critical';
                const isWarning = box.status === 'warning';

                const borderColor = isCritical
                  ? 'border-rose-500 bg-rose-500/15'
                  : isWarning
                  ? 'border-amber-400 bg-amber-400/15'
                  : 'border-blue-400 bg-blue-500/15';

                const badgeColor = isCritical
                  ? 'bg-rose-600 text-white'
                  : isWarning
                  ? 'bg-amber-500 text-white'
                  : 'bg-blue-600 text-white';

                return (
                  <div
                    key={box.id}
                    onClick={() => setSelectedBox(box)}
                    className={`absolute transition-all cursor-pointer border-2 rounded-md ${borderColor} ${
                      isSelected ? 'ring-2 ring-white ring-offset-2' : ''
                    }`}
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.width}%`,
                      height: `${box.height}%`,
                    }}
                  >
                    <div
                      className={`absolute -top-6 ${box.x > 50 ? "right-0" : "left-0"} max-w-[16rem] truncate px-2 py-0.5 rounded text-caption font-mono font-semibold tracking-tight whitespace-nowrap shadow-md flex items-center gap-1 ${badgeColor}`}
                    >
                      <span>{box.label}</span>
                      <span className="opacity-80">({Math.round(box.confidence * 100)}%)</span>
                    </div>

                    {box.trackingId && (
                      <div className="absolute bottom-1 right-1 bg-black/80 text-white font-mono text-caption px-1 py-0.2 rounded">
                        {box.trackingId}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right Side Telemetry Drawer in Fullscreen */}
        <div className="w-full lg:w-80 shrink-0 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 p-5 overflow-y-auto text-slate-300 flex flex-col justify-between">
          <div className="space-y-5">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2 mb-3">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                Live detections
              </h4>

              {liveMode ? (
                <div className="space-y-2.5 bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60">
                  {[
                    ['Video FPS', fmtFps(meta?.inputFps ?? live?.inputFps)],
                    ['AI FPS', fmtFps(live?.inferenceFps)],
                    ['AI latency', fmtMs(live?.inferenceMs)],
                    ...(streaming && meta?.context ? [[contextMetrics(meta.context, liveBoxes.length, null).primaryLabel, contextMetrics(meta.context, liveBoxes.length, null).primaryValue], [contextMetrics(meta.context, liveBoxes.length, null).secondaryLabel, contextMetrics(meta.context, liveBoxes.length, null).secondaryValue]] : [['People in view', streaming ? String(liveBoxes.length) : '--']]),
                    ['Resolution', live?.frameWidth && live?.frameHeight ? `${live.frameWidth}x${live.frameHeight}` : '--'],
                    ['Model', meta?.model ?? '--'],
                    [
                      'Last inference',
                      live?.lastInferenceAt ? new Date(live.lastInferenceAt).toLocaleTimeString([], { hour12: false }) : '--',
                    ],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs gap-3">
                      <span className="text-slate-400">{k}:</span>
                      <span className="font-mono font-semibold text-white truncate">{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
              <div className="space-y-2.5 bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">FPS Rate:</span>
                  <span className="font-mono text-emerald-400 font-semibold">{feed.fps ?? '--'} steady</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Total People in Frame:</span>
                  <span className="font-semibold text-white">{feed.currentDetection.peopleCount ?? '--'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Active Overlays:</span>
                  <span className="font-semibold text-blue-400">{detections.length} objects</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{feed.metrics.primaryLabel}:</span>
                  <span className="font-semibold text-white">{feed.metrics.primaryValue}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{feed.metrics.secondaryLabel}:</span>
                  <span className="font-semibold text-white">{feed.metrics.secondaryValue}</span>
                </div>
              </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2 mb-2">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                Detections
              </h4>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {liveBoxes.map((b) => (
                  <div key={b.id} className="p-2.5 rounded-lg border text-xs bg-slate-800/40 border-slate-700/60 text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Person</span>
                      <span className="font-mono text-caption text-blue-400">{Math.round(b.c * 100)}%</span>
                    </div>
                    <p className="text-caption text-slate-400 mt-1 font-mono">Track #{b.id}</p>
                  </div>
                ))}
                {liveMode && liveBoxes.length === 0 && <p className="text-caption text-slate-500">{streaming ? 'No one in view' : 'No video'}</p>}
                {detections.map((box) => (
                  <div
                    key={box.id}
                    onClick={() => setSelectedBox(box)}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      selectedBox?.id === box.id
                        ? 'bg-blue-900/40 border-blue-500 text-white'
                        : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{box.label}</span>
                      <span className="font-mono text-caption text-blue-400">
                        {Math.round(box.confidence * 100)}%
                      </span>
                    </div>
                    {box.trackingId && (
                      <p className="text-caption text-slate-400 mt-1 font-mono">
                        Tracking ID: {box.trackingId} &bull; Dwell: {box.dwellSeconds || 0}s
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
      </div>
    </Modal>
  );
};
