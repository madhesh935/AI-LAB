import React, { useState } from 'react';
import { X, AlertCircle, CheckCircle, ShieldAlert } from 'lucide-react';
import type { OperationalInsight } from '../../types/retail';
import { Button } from '../common/Button';

interface DismissInsightModalProps {
  insight: OperationalInsight | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (insightId: string, reason: string) => Promise<void>;
}

export const DismissInsightModal: React.FC<DismissInsightModalProps> = ({
  insight,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [reasonCategory, setReasonCategory] = useState<string>(
    'Already fixed on the floor'
  );
  const [details, setDetails] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !insight) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const fullReason = details.trim()
        ? `${reasonCategory} — ${details.trim()}`
        : reasonCategory;
      await onConfirm(insight.id, fullReason);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Dismiss AI Recommendation</h2>
              
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="flex items-center justify-between font-mono font-semibold text-slate-500 mb-1">
              <span>{insight.code}</span>
              <span className="text-slate-400 font-sans font-normal">{insight.zone}</span>
            </div>
            <p className="font-semibold text-slate-800 text-xs">{insight.title}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason <span className="text-rose-500">*</span>
            </label>
            <select
              value={reasonCategory}
              onChange={(e) => setReasonCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="Already fixed on the floor">
                Already fixed on the floor
              </option>
              <option value="Temporary spike">
                Temporary spike
              </option>
              <option value="Camera needs calibration">
                Camera needs calibration
              </option>
              <option value="Manager operational override">
                Manager override
              </option>
              <option value="Stock unavailable">
                Stock unavailable
              </option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Note (optional)
            </label>
            <textarea
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. Associate Pooja already verified shelf manually at 14:15..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="rounded-xl bg-amber-50/70 border border-amber-200/60 p-3 text-caption text-amber-800 leading-relaxed">
            This marks the recommendation as resolved. Managers can still review it later.
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-xs font-semibold"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting}
              className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isSubmitting ? 'Submitting...' : 'Confirm Dismissal'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
