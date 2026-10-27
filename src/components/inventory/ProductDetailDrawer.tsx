import React from 'react';
import {
  Package,
  Boxes,
  Clock,
  Plus,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  PackageX,
  X,
  Building2,
} from 'lucide-react';
import type { Product } from '../../types/retail';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface ProductDetailDrawerProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onCreateTask: (product: Product) => void;
}

export const ProductDetailDrawer: React.FC<ProductDetailDrawerProps> = ({
  product,
  isOpen,
  onClose,
  onCreateTask,
}) => {
  if (!isOpen || !product) return null;

  const isCritical = product.status === 'out_of_stock';
  const isLow = product.status === 'low_stock';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product.name}
      description={`SKU: ${product.sku} • Department: ${product.department}`}
      size="md"
    >
      <div className="p-6 space-y-4">
        {/* Availability Progress Box */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Visible Shelf Availability:</span>
            <span className={`text-base font-semibold ${isCritical ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
              {product.availabilityPct}% ({product.detectedVisibleQty} of {product.expectedVisibleQty} units)
            </span>
          </div>

          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${isCritical ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${product.availabilityPct}%` }}
            />
          </div>

          <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-600">
            <span>Unit Price: <strong>₹{product.price} / {product.unit}</strong></span>
            <span>CV Confidence: <strong>{product.confidenceScore === null ? '—' : `${Math.round(product.confidenceScore * 100)}%`}</strong></span>
          </div>
        </div>

        {/* POS / ERP Warehouse Stock Callout */}
        <div className="p-3.5 bg-blue-50/60 rounded-xl border border-blue-200/80 text-xs space-y-1.5">
          <div className="flex items-center gap-1.5 text-blue-900 font-semibold">
            <Building2 className="w-3.5 h-3.5 text-blue-600" />
            <span>POS / ERP Warehouse Reserve:</span>
            <span className="font-mono text-sm ml-auto">{product.stockroomQty} units</span>
          </div>
          <p className="text-caption text-blue-800 leading-snug">
            Shelf count is what the camera sees. The stockroom has enough to restock now.
          </p>
        </div>

        {/* Shelf Placement Details */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-white rounded-xl border border-slate-200">
            <span className="text-caption text-slate-400 font-semibold uppercase">Shelf ID</span>
            <p className="font-mono font-semibold text-slate-900 mt-0.5">{product.shelfCode}</p>
          </div>
          <div className="p-3 bg-white rounded-xl border border-slate-200">
            <span className="text-caption text-slate-400 font-semibold uppercase">Last Observation</span>
            <p className="font-semibold text-slate-900 mt-0.5">{product.lastObservation}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onClose();
              onCreateTask(product);
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
