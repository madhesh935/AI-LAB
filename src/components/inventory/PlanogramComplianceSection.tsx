import React, { useState, useEffect } from 'react';
import {
  Layers,
  AlertTriangle,
  CheckCircle2,
  PackageX,
  Sparkles,
  Info,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import type { Planogram, PlanogramSlot } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';

interface PlanogramComplianceSectionProps {
  planograms: Planogram[];
  selectedShelfId?: string;
  onSelectShelfId?: (shelfId: string) => void;
  alertsSlot?: React.ReactNode;
}

export const PlanogramComplianceSection: React.FC<PlanogramComplianceSectionProps> = ({
  planograms,
  selectedShelfId,
  onSelectShelfId,
  alertsSlot,
}) => {
  const [selectedPlanogramId, setSelectedPlanogramId] = useState<string>(() => {
    if (selectedShelfId) {
      const match = planograms.find((p) => p.shelfId === selectedShelfId);
      if (match) return match.id;
    }
    return planograms[0]?.id || '';
  });
  const [selectedSlot, setSelectedSlot] = useState<PlanogramSlot | null>(null);

  // Sync active planogram if parent selectedShelfId changes
  useEffect(() => {
    if (selectedShelfId) {
      const match = planograms.find((p) => p.shelfId === selectedShelfId);
      if (match && match.id !== selectedPlanogramId) {
        setSelectedPlanogramId(match.id);
        setSelectedSlot(null);
      }
    }
  }, [selectedShelfId, planograms]);

  const activePlanogram =
    planograms.find((p) => p.id === selectedPlanogramId) || planograms[0];

  const getSlotStyle = (status: string) => {
    switch (status) {
      case 'missing':
        return 'border-2 border-dashed border-rose-500 bg-rose-50 text-rose-700 hover:bg-rose-100';
      case 'misplaced':
        return 'border-2 border-dashed border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100';
      case 'compliant':
        return 'border border-emerald-300 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100';
      default:
        return 'border border-slate-200 bg-slate-50 text-slate-700';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'missing':
        return <Badge variant="error" size="sm" dot>Missing Gap</Badge>;
      case 'misplaced':
        return <Badge variant="warning" size="sm" dot>Misplaced Item</Badge>;
      case 'compliant':
        return <Badge variant="success" size="sm" dot>Compliant</Badge>;
      default:
        return <Badge variant="slate" size="sm">Uncertain</Badge>;
    }
  };

  return (
    <Card className="flex flex-col border-slate-200 shadow-card h-full">
      <CardHeader className="flex-col items-start 2xl:flex-row 2xl:items-center justify-between gap-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              Planogram Compliance
            </CardTitle>
          </div>
          
        </div>

        {/* Shelf Selector Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">Shelf:</span>
          <select
            value={activePlanogram?.id}
            onChange={(e) => {
              const newId = e.target.value;
              setSelectedPlanogramId(newId);
              setSelectedSlot(null);
              const chosen = planograms.find((p) => p.id === newId);
              if (chosen && onSelectShelfId) {
                onSelectShelfId(chosen.shelfId);
              }
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 font-semibold text-slate-800 focus:outline-none cursor-pointer"
          >
            {planograms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.shelfCode} ({p.compliancePercentage}%)
              </option>
            ))}
          </select>
        </div>
      </CardHeader>

      {alertsSlot && <div className="flex flex-1 flex-col [&>*]:flex-1">{alertsSlot}</div>}

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
        <span className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>From the latest shelf observations.</span>
        </span>
        <span className="text-caption font-semibold text-slate-700">No sweep schedule is configured</span>
      </div>
    </Card>
  );
};
