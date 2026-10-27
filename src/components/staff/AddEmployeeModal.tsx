import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  User,
  Mail,
  Phone,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type {
  StaffEmployee,
  EmployeeRole,
  DepartmentName,
  StaffAvailabilityStatus,
} from '../../types/retail';
import { Button } from '../common/Button';

interface AddEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (employee: Partial<StaffEmployee>) => void;
  initialEmployee?: StaffEmployee | null;
  storeId: string;
}

const ROLES: { value: EmployeeRole; label: string }[] = [
  { value: 'cashier', label: 'Checkout Cashier' },
  { value: 'inventory_associate', label: 'Inventory Associate' },
  { value: 'shelf_replenishment', label: 'Shelf Replenishment Specialist' },
  { value: 'floor_supervisor', label: 'Floor Supervisor' },
  { value: 'store_manager', label: 'Store Manager' },
  { value: 'customer_support', label: 'Customer Support Representative' },
  { value: 'security', label: 'Security & Loss Prevention' },
];

const DEPARTMENTS: DepartmentName[] = [
  'Checkout & Cashier',
  'Inventory & Stockroom',
  'Bakery & Fresh',
  'Produce & Dairy',
  'Customer Support',
  'Security & Loss Prevention',
  'Management',
];

const SHIFT_OPTIONS = [
  'Morning (08:00 – 16:00)',
  'Afternoon (12:00 – 20:00)',
  'Evening (16:00 – 23:00)',
  'Overnight Restock (23:00 – 07:00)',
];

export const AddEmployeeModal: React.FC<AddEmployeeModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialEmployee,
  storeId,
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState<EmployeeRole>('cashier');
  const [department, setDepartment] = useState<DepartmentName>('Checkout & Cashier');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currentShiftLabel, setCurrentShiftLabel] = useState(SHIFT_OPTIONS[0]);
  const [availability, setAvailability] = useState<StaffAvailabilityStatus>('available');
  const [assignedZone, setAssignedZone] = useState('Front Checkout Counters');
  const [skills, setSkills] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialEmployee) {
      setName(initialEmployee.name);
      setRole(initialEmployee.role);
      setDepartment(initialEmployee.department);
      setEmail(initialEmployee.email);
      setPhone(initialEmployee.phone);
      setCurrentShiftLabel(initialEmployee.currentShiftLabel || SHIFT_OPTIONS[0]);
      setAvailability(initialEmployee.availability);
      setAssignedZone(initialEmployee.assignedZone || 'Main Retail Floor');
      setSkills(initialEmployee.skills?.join(', ') || '');
    } else {
      setName('');
      setRole('cashier');
      setDepartment('Checkout & Cashier');
      setEmail('');
      setPhone('');
      setCurrentShiftLabel(SHIFT_OPTIONS[0]);
      setAvailability('available');
      setAssignedZone('Front Checkout Counters');
      setSkills('');
    }
    setErrors({});
  }, [initialEmployee, isOpen]);

  if (!isOpen) return null;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Full name is required';
    if (!email.trim() || !email.includes('@')) errs.email = 'Valid email address is required';
    if (!phone.trim()) errs.phone = 'Phone number is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const skillsArray = skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const roleObj = ROLES.find((r) => r.value === role);

    const employeeData: Partial<StaffEmployee> = {
      storeId,
      name: name.trim(),
      role,
      roleLabel: roleObj?.label || 'Retail Associate',
      department,
      email: email.trim(),
      phone: phone.trim(),
      currentShiftLabel,
      availability,
      assignedZone: assignedZone.trim() || 'General Sales Floor',
      skills: skillsArray.length > 0 ? skillsArray : ['Customer Service', 'Store Operations'],
      avatar:
        initialEmployee?.avatar ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&h=120&fit=crop&crop=face',
      ...(initialEmployee?.id ? { id: initialEmployee.id } : {}),
    };

    onSave(employeeData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {initialEmployee ? 'Edit Staff Member' : 'Add New Staff Member'}
              </h2>
              <p className="text-xs text-slate-500">
                {initialEmployee
                  ? `Update employee profile for ${initialEmployee.name}`
                  : 'Roster a new employee to this store location'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Full Name *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Arvind Mehta"
                className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 ${
                  errors.name
                    ? 'border-red-300 focus:ring-red-400'
                    : 'border-slate-200 focus:ring-blue-500'
                }`}
              />
            </div>
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          {/* Role & Department */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Staff Role
              </label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as EmployeeRole)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Department
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as DepartmentName)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Email *
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@retailedge.ai"
                  className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 ${
                    errors.email
                      ? 'border-red-300 focus:ring-red-400'
                      : 'border-slate-200 focus:ring-blue-500'
                  }`}
                />
              </div>
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Phone *
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 ${
                    errors.phone
                      ? 'border-red-300 focus:ring-red-400'
                      : 'border-slate-200 focus:ring-blue-500'
                  }`}
                />
              </div>
              {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
            </div>
          </div>

          {/* Assigned Shift & Zone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Assigned Shift
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <select
                  value={currentShiftLabel}
                  onChange={(e) => setCurrentShiftLabel(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {SHIFT_OPTIONS.map((sh) => (
                    <option key={sh} value={sh}>
                      {sh}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Assigned Zone
              </label>
              <input
                type="text"
                value={assignedZone}
                onChange={(e) => setAssignedZone(e.target.value)}
                placeholder="e.g. Front Checkout Counter 1-4"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Initial Status */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Status
            </label>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value as StaffAvailabilityStatus)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="available">Available for dispatch</option>
              <option value="busy">Busy on task</option>
              <option value="on_break">On scheduled break</option>
              <option value="off_duty">Off duty</option>
              <option value="on_leave">On leave</option>
            </select>
          </div>

          {/* Skills / Certifications */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Skills (comma separated)
            </label>
            <input
              type="text"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="e.g. POS Operations, Sourdough Baking, First Aid"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-caption text-slate-400 mt-1">
              Used to match staff to tasks.
            </p>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              {initialEmployee ? 'Save Changes' : 'Create Employee Profile'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
