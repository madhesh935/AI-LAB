import React, { useState } from 'react';
import {
  X,
  UserCheck,
  Send,
  CreditCard,
  Clock,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { StoreStaff, StaffingRecommendation } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface StaffDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: StaffingRecommendation | null;
  availableStaff: StoreStaff[];
  onDispatch: (staffId: string, counterId: string, notes: string) => Promise<void>;
}

export const StaffDispatchModal: React.FC<StaffDispatchModalProps> = (props) => {
  if (!props.isOpen || !props.recommendation) return null;
  return <StaffDispatchModalBody {...props} recommendation={props.recommendation} />;
};

const StaffDispatchModalBody: React.FC<StaffDispatchModalProps & { recommendation: NonNullable<StaffDispatchModalProps['recommendation']> }> = ({
  isOpen,
  onClose,
  recommendation,
  availableStaff,
  onDispatch,
}) => {
  const [selectedStaffId, setSelectedStaffId] = useState<string>(
    recommendation.suggestedStaffId || availableStaff[0]?.id || ''
  );
  const [notes, setNotes] = useState<string>(
    `Immediate cashier dispatch for ${recommendation.targetCounterName}. Queue wait time exceeds SLA threshold.`
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedStaff = availableStaff.find((s) => s.id === selectedStaffId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onDispatch(selectedStaffId, recommendation.targetCounterId, notes);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Dispatch Floor Associate</h2>
              <p className="text-xs text-slate-500">
                Suggested action: <span className="font-semibold text-slate-700">{recommendation.title}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Target Counter */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Counter
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800">
              <CreditCard className="h-4 w-4 text-blue-600 shrink-0" />
              <span className="font-semibold">{recommendation.targetCounterName}</span>
              <Badge variant="primary" size="sm" className="ml-auto text-caption">
                {recommendation.targetCounterId.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Select Staff Member */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Assign to
            </label>
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            >
              {availableStaff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name} — {staff.role} ({staff.activeTasksCount} active tasks)
                </option>
              ))}
            </select>

            {selectedStaff && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-blue-50/70 p-2 text-xs text-blue-900">
                <span>
                  Status: <strong>{selectedStaff.status.toUpperCase()}</strong> • Qualified for POS terminal operation
                </span>
                <CheckCircle2 className="h-4 w-4 text-blue-600" />
              </div>
            )}
          </div>

          {/* Expected Outcome */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900">
            <span className="font-semibold flex items-center gap-1 text-emerald-800 mb-1">
              <Sparkles className="h-3.5 w-3.5" />
              Expected result:
            </span>
            <p>{recommendation.expectedOutcome}</p>
          </div>

          {/* Dispatch Notes */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Message to associate
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Footer Actions */}
          <div className="border-t border-slate-200 pt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
              className="border-slate-300 text-slate-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting}
              className="bg-blue-600 text-white hover:bg-blue-700 gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSubmitting ? 'Dispatching...' : 'Confirm & Dispatch Task'}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
