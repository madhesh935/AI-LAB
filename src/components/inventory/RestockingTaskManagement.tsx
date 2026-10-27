import React, { useState } from 'react';
import {
  ClipboardList,
  Plus,
  CheckCircle2,
  Clock,
  User,
  AlertTriangle,
  Camera,
  Play,
  Check,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import type { ReplenishmentTask, ReplenishmentTaskStatus, StoreStaff } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface RestockingTaskManagementProps {
  tasks: ReplenishmentTask[];
  onUpdateTaskStatus: (taskId: string, status: ReplenishmentTaskStatus, cameraVerified?: boolean) => void;
  onOpenCreateTaskModal: () => void;
}

export const RestockingTaskManagement: React.FC<RestockingTaskManagementProps> = ({
  tasks,
  onUpdateTaskStatus,
  onOpenCreateTaskModal,
}) => {
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'critical' | 'completed'>('active');

  const filteredTasks = tasks.filter((task) => {
    if (filterTab === 'active') return task.status !== 'completed';
    if (filterTab === 'completed') return task.status === 'completed';
    if (filterTab === 'critical') return task.priority === 'critical';
    return true;
  });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'critical':
        return <Badge variant="error" size="sm" dot>Critical</Badge>;
      case 'high':
        return <Badge variant="warning" size="sm" dot>High</Badge>;
      case 'medium':
        return <Badge variant="primary" size="sm" dot>Medium</Badge>;
      default:
        return <Badge variant="slate" size="sm">Routine</Badge>;
    }
  };

  const getStatusBadge = (status: ReplenishmentTaskStatus) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success" size="sm" dot>Completed</Badge>;
      case 'in_progress':
        return <Badge variant="warning" size="sm" dot>In Progress</Badge>;
      case 'assigned':
        return <Badge variant="primary" size="sm" dot>Assigned</Badge>;
      default:
        return <Badge variant="slate" size="sm" dot>New</Badge>;
    }
  };

  return (
    <Card className="flex flex-col border-slate-200 xl:h-full xl:overflow-hidden">
      <CardHeader className="flex-col items-start justify-between gap-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              Restock Tasks
            </CardTitle>
          </div>
          
        </div>

        {/* Filter controls & Create task button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Filter */}
          <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            {(
              [
                { label: 'Active Tasks', val: 'active' },
                { label: 'Critical Only', val: 'critical' },
                { label: 'Completed Log', val: 'completed' },
                { label: 'All Tasks', val: 'all' },
              ] as const
            ).map((t) => (
              <button
                key={t.val}
                onClick={() => setFilterTab(t.val)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  filterTab === t.val
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <Button variant="primary" size="sm" onClick={onOpenCreateTaskModal} className="text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Task
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 p-3 flex-1 min-h-0 xl:overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">No tasks in this category</p>
            <p className="text-caption text-slate-400 mt-0.5">No restock tasks.</p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isCompleted = task.status === 'completed';
            const isCritical = task.priority === 'critical';

            return (
              <div
                key={task.id}
                className={`px-3 py-2.5 rounded-lg border transition-all ${
                  isCompleted
                    ? 'bg-slate-50/50 border-slate-200/80 opacity-75'
                    : isCritical
                    ? 'bg-rose-50/20 border-rose-200 hover:border-rose-300'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Title row */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h4 className={`min-w-0 flex-1 basis-40 text-sm font-semibold ${isCompleted ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                    {task.title}
                  </h4>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {getPriorityBadge(task.priority)}
                    {getStatusBadge(task.status)}
                  </div>
                </div>

                {/* Meta row */}
                <p className="mt-0.5 text-caption text-slate-500">
                  <span className="font-mono text-blue-600">{task.shelfCode}</span> · {task.department} · Target{' '}
                  <strong className="text-slate-700">{task.quantityToReplenish} units</strong> · Due{' '}
                  <strong className="text-slate-700">{task.dueWithin}</strong>
                </p>

                {task.notes && <p className="mt-1 text-caption italic text-slate-500">{task.notes}</p>}

                {/* Assignee + actions */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-slate-500">
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <strong className="text-slate-800">{task.assignedStaffName}</strong>
                    </span>
                    {task.cameraVerified ? (
                      <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Camera verified
                      </span>
                    ) : isCompleted ? (
                      <span className="flex items-center gap-1 text-amber-600 font-medium">
                        <Clock className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                        Waiting for camera check
                      </span>
                    ) : (
                      <span className="text-slate-400">{task.createdAt}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 ml-auto">
                    {task.status === 'assigned' || task.status === 'new' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateTaskStatus(task.id, 'in_progress')}
                        className="text-xs h-7 px-2.5 hover:bg-slate-50"
                      >
                        <Play className="w-3 h-3 mr-1 text-blue-600" />
                        Start
                      </Button>
                    ) : null}

                    {task.status === 'in_progress' ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onUpdateTaskStatus(task.id, 'completed', false)}
                        className="text-xs h-7 px-2.5 bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Complete
                      </Button>
                    ) : null}

                    {isCompleted && !task.cameraVerified ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateTaskStatus(task.id, 'completed', true)}
                        className="text-xs h-7 px-2.5 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                        title="Trigger camera re-scan to confirm replenishment"
                      >
                        <Camera className="w-3.5 h-3.5 mr-1" />
                        Verify
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>{tasks.filter((t) => t.status === 'completed').length} of {tasks.length} tasks completed</span>
        </span>
      </div>
    </Card>
  );
};
