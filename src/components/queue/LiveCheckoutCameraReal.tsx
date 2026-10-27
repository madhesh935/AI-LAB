import React from 'react';
import { Camera } from 'lucide-react';
import type { CameraFeed } from '../../types/retail';
import { Card } from '../common/Card';
import { CameraFeedCard } from '../dashboard/CameraFeedCard';
import { matchLiveCamera, useLiveCameras } from '../../services/liveCameraService';
import { useStore } from '../../context/StoreContext';

interface Props {
  currentFeed: CameraFeed;
  allFeeds: CameraFeed[];
  onSelectFeed: (feedId: string) => void;
  waitingCount: number | null;
  maxWaitMinutes: number | null;
}

/** REAL-mode checkout camera: the shared live player (or an explicit Offline state) plus the measured queue figures. */
export const LiveCheckoutCameraReal: React.FC<Props> = ({ currentFeed, allFeeds, onSelectFeed, waitingCount, maxWaitMinutes }) => {
  const { selectedStoreId } = useStore();
  const liveSnap = useLiveCameras(selectedStoreId);
  return (
    <Card className="flex flex-col border-slate-200 shadow-card h-full justify-between" data-testid="checkout-camera-real">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
          <Camera className="h-4 w-4 text-blue-600" />
          Checkout camera
        </div>
        {allFeeds.length > 1 && (
          <select value={currentFeed.id} onChange={(e) => onSelectFeed(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-800">
            {allFeeds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.cameraCode} — {f.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="p-2 flex-1 flex flex-col justify-center">
        <CameraFeedCard feed={currentFeed} liveMode live={matchLiveCamera(liveSnap.cameras, currentFeed)} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3.5 py-1.5 text-xs text-slate-600">
        <span>
          People in lines: <strong>{waitingCount ?? '—'}</strong>
        </span>
        <span>
          Longest wait: <strong>{maxWaitMinutes === null ? '—' : `${maxWaitMinutes} min`}</strong>
        </span>
      </div>
    </Card>
  );
};
