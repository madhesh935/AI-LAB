import React from 'react';
import {
  X,
  User,
  Mail,
  Phone,
  Calendar,
  Clock,
  Briefcase,
  Building2,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  Tag,
  Coffee,
  Edit2,
  UserX,
  Send,
  Shield,
  Activity,
} from 'lucide-react';
import type { StaffEmployee, StaffTaskExtended } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface EmployeeProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  employee: StaffEmployee | null;
  tasks: StaffTaskExtended[];
  onAssignTask: (emp: StaffEmployee) => void;
  onEditEmployee: (emp: StaffEmployee) => void;
  onDeactivateEmployee: (id: string) => void;
}

export const EmployeeProfileDrawer: React.FC<EmployeeProfileDrawerProps> = ({
  isOpen,
  onClose,
  employee,
  tasks,
  onAssignTask,
  onEditEmployee,
  onDeactivateEmployee,
}) => {
  if (!isOpen || !employee) return null;

  const employeeTasks = tasks.filter((t) => t.assignedEmployeeId === employee.id);
  const activeTasks = employeeTasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const completedTasks = employeeTasks.filter((t) => t.status === 'completed');

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-base shadow-sm">
                {employee.name
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{employee.name}</h2>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono text-slate-600 font-semibold">{employee.id}</span>
                  <span>•</span>
                  <span>{employee.roleLabel}</span>
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
            {/* Status & Department Strip */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Department</span>
                <span className="text-xs font-semibold text-slate-800">{employee.department}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Live Availability</span>
                <Badge
                  variant={
                    employee.availability === 'available'
                      ? 'success'
                      : employee.availability === 'busy'
                      ? 'warning'
                      : 'slate'
                  }
                  size="sm"
                >
                  {employee.availability === 'available'
                    ? '● Available'
                    : employee.availability === 'busy'
                    ? '● Busy on Task'
                    : employee.availability.replace('_', ' ').toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Today's Attendance</span>
                <span className="text-xs font-semibold text-slate-800 capitalize">
                  {employee.attendance.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Scheduled Shift</span>
                <span className="text-xs font-mono text-slate-700">
                  {employee.currentShiftLabel || 'Standard Daytime'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Assigned Zone</span>
                <span className="text-xs font-medium text-slate-700">
                  {employee.assignedZone}
                </span>
              </div>
            </div>

            {/* Contact Details */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Contact
              </h3>
              <div className="space-y-2 text-slate-600">
                <div className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <a
                    href={`mailto:${employee.email}`}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    {employee.email}
                  </a>
                </div>
                <div className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 text-slate-400" />
                  <span className="text-xs">{employee.phone}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <span className="text-xs">Joined: {employee.joinedDate}</span>
                </div>
              </div>
            </div>

            {/* Skills & Badges */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Skills
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {employee.skills?.map((s) => (
                  <span
                    key={s}
                    className="text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-medium"
                  >
                    {s}
                  </span>
                )) || <span className="text-xs text-slate-400">No skills tagged</span>}
              </div>
            </div>

            {/* Active Assigned Tasks */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Active Tasks ({activeTasks.length})
                </h3>
                <span className="text-xs text-slate-400">
                  {completedTasks.length} Completed
                </span>
              </div>

              {activeTasks.length === 0 ? (
                <div className="p-3 rounded-lg border border-dashed border-slate-200 text-center text-xs text-slate-400">
                  No active tasks.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeTasks.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-slate-800 line-clamp-1">
                          {t.title}
                        </span>
                        <Badge
                          variant={
                            t.priority === 'critical'
                              ? 'error'
                              : t.priority === 'high'
                              ? 'warning'
                              : 'slate'
                          }
                          size="sm"
                        >
                          {t.priority}
                        </Badge>
                      </div>
                      <p className="text-caption text-slate-500 line-clamp-2">{t.description}</p>
                      <div className="flex items-center justify-between text-caption text-slate-400 pt-1">
                        <span>Zone: {t.zone}</span>
                        <span>Due: {t.dueTime}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Drawer Actions Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50/50 flex flex-col gap-2">
            <Button
              variant="primary"
              className="w-full justify-center flex items-center gap-1.5"
              onClick={() => {
                onAssignTask(employee);
                onClose();
              }}
            >
              <Send className="h-4 w-4" />
              Assign Task to {employee.name.split(' ')[0]}
            </Button>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 justify-center flex items-center gap-1.5 text-xs"
                onClick={() => {
                  onEditEmployee(employee);
                  onClose();
                }}
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit Profile
              </Button>
              <Button
                variant="outline"
                className="justify-center flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  if (confirm(`Are you sure you want to deactivate ${employee.name}?`)) {
                    onDeactivateEmployee(employee.id);
                    onClose();
                  }
                }}
              >
                <UserX className="h-3.5 w-3.5" />
                Deactivate
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
