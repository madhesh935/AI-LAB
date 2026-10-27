import React, { useState } from 'react';
import {
  X,
  Send,
  User,
  Clock,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  ClipboardList,
} from 'lucide-react';
import type { OperationalInsight, PriorityLevel } from '../../types/retail';
import { apiService } from '../../services/apiService';
import { useStore } from '../../context/StoreContext';
import type { StoreStaff } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface AssignStaffTaskModalProps {
  insight: OperationalInsight | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (taskData: {
    insightId: string;
    staffId: string;
    staffName: string;
    taskTitle: string;
    priority: PriorityLevel;
    dueMinutes: number;
    notes: string;
  }) => Promise<void>;
}

export const AssignStaffTaskModal: React.FC<AssignStaffTaskModalProps> = ({
  insight,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { selectedStoreId } = useStore();
  // The employees of THIS store (REAL: from the backend roster; DEMO: fixtures).
  const [staffList, setStaffList] = useState<StoreStaff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  React.useEffect(() => {
    if (!isOpen || !selectedStoreId) return;
    let live = true;
    apiService
      .fetchStoreStaff(selectedStoreId)
      .then((list) => {
        if (!live) return;
        setStaffList(list);
        setSelectedStaffId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id ?? ''));
      })
      .catch(() => live && setStaffList([]));
    return () => {
      live = false;
    };
  }, [isOpen, selectedStoreId]);
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [priority, setPriority] = useState<PriorityLevel>('medium');
  const [dueMinutes, setDueMinutes] = useState<number>(30);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sync state when insight opens
  React.useEffect(() => {
    if (insight) {
      setTaskTitle(insight.recommendedAction);
      const mappedPriority: PriorityLevel =
        insight.severity === 'critical'
          ? 'critical'
          : insight.severity === 'warning'
          ? 'high'
          : 'medium';
      setPriority(mappedPriority);
      setNotes(`Automated dispatch generated from Insight ${insight.code} in ${insight.zone}.`);
    }
  }, [insight]);

  if (!isOpen || !insight) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId || !taskTitle.trim()) return;

    const staff = staffList.find((s) => s.id === selectedStaffId);
    setIsSubmitting(true);
    try {
      await onSubmit({
        insightId: insight.id,
        staffId: selectedStaffId,
        staffName: staff ? staff.name : 'Store Associate',
        taskTitle: taskTitle.trim(),
        priority,
        dueMinutes,
        notes: notes.trim(),
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Dispatch Floor Staff Task</h2>
              
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
          {/* Linked Insight Reference Box */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs">
            <div className="flex items-center justify-between text-caption text-blue-900 mb-1">
              <span className="font-mono font-semibold">{insight.code}</span>
              <div className="flex items-center gap-1 text-slate-600">
                <MapPin className="h-3 w-3 text-blue-600" />
                <span>{insight.zone}</span>
              </div>
            </div>
            <p className="font-semibold text-blue-950 text-xs">{insight.title}</p>
          </div>

          {/* Task Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Task title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Open checkout counter 3 or replenish shelf B2"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Assign to */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Assign to <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
              {staffList.map((staff) => {
                const isSelected = selectedStaffId === staff.id;
                return (
                  <button
                    key={staff.id}
                    type="button"
                    onClick={() => setSelectedStaffId(staff.id)}
                    className={`flex items-center justify-between rounded-xl border p-2.5 text-left transition-all ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/40 text-blue-900 ring-1 ring-blue-600'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 font-semibold text-xs">
                        {staff.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-900">{staff.name}</div>
                        <div className="text-caption text-slate-500">{staff.role} • {staff.activeTasksCount} active tasks</div>
                      </div>
                    </div>
                    <Badge
                      variant={staff.status === 'available' ? 'success' : staff.status === 'busy' ? 'warning' : 'slate'}
                      size="sm"
                      className="text-caption capitalize"
                    >
                      {staff.status.replace('_', ' ')}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority & Due In Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="critical">Critical (Immediate)</option>
                <option value="high">High (&lt; 15 mins)</option>
                <option value="medium">Medium (&lt; 30 mins)</option>
                <option value="low">Low (&lt; 60 mins)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                SLA Due Time
              </label>
              <select
                value={dueMinutes}
                onChange={(e) => setDueMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
          </div>

          {/* Additional Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Instructions
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add specific instructions for the floor associate..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
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
              className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Clock className="h-3.5 w-3.5 animate-spin" />
                  <span>Dispatching...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Confirm & Dispatch Task</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
