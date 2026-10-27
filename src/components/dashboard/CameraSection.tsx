import React from 'react';
import { Camera, Activity } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { CameraFeedCard } from './CameraFeedCard';
import { Badge } from '../common/Badge';
import { Skeleton } from '../common/Skeleton';
import { liveCamerasEnabled, matchLiveCamera, useLiveCameras } from '../../services/liveCameraService';

export const CameraSection: React.FC = () => {
  const { overviewData, isLoading, connection, selectedStoreId } = useStore();
  const liveSnap = useLiveCameras(selectedStoreId);

  if (isLoading || !overviewData) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const cameras = overviewData.cameras;
  const liveCount = liveCamerasEnabled ? liveSnap.cameras.filter((c) => c.status === 'live').length : cameras.length;

  return (
    <section className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-blue-600" />
            Live Cameras
          </h3>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-semibold border ${liveCamerasEnabled && liveCount === 0 ? "bg-slate-50 text-slate-600 border-slate-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${liveCamerasEnabled && liveCount === 0 ? "bg-slate-400" : "bg-emerald-500 animate-pulse"}`} />
            {liveCamerasEnabled ? `${liveCount} Live` : '4 Live Feeds'}
          </span>
        </div>

        <span className="text-caption font-mono text-slate-400">
          
        </span>
      </div>

      {/* All 4 Cameras in a Single Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {cameras.map((feed) => (
          <CameraFeedCard
            key={feed.id}
            feed={feed}
            liveMode={liveCamerasEnabled}
            live={liveCamerasEnabled ? matchLiveCamera(liveSnap.cameras, feed) : undefined}
          />
        ))}
      </div>

    </section>
  );
};
