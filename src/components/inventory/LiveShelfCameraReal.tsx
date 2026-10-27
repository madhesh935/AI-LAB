import React from 'react';
import { Video, PackageX } from 'lucide-react';
import type { CameraFeed, ShelfDetail } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription } from '../common/Card';
import { CameraFeedCard } from '../dashboard/CameraFeedCard';
import { matchLiveCamera, useLiveCameras } from '../../services/liveCameraService';
import { useStore } from '../../context/StoreContext';
import { fmt } from '../../utils/display';

interface Props {
  cameras: CameraFeed[];
  selectedCameraId: string;
  onSelectCameraId: (id: string) => void;
  selectedShelf: ShelfDetail | null;
}

/**
 * REAL-mode shelf camera: the same player as the dashboard camera cards (real MJPEG stream + per-frame overlay), or an explicit
 * Offline / Not configured state. It never simulates detections - shelf status below comes from stored shelf observations.
 */
export const LiveShelfCameraReal: React.FC<Props> = ({ cameras, selectedCameraId, onSelectCameraId, selectedShelf }) => {
  const { selectedStoreId } = useStore();
  const liveSnap = useLiveCameras(selectedStoreId);
  const shelfCams = cameras.filter((c) => c.type === 'shelf');
  const options = shelfCams.length ? shelfCams : cameras;
  const active = options.find((c) => c.id === selectedCameraId) ?? options[0] ?? null;

  return (
    <Card className="flex flex-col border-slate-200 shadow-card xl:h-full" data-testid="shelf-camera-real">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <div>
          <CardTitle className="flex items-center gap-2 whitespace-nowrap">
            <Video className="w-4 h-4 text-blue-600" />
            Shelf Camera
          </CardTitle>
          <CardDescription>Spots empty shelf gaps when a shelf model is running.</CardDescription>
        </div>
        {options.length > 0 && (
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold shrink-0">
            <span className="text-slate-400">Feed:</span>
            <select value={active?.id ?? ''} onChange={(e) => onSelectCameraId(e.target.value)} className="bg-transparent text-slate-800 font-semibold focus:outline-none cursor-pointer">
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cameraCode} — {c.name.split('-').slice(1).join('-').trim() || c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </CardHeader>

      <div className="p-2 flex-1 flex flex-col justify-center">
        {active ? (
          <CameraFeedCard feed={active} liveMode live={matchLiveCamera(liveSnap.cameras, active)} />
        ) : (
          <p className="py-8 text-center text-xs text-slate-500">No camera is registered for this store.</p>
        )}
      </div>

      <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
        {selectedShelf ? (
          <>
            <span>
              {selectedShelf.shelfCode}: <strong>{selectedShelf.detectedVisibleUnits === null ? '—' : `${selectedShelf.detectedVisibleUnits}/${selectedShelf.capacityUnits}`}</strong> units visible ({selectedShelf.availabilityPercentage === null ? '—' : `${fmt(selectedShelf.availabilityPercentage, 1)}%`})
            </span>
            {selectedShelf.condition === 'out_of_stock' && (
              <span className="flex items-center gap-1.5 text-rose-600 font-semibold">
                <PackageX className="w-3.5 h-3.5" />
                {selectedShelf.shelfCode} is empty
              </span>
            )}
          </>
        ) : (
          <span>Select a shelf to see its last observation.</span>
        )}
      </div>
    </Card>
  );
};
