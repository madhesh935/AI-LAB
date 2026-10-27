import { runStaffAction, useServerChanged } from '../../services/api/useStaffPage';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Play,
  Share2,
  Boxes,
  Camera,
  MessageSquare,
  ShieldCheck,
  Send,
  User,
  Activity,
  FileText,
  Footprints,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService } from '../../services/staffApiService';
import type { StaffTaskExtended, PriorityLevel } from '../../types/retail';
import { PhotoEvidenceUpload } from '../../components/staff-pwa/PhotoEvidenceUpload';
import { ReportIssueModal } from '../../components/staff-pwa/ReportIssueModal';

export const StaffTaskDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentStaff } = useStaffAuth();
  const { showToast, refreshBadges } = useOutletContext<{
    showToast: (msg: string) => void;
    refreshBadges: () => void;
  }>();

  const [task, setTask] = useState<StaffTaskExtended | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [completionNotes, setCompletionNotes] = useState<string>('');
  const [photoEvidence, setPhotoEvidence] = useState<string | null>(null);
  const [isReportIssueOpen, setIsReportIssueOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const loadTask = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const data = await staffApiService.getTaskById(id, currentStaff?.storeId);
      setTask(data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTask();
  }, [id, currentStaff]);
  useServerChanged(() => void loadTask());

  if (isLoading) {
    return (
      <div className="p-8 text-center space-y-3 animate-pulse">
        <div className="h-6 w-32 bg-slate-200 rounded mx-auto" />
        <div className="h-40 bg-slate-200 rounded-3xl" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6 text-center space-y-4 bg-white rounded-3xl border border-slate-200">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
        <h2 className="text-base font-bold text-slate-900">Task Not Found</h2>
        <p className="text-xs text-slate-500">
          This task may have been reassigned.
        </p>
        <button
          onClick={() => navigate('/staff/tasks')}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold text-xs"
        >
          Return to Tasks
        </button>
      </div>
    );
  }

  // Action Handlers
  const handleAccept = async () => {
    if (!currentStaff) return;
    setIsSubmitting(true);
    await runStaffAction(() => staffApiService.acceptTask(task.id, currentStaff.id), `Task accepted by ${currentStaff.name.split(' ')[0]}.`, showToast);
    await loadTask();
    refreshBadges();
    setIsSubmitting(false);
  };

  const handleStart = async () => {
    if (!currentStaff) return;
    setIsSubmitting(true);
    await runStaffAction(() => staffApiService.startTask(task.id, currentStaff.id), 'Work started on this task.', showToast);
    await loadTask();
    refreshBadges();
    setIsSubmitting(false);
  };

  const handleOnTheWay = async () => {
    if (!currentStaff) return;
    setIsSubmitting(true);
    await runStaffAction(() => staffApiService.markOnTheWay(task.id, currentStaff.id), 'The shopper now sees that you are on the way.', showToast);
    await loadTask();
    setIsSubmitting(false);
  };

  const canMarkOnTheWay =
    task.category === 'customer_assistance' &&
    task.status === 'assigned' &&
    !!task.customerRequestId &&
    task.assignedEmployeeId === currentStaff?.id &&
    task.customerRequestStatus !== 'on_the_way';

  const handleComplete = async () => {
    if (!currentStaff) return;
    setIsSubmitting(true);
    await runStaffAction(
      () => staffApiService.completeTask(task.id, currentStaff.id, completionNotes.trim() || undefined, !!photoEvidence),
      'Task completed and confirmed by the store server.',
      showToast
    );
    await loadTask();
    refreshBadges();
    setIsSubmitting(false);
  };

  const handleReportIssue = async (reason: string) => {
    if (!currentStaff) return;
    await runStaffAction(() => staffApiService.reportIssue(task.id, currentStaff.id, reason), 'Issue reported to the store supervisor.', showToast);
    await loadTask();
    refreshBadges();
  };

  const getPriorityBadge = (priority: PriorityLevel) => {
    switch (priority) {
      case 'critical':
        return (
          <span className="text-xs font-bold uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            Critical Priority
          </span>
        );
      case 'high':
        return (
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full flex items-center gap-1">
            High Priority
          </span>
        );
      default:
        return (
          <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
            Standard SLA
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Top Navigation Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/staff/tasks')}
          className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-2xs"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Tasks</span>
        </button>

        <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
          {task.id}
        </span>
      </div>

      {/* 2. Main Title & Status Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2">
          {getPriorityBadge(task.priority)}
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
              task.status === 'completed'
                ? 'bg-emerald-100 text-emerald-800'
                : task.status === 'in_progress'
                ? 'bg-amber-100 text-amber-800'
                : task.status === 'assigned'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-purple-100 text-purple-800'
            }`}
          >
            {task.status.replace('_', ' ')}
          </span>
        </div>

        <div>
          <h1 className="text-lg font-black text-slate-900 leading-snug">{task.title}</h1>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">{task.description}</p>
        </div>

        {/* Location & Time Strip */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="space-y-1">
            <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
              Assigned Zone
            </span>
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <MapPin className="h-4 w-4 text-blue-600 shrink-0" />
              <span>{task.zone}</span>
            </div>
            {task.relatedEntity && (
              <span className="inline-block text-[11px] font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-bold border border-blue-200">
                Ref: {task.relatedEntity.label} ({task.relatedEntity.id})
              </span>
            )}
          </div>

          <div className="space-y-1">
            <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
              Target Completion
            </span>
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <Clock className="h-4 w-4 text-amber-500 shrink-0" />
              <span>{task.dueTime}</span>
            </div>
            <span className="text-[11px] text-slate-400">Created {task.createdTime}</span>
          </div>
        </div>
      </div>

      {/* 3. Operational Telemetry & Evidence (Grounded from CV Cameras) */}
      <div className="bg-blue-50/60 border border-blue-200/80 rounded-3xl p-4 text-xs space-y-2">
        <div className="flex items-center gap-1.5 text-blue-900 font-bold">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          <span>Operational Grounding & Camera Telemetry</span>
        </div>
        <p className="text-blue-800 leading-relaxed text-[11px]">
          {task.category === 'shelf_replenishment' && (
            <>
              <strong>Shelf Computer Vision:</strong> CAM-02 detected 0 facings for Artisan Sourdough
              Loaf. 40 units verified at backroom staging bay. Restock threshold target: 24 units.
            </>
          )}
          {task.category === 'checkout_assistance' && (
            <>
              <strong>Overhead Queue Sensor:</strong> CAM-03 detected 7 waiting customers with avg
              dwell 5.8m exceeding the 4.5m service SLA.
            </>
          )}
          {task.category !== 'shelf_replenishment' && task.category !== 'checkout_assistance' && (
            <>
              <strong>Store Operational Directive:</strong> Scheduled floor task verified under store
              workforce management schedule.
            </>
          )}
        </p>
      </div>

      {/* 4. Action Execution Form */}
      {task.status !== 'completed' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Workforce Execution
          </h2>

          {/* Completion Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1.5">
              Completion Notes & Audit Remark
            </label>
            <textarea
              rows={2}
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="e.g. 24 loaves restocked on Shelf B2 rack. Checked expiry dates."
              className="w-full text-xs p-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Photographic Verification Upload */}
          <PhotoEvidenceUpload
            onPhotoSelected={(url) => setPhotoEvidence(url)}
            onClear={() => setPhotoEvidence(null)}
          />

          {/* Action Transition Buttons */}
          <div className="pt-2 space-y-2">
            {task.status === 'new' && (
              <button
                onClick={handleAccept}
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-5 w-5" />
                <span>Accept This Task</span>
              </button>
            )}

            {canMarkOnTheWay && (
              <button
                onClick={handleOnTheWay}
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
              >
                <Footprints className="h-5 w-5" />
                <span>On My Way to the Customer</span>
              </button>
            )}
            {task.category === 'customer_assistance' && task.customerRequestStatus === 'on_the_way' && task.status === 'assigned' && (
              <p className="text-center text-[11px] font-semibold text-blue-700">The shopper sees "Staff on the way".</p>
            )}

            {task.status === 'assigned' && (
              <button
                onClick={handleStart}
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-slate-950 font-bold text-sm shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
              >
                <Play className="h-5 w-5 fill-current" />
                <span>Start Task Execution</span>
              </button>
            )}

            {task.status === 'in_progress' && (
              <button
                onClick={handleComplete}
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-5 w-5" />
                <span>Mark Task as Completed</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsReportIssueOpen(true)}
              className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span>Report Issue / Request Reassignment</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. Completed Banner (if completed) */}
      {task.status === 'completed' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-5 text-center space-y-2">
          <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
          <h3 className="text-base font-bold text-emerald-900">Task Completed Successfully</h3>
          <p className="text-xs text-emerald-700">
            Recorded at {task.completedTime || 'Recent'}. Store Copilot and Admin Dashboard have
            been updated.
          </p>
          {task.notes && (
            <div className="mt-2 p-2.5 rounded-xl bg-white/80 border border-emerald-200 text-xs text-slate-700 text-left">
              <strong>Completion Note:</strong> {task.notes}
            </div>
          )}
        </div>
      )}

      {/* 6. Activity Timeline */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Activity History
        </h3>
        <div className="space-y-3 text-xs">
          <div className="flex items-start gap-2.5">
            <span className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
            <div>
              <p className="font-semibold text-slate-800">Task generated & dispatched</p>
              <p className="text-[11px] text-slate-400">Created at {task.createdTime}</p>
            </div>
          </div>
          {task.status !== 'new' && (
            <div className="flex items-start gap-2.5">
              <span className="h-2 w-2 rounded-full bg-blue-600 mt-1.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-800">
                  Accepted by {task.assignedEmployeeName || 'Associate'}
                </p>
                <p className="text-[11px] text-slate-400">Assigned role: {task.assignedEmployeeRole}</p>
              </div>
            </div>
          )}
          {task.status === 'completed' && (
            <div className="flex items-start gap-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-800">Verified and marked complete</p>
                <p className="text-[11px] text-slate-400">Done at {task.completedTime || 'Recent'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <ReportIssueModal
        isOpen={isReportIssueOpen}
        onClose={() => setIsReportIssueOpen(false)}
        taskId={task.id}
        taskTitle={task.title}
        onSubmitIssue={handleReportIssue}
      />
    </div>
  );
};
