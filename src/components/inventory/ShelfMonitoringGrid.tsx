import { fmt, signed, barPct, isNum } from '../../utils/display';
import React from 'react';
import {
  Boxes,
  Video,
  AlertTriangle,
  Clock,
  Eye,
  CheckCircle2,
  PackageX,
  Layers,
  ArrowRight,
} from 'lucide-react';
import type { ShelfDetail } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';

interface ShelfMonitoringGridProps {
  shelves: ShelfDetail[];
  selectedShelfId: string | null;
  onSelectShelf: (shelfId: string) => void;
  onInspectShelfModal: (shelf: ShelfDetail) => void;
  onSelectCamera: (camId: string) => void;
}

export const ShelfMonitoringGrid: React.FC<ShelfMonitoringGridProps> = ({
  shelves,
  selectedShelfId,
  onSelectShelf,
  onInspectShelfModal,
  onSelectCamera,
}) => {
  const getConditionBadge = (condition: string) => {
    switch (condition) {
      case 'out_of_stock':
        return (
          <Badge variant="error" size="sm" dot>
            Out of Stock
          </Badge>
        );
      case 'low_stock':
        return (
          <Badge variant="warning" size="sm" dot>
            Low Stock
          </Badge>
        );
      case 'uncertain':
        return (
          <Badge variant="warning" size="sm" dot>
            Uncertain
          </Badge>
        );
      case 'camera_offline':
        return (
          <Badge variant="slate" size="sm" dot>
            Camera Offline
          </Badge>
        );
      default:
        return (
          <Badge variant="success" size="sm" dot>
            In Stock
          </Badge>
        );
    }
  };

  const getProgressBarColor = (condition: string, pct: number) => {
    if (condition === 'out_of_stock' || pct === 0) return 'bg-rose-500';
    if (condition === 'low_stock' || pct < 30) return 'bg-amber-500';
    if (pct < 60) return 'bg-blue-500';
    return 'bg-emerald-500';
  };

  return (
    <Card className="flex flex-col border-slate-200 shadow-card h-full">
      <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-blue-600" />
              Shelves
            </CardTitle>
            <Badge variant="primary" size="sm" className="font-semibold">
              {shelves.length} Shelves
            </Badge>
          </div>
          <CardDescription>
            Fill level and layout match
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="p-3 flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 content-start">
          {shelves.map((shelf) => {
            const isSelected = selectedShelfId === shelf.id;
            const isCritical = shelf.condition === 'out_of_stock';
            const isLow = shelf.condition === 'low_stock';

            return (
              <div
                key={shelf.id}
                onClick={() => onSelectShelf(shelf.id)}
                className={`px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-blue-50/50 border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
                    : isCritical
                    ? 'bg-rose-50/20 border-rose-200 hover:border-rose-300'
                    : isLow
                    ? 'bg-amber-50/15 border-amber-200 hover:border-amber-300'
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs hover:shadow-xs'
                }`}
              >
                {/* Header: Shelf Code & Status Badge */}
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                      {shelf.shelfCode}
                    </span>
                    <span className="text-caption text-slate-400">{shelf.tierCount} tiers</span>
                  </div>
                  {getConditionBadge(shelf.condition)}
                </div>

                {/* Shelf title & location */}
                <h4 className="mt-1.5 text-xs font-semibold text-slate-900 leading-snug line-clamp-1">{shelf.category}</h4>

                {/* Stock level */}
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${getProgressBarColor(
                        shelf.condition,
                        shelf.availabilityPercentage ?? 0
                      )}`}
                      style={{ width: `${barPct(shelf.availabilityPercentage)}%` }}
                    />
                  </div>
                  <span className="shrink-0 font-mono text-caption font-semibold text-slate-900">
                    {shelf.detectedVisibleUnits}/{shelf.expectedVisibleUnits} · {shelf.availabilityPercentage}%
                  </span>
                </div>

                {/* Footer: layout match, camera, time, inspect */}
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-caption text-slate-400">
                  <span className="whitespace-nowrap">Layout {shelf.planogramCompliancePct}% · Cap {shelf.capacityUnits}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCamera(shelf.associatedCameraId);
                      }}
                      className="inline-flex items-center gap-1 font-mono text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                      title="Filter live stream for this camera"
                    >
                      <Video className="w-3 h-3 shrink-0" />
                      {shelf.associatedCameraId}
                    </button>
                    <span className="hidden 2xl:inline whitespace-nowrap">{shelf.lastObservation}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspectShelfModal(shelf);
                      }}
                      className="p-1 rounded bg-slate-100 hover:bg-blue-50 text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                      title="Inspect shelf details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Latest stored observations</span>
        </span>
        <span className="text-caption font-mono text-slate-400">
          Refreshes on server events
        </span>
      </div>
    </Card>
  );
};
