import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Filter,
  MoreVertical,
  Clock,
  Phone,
  Mail,
  UserCheck,
  ClipboardList,
  AlertCircle,
  Eye,
  Edit2,
  UserX,
  Plus,
} from 'lucide-react';
import type { StaffEmployee, StaffAvailabilityStatus, AttendanceStatus } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface StaffDirectoryTabProps {
  employees: StaffEmployee[];
  searchQuery: string;
  departmentFilter: string;
  onSelectEmployee: (emp: StaffEmployee) => void;
  onAssignTask: (emp: StaffEmployee) => void;
  onEditEmployee: (emp: StaffEmployee) => void;
  onDeactivateEmployee: (id: string) => void;
}

export const StaffDirectoryTab: React.FC<StaffDirectoryTabProps> = ({
  employees,
  searchQuery,
  departmentFilter,
  onSelectEmployee,
  onAssignTask,
  onEditEmployee,
  onDeactivateEmployee,
}) => {
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<keyof StaffEmployee>('name');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(8);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = emp.name.toLowerCase().includes(q);
        const matchesId = emp.id.toLowerCase().includes(q);
        const matchesRole = emp.roleLabel.toLowerCase().includes(q);
        const matchesSkill = emp.skills.some((s) => s.toLowerCase().includes(q));
        if (!matchesName && !matchesId && !matchesRole && !matchesSkill) return false;
      }
      // Department
      if (departmentFilter !== 'all' && emp.department !== departmentFilter) {
        return false;
      }
      // Role
      if (roleFilter !== 'all' && emp.role !== roleFilter) {
        return false;
      }
      // Availability
      if (availabilityFilter !== 'all' && emp.availability !== availabilityFilter) {
        return false;
      }
      return true;
    });
  }, [employees, searchQuery, departmentFilter, roleFilter, availabilityFilter]);

  // Sorted
  const sortedEmployees = useMemo(() => {
    return [...filteredEmployees].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      if (valA === valB) return 0;
      if (valA === undefined) return 1;
      if (valB === undefined) return -1;
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return 0;
    });
  }, [filteredEmployees, sortField, sortAsc]);

  // Paginated
  const totalPages = Math.max(1, Math.ceil(sortedEmployees.length / pageSize));
  const paginatedEmployees = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedEmployees.slice(start, start + pageSize);
  }, [sortedEmployees, currentPage, pageSize]);

  const handleSort = (field: keyof StaffEmployee) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const getAvailabilityBadge = (status: StaffAvailabilityStatus) => {
    switch (status) {
      case 'available':
        return <Badge variant="success" size="sm" dot className="capitalize text-caption font-semibold">Available</Badge>;
      case 'busy':
        return <Badge variant="warning" size="sm" dot className="capitalize text-caption font-semibold">Busy</Badge>;
      case 'on_break':
        return <Badge variant="slate" size="sm" className="capitalize text-caption bg-purple-50 text-purple-700 border-purple-200">On Break</Badge>;
      case 'off_duty':
        return <Badge variant="slate" size="sm" className="capitalize text-caption">Off Duty</Badge>;
      case 'on_leave':
        return <Badge variant="error" size="sm" className="capitalize text-caption">On Leave</Badge>;
      default:
        return <Badge variant="slate" size="sm" className="text-caption">Unknown</Badge>;
    }
  };

  const getAttendanceBadge = (status: AttendanceStatus, checkIn?: string) => {
    switch (status) {
      case 'present':
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Present {checkIn && <span className="opacity-75 font-normal">({checkIn})</span>}
          </span>
        );
      case 'late':
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <Clock className="h-3 w-3" />
            Late {checkIn && <span className="opacity-75 font-normal">({checkIn})</span>}
          </span>
        );
      case 'scheduled':
        return (
          <span className="inline-flex items-center gap-1 text-caption font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            Scheduled PM
          </span>
        );
      case 'absent':
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
            Absent
          </span>
        );
      case 'on_leave':
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
            On Leave
          </span>
        );
      default:
        return <span className="text-slate-400 text-xs">—</span>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Table Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Availability Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>Availability:</span>
            <select
              value={availabilityFilter}
              onChange={(e) => {
                setAvailabilityFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="available">Available (Task Ready)</option>
              <option value="busy">Busy (On Active Task)</option>
              <option value="on_break">On Break</option>
              <option value="off_duty">Off Duty</option>
            </select>
          </div>

          {/* Role Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
            >
              <option value="all">All Roles</option>
              <option value="store_manager">Store Manager</option>
              <option value="floor_supervisor">Floor Supervisor</option>
              <option value="cashier">Cashier</option>
              <option value="inventory_associate">Inventory Associate</option>
              <option value="shelf_replenishment">Shelf Replenishment</option>
              <option value="customer_support">Customer Support</option>
              <option value="security">Security</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <strong>{sortedEmployees.length}</strong> matching employees
        </div>
      </div>

      {/* Employee Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-caption font-semibold text-slate-600 uppercase tracking-wider">
                <th
                  scope="col"
                  onClick={() => handleSort('name')}
                  className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  Employee
                </th>
                <th
                  scope="col"
                  onClick={() => handleSort('department')}
                  className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  Role
                </th>
                <th scope="col" className="px-4 py-3">
                  Current Shift
                </th>
                <th scope="col" className="px-4 py-3">
                  Attendance
                </th>
                <th
                  scope="col"
                  onClick={() => handleSort('availability')}
                  className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  Availability
                </th>
                <th
                  scope="col"
                  onClick={() => handleSort('activeTasksCount')}
                  className="px-4 py-3 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  Active Tasks
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="text-xs font-semibold text-slate-600">No employees found</p>
                    <p className="text-caption text-slate-400 mt-0.5">Try clearing the filters.</p>
                  </td>
                </tr>
              ) : (
                paginatedEmployees.map((emp) => {
                  const isAvailable = emp.availability === 'available';
                  return (
                    <tr
                      key={emp.id}
                      onClick={() => onSelectEmployee(emp)}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                    >
                      {/* Name & Avatar */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={emp.avatar}
                            alt={emp.name}
                            className="h-9 w-9 rounded-full object-cover border border-slate-200"
                          />
                          <div>
                            <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                              {emp.name}
                            </div>
                            <span className="font-mono text-caption text-slate-400 font-semibold">
                              {emp.id}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{emp.roleLabel}</div>
                        <div className="text-caption text-slate-500">{emp.department}</div>
                      </td>

                      {/* Current Shift */}
                      <td className="px-4 py-3">
                        <span className="text-slate-700 font-medium">
                          {emp.currentShiftLabel || 'Off Duty'}
                        </span>
                        <div className="text-caption text-slate-400 font-mono">
                          Zone: {emp.assignedZone.split('(')[0]}
                        </div>
                      </td>

                      {/* Attendance */}
                      <td className="px-4 py-3">
                        {getAttendanceBadge(emp.attendance, emp.checkInTime)}
                      </td>

                      {/* Availability */}
                      <td className="px-4 py-3">
                        {getAvailabilityBadge(emp.availability)}
                      </td>

                      {/* Active Tasks */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center font-semibold font-mono text-xs rounded-full h-6 w-6 ${
                            emp.activeTasksCount > 0
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {emp.activeTasksCount}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant={isAvailable ? 'primary' : 'outline'}
                            size="sm"
                            onClick={() => onAssignTask(emp)}
                            className={`h-7 text-xs px-2.5 font-semibold gap-1 ${
                              isAvailable
                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                : 'border-slate-200 text-slate-700'
                            }`}
                          >
                            <ClipboardList className="h-3 w-3" />
                            <span>Assign</span>
                          </Button>

                          <div className="relative">
                            <button
                              onClick={() =>
                                setOpenActionMenuId(openActionMenuId === emp.id ? null : emp.id)
                              }
                              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              title="Employee options"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>

                            {openActionMenuId === emp.id && (
                              <div className="absolute right-0 top-8 z-30 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-in fade-in duration-100 text-left">
                                <button
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    onSelectEmployee(emp);
                                  }}
                                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 font-medium"
                                >
                                  <Eye className="h-3.5 w-3.5 text-blue-600" />
                                  <span>View Profile</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    onEditEmployee(emp);
                                  }}
                                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 font-medium"
                                >
                                  <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                                  <span>Edit Profile</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    onDeactivateEmployee(emp.id);
                                  }}
                                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 font-medium"
                                >
                                  <UserX className="h-3.5 w-3.5" />
                                  <span>Deactivate Staff</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-500">
          <div>
            Showing <strong>{sortedEmployees.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</strong> to{' '}
            <strong>{Math.min(currentPage * pageSize, sortedEmployees.length)}</strong> of{' '}
            <strong>{sortedEmployees.length}</strong> employees
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-7 px-2.5 text-xs border-slate-200"
            >
              Previous
            </Button>
            <span className="font-semibold text-slate-700">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-7 px-2.5 text-xs border-slate-200"
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
