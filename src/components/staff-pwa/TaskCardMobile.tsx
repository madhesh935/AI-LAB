import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  MapPin,
  ChevronRight,
  Boxes,
  Users,
  AlertTriangle,
  CheckCircle2,
  Play,
  ArrowRight,
  ShieldAlert,
  Tag,
} from 'lucide-react';
import type { StaffTaskExtended, StaffTaskCategory, PriorityLevel } from '../../types/retail';

interface TaskCardMobileProps {
  task: StaffTaskExtended;
  onAccept?: (taskId: string) => void;
  onStart?: (taskId: string) => void;
  onComplete?: (taskId: string) => void;
}

export const TaskCardMobile: React.FC<TaskCardMobileProps> = ({
  task,
  onAccept,
  onStart,
  onComplete,
}) => {
  const navigate = useNavigate();

  const getPriorityBadge = (priority: PriorityLevel) => {
    switch (priority) {
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
            Critical
          </span>
        );
      case 'high':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            High Priority
          </span>
        );
      case 'medium':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
            Standard
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
            Routine
          </span>
        );
    }
  };

  const getCategoryTheme = (cat: StaffTaskCategory) => {
    switch (cat) {
      case 'shelf_replenishment':
        return { label: 'Shelf Restock', color: 'text-indigo-600 bg-indigo-50 border-indigo-200' };
      case 'checkout_assistance':
        return { label: 'Checkout Surge', color: 'text-rose-600 bg-rose-50 border-rose-200' };
      case 'inventory_inspection':
        return { label: 'Audit / Inspection', color: 'text-blue-600 bg-blue-50 border-blue-200' };
      case 'camera_maintenance':
        return { label: 'Sensor / Camera', color: 'text-slate-600 bg-slate-100 border-slate-200' };
      case 'customer_assistance':
        return { label: 'Customer Assist', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' };
      default:
        return { label: 'Store Operations', color: 'text-slate-600 bg-slate-100 border-slate-200' };
    }
  };

  const catTheme = getCategoryTheme(task.category);

  return (
    <div
      onClick={() => navigate(`/staff/tasks/${task.id}`)}
      className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-all cursor-pointer active:scale-[0.99] space-y-3"
    >
      {/* Top Header: Category & Priority */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${catTheme.color}`}
        >
          {catTheme.label}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-slate-400 font-semibold">{task.id}</span>
          {getPriorityBadge(task.priority)}
          {task.syncState === 'pending' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full" title="Saved on this phone, not confirmed by the server yet">
              Pending sync
            </span>
          )}
        </div>
      </div>

      {/* Title & Description */}
      <div>
        <h3 className="text-sm font-bold text-slate-900 leading-snug line-clamp-2">
          {task.title}
        </h3>
        <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">
          {task.description}
        </p>
      </div>

      {/* Meta location and due countdown */}
      <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 gap-2">
        <div className="flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="font-medium text-slate-700">{task.zone}</span>
          {task.relatedEntity && (
            <span className="font-mono text-[11px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-100">
              {task.relatedEntity.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
          <Clock className="h-3 w-3 text-slate-400" />
          <span>Due: {task.dueTime}</span>
        </div>
      </div>

      {/* Bottom Action Footer */}
      <div
        className="pt-2 flex items-center justify-between"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
              task.status === 'completed'
                ? 'bg-emerald-100 text-emerald-800'
                : task.status === 'in_progress'
                ? 'bg-amber-100 text-amber-800'
                : task.status === 'assigned'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-purple-100 text-purple-800'
            }`}
          >
            {task.status === 'completed' && <CheckCircle2 className="h-3 w-3" />}
            {task.status.replace('_', ' ')}
          </span>
        </div>

        {/* Quick inline transition button */}
        <div className="flex items-center gap-2">
          {task.status === 'new' && onAccept && (
            <button
              onClick={() => onAccept(task.id)}
              className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1"
            >
              <span>Accept</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          )}

          {task.status === 'assigned' && onStart && (
            <button
              onClick={() => onStart(task.id)}
              className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 px-3 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Start</span>
            </button>
          )}

          {task.status === 'in_progress' && onComplete && (
            <button
              onClick={() => onComplete(task.id)}
              className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1"
            >
              <CheckCircle2 className="h-3 w-3" />
              <span>Complete</span>
            </button>
          )}

          {task.status === 'completed' && (
            <button
              onClick={() => navigate(`/staff/tasks/${task.id}`)}
              className="text-xs font-semibold text-slate-500 hover:text-blue-600 flex items-center gap-0.5 py-1 px-2"
            >
              <span>Details</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
