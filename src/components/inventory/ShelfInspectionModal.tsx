import React from 'react';
import {
  Boxes,
  Video,
  AlertTriangle,
  Clock,
  Layers,
  Plus,
  PackageCheck,
  PackageX,
} from 'lucide-react';
import type { ShelfDetail, Product } from '../../types/retail';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface ShelfInspectionModalProps {
  shelf: ShelfDetail | null;
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onCreateTask: (shelf: ShelfDetail) => void;
}

export const ShelfInspectionModal: React.FC<ShelfInspectionModalProps> = ({
  shelf,
  isOpen,
  onClose,
  products,
  onCreateTask,
}) => {
  if (!isOpen || !shelf) return null;

  const associatedProducts = products.filter((p) => p.shelfId === shelf.id);
  const isCritical = shelf.condition === 'out_of_stock';
  const isLow = shelf.condition === 'low_stock';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${shelf.shelfCode} — Shelf Diagnostic Inspection`}
      description={`Location: ${shelf.aisleLocation} • Department: ${shelf.department}`}
      size="lg"
    >
      <div className="p-6 space-y-5">
        {/* Top Status Banner */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs font-semibold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded">
                {shelf.shelfCode}
              </span>
              <span className="text-xs font-semibold text-slate-800">{shelf.category}</span>
            </div>
            <p className="text-xs text-slate-500 font-mono">
              Monitored by {shelf.associatedCameraName} &bull; {shelf.tierCount} Vertical Tiers
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold text-slate-500 block">Shelf Fill Rate</span>
            <span className={`text-xl font-semibold ${isCritical ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
              {shelf.availabilityPercentage}% ({shelf.detectedVisibleUnits} / {shelf.expectedVisibleUnits} units)
            </span>
          </div>
        </div>

        {/* Diagnostic Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-white rounded-xl border border-slate-200">
            <span className="text-caption text-slate-400 font-semibold uppercase">Expected Units</span>
            <p className="text-base font-semibold text-slate-900 mt-0.5">{shelf.expectedVisibleUnits}</p>
          </div>
          <div className="p-3 bg-white rounded-xl border border-slate-200">
            <span className="text-caption text-slate-400 font-semibold uppercase">Detected Visible</span>
            <p className={`text-base font-semibold mt-0.5 ${isCritical ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}`}>
              {shelf.detectedVisibleUnits}
            </p>
          </div>
          <div className="p-3 bg-white rounded-xl border border-slate-200">
            <span className="text-caption text-slate-400 font-semibold uppercase">Planogram Score</span>
            <p className="text-base font-semibold text-blue-600 mt-0.5">{shelf.planogramCompliancePct}%</p>
          </div>
          <div className="p-3 bg-white rounded-xl border border-slate-200">
            <span className="text-caption text-slate-400 font-semibold uppercase">Last CV Scan</span>
            <p className="text-xs font-semibold text-slate-700 mt-1">{shelf.lastObservation}</p>
          </div>
        </div>

        {/* Assigned SKUs on Shelf */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Products on this shelf
          </h4>
          <div className="space-y-2">
            {associatedProducts.length === 0 ? (
              <p className="text-xs text-slate-400 p-3 bg-slate-50 rounded-lg">No SKUs mapped</p>
            ) : (
              associatedProducts.map((p) => (
                <div key={p.id} className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">{p.name}</p>
                    <p className="text-caption text-slate-400 font-mono">
                      {p.sku} &bull; Visible: <strong>{p.detectedVisibleQty}/{p.expectedVisibleQty}</strong> &bull; Back Stockroom: <strong>{p.stockroomQty} units</strong>
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-caption font-semibold ${
                    p.status === 'out_of_stock' ? 'bg-rose-50 text-rose-700 border border-rose-200' : p.status === 'low_stock' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    {p.availabilityPct}%
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onClose();
              onCreateTask(shelf);
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Create restock task
          </Button>
        </div>
      </div>
    </Modal>
  );
};
