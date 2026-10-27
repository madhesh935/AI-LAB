import React, { useState, useMemo } from 'react';
import {
  ClipboardList,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  Kanban,
  Table as TableIcon,
  Search,
  Filter,
  Check,
  RotateCw,
  MapPin,
  Tag,
  User,
} from 'lucide-react';
import type { StaffTaskExtended, StaffTaskStatus, StaffTaskCategory, PriorityLevel, StaffEmployee } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface TaskManagementTabProps {
  tasks: StaffTaskExtended[];
  employees: StaffEmployee[];
  onOpenCreateTask: () => void;
  onUpdateTaskStatus: (taskId: string, status: StaffTaskStatus) => void;
  onAssignTask: (task: StaffTaskExtended) => void;
}

export const TaskManagementTab: React.FC<TaskManagementTabProps> = ({
  tasks,
  employees,
  onOpenCreateTask,
  onUpdateTaskStatus,
  onAssignTask,
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('kanban');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mTitle = t.title.toLowerCase().includes(q);
        const mId = t.id.toLowerCase().includes(q);
        const mStaff = t.assignedEmployeeName?.toLowerCase().includes(q);
        const mZone = t.zone.toLowerCase().includes(q);
        if (!mTitle && !mId && !mStaff && !mZone) return false;
      }
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, searchQuery, categoryFilter, priorityFilter]);

  const kanbanColumns: Array<{ status: StaffTaskStatus; label: string; color: string }> = [
    { status: 'new', label: 'New Tickets', color: 'border-t-purple-500' },
    { status: 'assigned', label: 'Assigned', color: 'border-t-blue-500' },
    { status: 'in_progress', label: 'In Progress', color: 'border-t-amber-500' },
    { status: 'completed', label: 'Completed', color: 'border-t-emerald-500' },
  ];

  const getCategoryTheme = (cat: StaffTaskCategory) => {
    switch (cat) {
      case 'shelf_replenishment':
        return { label: 'Shelf Replenish', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      case 'checkout_assistance':
        return { label: 'Checkout Assist', badge: 'bg-rose-50 text-rose-700 border-rose-200' };
      case 'inventory_inspection':
        return { label: 'Inspection', badge: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'camera_maintenance':
        return { label: 'Camera Maint', badge: 'bg-slate-100 text-slate-700 border-slate-200' };
      case 'customer_assistance':
        return { label: 'Customer Care', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      default:
        return { label: 'Operations', badge: 'bg-slate-100 text-slate-700 border-slate-200' };
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Toolbar & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all ${
                viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Kanban className="h-3.5 w-3.5" />
              <span>Kanban</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all ${
                viewMode === 'table' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              <span>Table</span>
            </button>
          </div>

          {/* Search */}
          <div className="relative min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks, ID, zones..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-8 pr-3 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
          >
            <option value="all">All Categories</option>
            <option value="shelf_replenishment">Shelf Replenishment</option>
            <option value="checkout_assistance">Checkout Assistance</option>
            <option value="inventory_inspection">Inventory Inspection</option>
            <option value="camera_maintenance">Camera Maintenance</option>
            <option value="customer_assistance">Customer Assistance</option>
            <option value="general_operations">General Operations</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={onOpenCreateTask}
          className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-1.5 h-8 self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Create Task Ticket</span>
        </Button>
      </div>

      {/* 2. Kanban Board View */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {kanbanColumns.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.status);
            return (
              <div
                key={col.status}
                className={`rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-3 flex flex-col border-t-4 ${col.color}`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-900">{col.label}</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-slate-700 text-caption font-semibold">
                      {colTasks.length}
                    </span>
                  </div>
                </div>

                {/* Cards List */}
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[600px] pr-1">
                  {colTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                      No {col.label.toLowerCase()}
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const theme = getCategoryTheme(task.category);
                      const isCritical = task.priority === 'critical';
                      const isHigh = task.priority === 'high';

                      return (
                        <Card
                          key={task.id}
                          className="px-3 py-2.5 space-y-1.5 bg-white border-slate-200 shadow-2xs hover:shadow-md transition-all cursor-pointer"
                          onClick={() => onAssignTask(task)}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="font-mono text-caption font-semibold text-slate-400">{task.id}</span>
                            <div className="flex items-center gap-1">
                              <Badge
                                variant={isCritical ? 'error' : isHigh ? 'warning' : 'slate'}
                                size="sm"
                                className="text-caption uppercase font-semibold"
                              >
                                {task.priority}
                              </Badge>
                              <Badge variant="slate" size="sm" className={`text-caption font-semibold ${theme.badge}`}>
                                {theme.label}
                              </Badge>
                            </div>
                          </div>

                          <h4 className="text-xs font-semibold text-slate-900 leading-snug">
                            {task.title}
                          </h4>

                          <p className="text-caption text-slate-500 line-clamp-1 leading-snug">
                            {task.description}
                          </p>

                          <div className="flex items-center justify-between text-caption text-slate-500">
                            <div className="flex items-center gap-1 text-slate-600 line-clamp-2 break-words max-w-[120px]">
                              <MapPin className="h-3 w-3 text-blue-600 shrink-0" />
                              <span className="line-clamp-2 break-words">{task.zone}</span>
                            </div>
                            <div className="flex items-center gap-1 text-slate-500 font-mono">
                              <Clock className="h-3 w-3" />
                              <span>Due: {task.dueTime}</span>
                            </div>
                          </div>

                          {/* Assignment Pill & Fast Advance */}
                          <div className="flex items-center justify-between pt-1 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-semibold text-caption">
                                {task.assignedEmployeeName ? task.assignedEmployeeName.charAt(0) : '?'}
                              </div>
                              <span className="text-caption font-semibold text-slate-700 line-clamp-2 break-words max-w-[90px]">
                                {task.assignedEmployeeName || 'Unassigned'}
                              </span>
                            </div>

                            {/* Status Progression Controls */}
                            <div className="flex items-center gap-1">
                              {task.status === 'new' && (
                                <button
                                  onClick={() => onAssignTask(task)}
                                  className="text-caption font-semibold text-blue-600 hover:underline"
                                >
                                  Assign
                                </button>
                              )}
                              {task.status === 'assigned' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onUpdateTaskStatus(task.id, 'in_progress')}
                                  className="h-6 text-caption px-2 border-slate-200"
                                >
                                  Start
                                </Button>
                              )}
                              {task.status === 'in_progress' && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => onUpdateTaskStatus(task.id, 'completed')}
                                  className="h-6 text-caption px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-0.5"
                                >
                                  <Check className="h-3 w-3" />
                                  <span>Done</span>
                                </Button>
                              )}
                              {task.status === 'completed' && (
                                <span className="text-caption text-emerald-600 font-semibold flex items-center gap-0.5">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Resolved
                                </span>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Table View */}
      {viewMode === 'table' && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-caption font-semibold text-slate-600 uppercase tracking-wider">
                  <th scope="col" className="px-4 py-3">Task ID & Title</th>
                  <th scope="col" className="px-4 py-3">Category</th>
                  <th scope="col" className="px-4 py-3">Priority</th>
                  <th scope="col" className="px-4 py-3">Zone / Target</th>
                  <th scope="col" className="px-4 py-3">Assigned Staff</th>
                  <th scope="col" className="px-4 py-3">Due Time</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map((task) => {
                  const theme = getCategoryTheme(task.category);
                  return (
                    <tr key={task.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{task.title}</div>
                        <span className="font-mono text-caption text-slate-400 font-semibold">{task.id}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="slate" size="sm" className={`text-caption font-semibold ${theme.badge}`}>
                          {theme.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={task.priority === 'critical' ? 'error' : task.priority === 'high' ? 'warning' : 'slate'}
                          size="sm"
                          className="text-caption uppercase font-semibold"
                        >
                          {task.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{task.zone}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800">
                          {task.assignedEmployeeName || 'Unassigned'}
                        </span>
                        {task.assignedEmployeeRole && (
                          <div className="text-caption text-slate-400">{task.assignedEmployeeRole}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">{task.dueTime}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            task.status === 'completed'
                              ? 'success'
                              : task.status === 'in_progress'
                              ? 'warning'
                              : task.status === 'assigned'
                              ? 'primary'
                              : 'slate'
                          }
                          size="sm"
                          className="capitalize text-caption"
                        >
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {task.status !== 'completed' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onAssignTask(task)}
                              className="h-7 text-xs px-2 border-slate-200"
                            >
                              Reassign
                            </Button>
                          )}
                          {task.status === 'in_progress' && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => onUpdateTaskStatus(task.id, 'completed')}
                              className="h-7 text-xs px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                            >
                              Resolve
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
