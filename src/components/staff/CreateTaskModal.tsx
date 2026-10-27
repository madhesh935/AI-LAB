import React, { useState, useEffect } from 'react';
import {
  X,
  ClipboardList,
  User,
  MapPin,
  Clock,
  AlertTriangle,
  Tag,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import type {
  StaffEmployee,
  StaffTaskExtended,
  StaffTaskCategory,
  PriorityLevel,
} from '../../types/retail';
import { Button } from '../common/Button';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Omit<StaffTaskExtended, 'id' | 'createdTime'>) => void;
  employees: StaffEmployee[];
  preselectedEmployee?: StaffEmployee | null;
  storeId: string;
}

const CATEGORIES: { label: string; value: StaffTaskCategory }[] = [
  { label: 'Shelf Replenishment', value: 'shelf_replenishment' },
  { label: 'Checkout Assistance', value: 'checkout_assistance' },
  { label: 'Inventory Inspection', value: 'inventory_inspection' },
  { label: 'Customer Assistance', value: 'customer_assistance' },
  { label: 'Camera / Sensor Maintenance', value: 'camera_maintenance' },
  { label: 'General Store Operations', value: 'general_operations' },
];

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  onSave,
  employees,
  preselectedEmployee,
  storeId,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<StaffTaskCategory>('shelf_replenishment');
  const [priority, setPriority] = useState<PriorityLevel>('medium');
  const [assignedEmployeeId, setAssignedEmployeeId] = useState<string>('');
  const [zone, setZone] = useState('Aisle 3 - Bakery');
  const [dueTime, setDueTime] = useState('Within 45 mins');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (preselectedEmployee) {
      setAssignedEmployeeId(preselectedEmployee.id);
    } else {
      setAssignedEmployeeId('');
    }
  }, [preselectedEmployee, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const assignedStaff = employees.find((e) => e.id === assignedEmployeeId);

    onSave({
      storeId,
      title: title.trim(),
      description: description.trim() || 'Operational task assigned by store manager.',
      category,
      priority,
      status: assignedStaff ? 'assigned' : 'new',
      assignedEmployeeId: assignedStaff?.id,
      assignedEmployeeName: assignedStaff?.name,
      assignedEmployeeRole: assignedStaff?.roleLabel,
      zone: zone.trim() || 'General Sales Floor',
      dueTime: dueTime.trim() || 'Within 1 hour',
      notes: notes.trim() || undefined,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Create Workforce Task</h2>
              
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Task Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Replenish Bakery Rack B2 - Sourdough Loaf"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Category & Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Task Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as StaffTaskCategory)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low (Routine)</option>
                <option value="medium">Medium (Standard)</option>
                <option value="high">High (Attention Required)</option>
                <option value="critical">Critical (Immediate Action)</option>
              </select>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Assign to
            </label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <select
                value={assignedEmployeeId}
                onChange={(e) => setAssignedEmployeeId(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Unassigned (Add to Task Queue) --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.roleLabel} - {emp.availability.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Zone & Due Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Location
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  placeholder="e.g. Aisle 4 - Dairy"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Due time
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  placeholder="e.g. 15 mins, 12:30 PM"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Instructions
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide specific directions for staff execution..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Dispatch Task
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
