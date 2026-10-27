import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../context/StoreContext';
import {
  staffService,
  SHIFT_TIMINGS,
} from '../services/staffService';
import type {
  StaffEmployee,
  ShiftTiming,
  ShiftAssignment,
  AttendanceRecord,
  StaffTaskExtended,
  StaffingAiRecommendation,
  StaffWorkloadAnalytics,
  StaffManagementKpis,
  StaffAvailabilityStatus,
  StaffTaskStatus,
  AttendanceStatus,
} from '../types/retail';

// Subcomponents & Modals
import { StaffHeader, type StaffTabType } from '../components/staff/StaffHeader';
import { StaffKpis } from '../components/staff/StaffKpis';
import { StaffDirectoryTab } from '../components/staff/StaffDirectoryTab';
import { ShiftSchedulingTab } from '../components/staff/ShiftSchedulingTab';
import { AttendanceMonitoringTab } from '../components/staff/AttendanceMonitoringTab';
import { TaskManagementTab } from '../components/staff/TaskManagementTab';
import { AiStaffingRecommendationsTab } from '../components/staff/AiStaffingRecommendationsTab';
import { LiveAvailabilityPanel } from '../components/staff/LiveAvailabilityPanel';

import { AddEmployeeModal } from '../components/staff/AddEmployeeModal';
import { EmployeeProfileDrawer } from '../components/staff/EmployeeProfileDrawer';
import { CreateShiftModal } from '../components/staff/CreateShiftModal';
import { CreateTaskModal } from '../components/staff/CreateTaskModal';
import { AttendanceOverrideModal } from '../components/staff/AttendanceOverrideModal';
import { CheckCircle2 } from 'lucide-react';
import { BackendState } from '../components/common/BackendState';
import { isAbort } from '../services/api/client';
import { useLiveRefresh } from '../services/api/realtime';
import { IS_DEMO_MODE } from '../services/api/config';

export const StaffManagement: React.FC = () => {
  const { selectedStore, selectedStoreId } = useStore();

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<StaffTabType>('directory');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Core Data State
  const [employees, setEmployees] = useState<StaffEmployee[]>([]);
  const [shifts, setShifts] = useState<ShiftAssignment[]>([]);
  const [shiftTimings, setShiftTimings] = useState<ShiftTiming[]>(SHIFT_TIMINGS);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [tasks, setTasks] = useState<StaffTaskExtended[]>([]);
  const [recommendations, setRecommendations] = useState<StaffingAiRecommendation[]>([]);
  const [analytics, setAnalytics] = useState<StaffWorkloadAnalytics>({
    departmentLoads: [],
    hourlyCoverage: [],
    statusDistribution: [],
    dailyCompletions: [],
    employeeWorkloads: [],
  });
  const [kpis, setKpis] = useState<StaffManagementKpis>({
    totalEmployees: 0,
    onDuty: 0,
    availableStaff: 0,
    busyStaff: 0,
    pendingTasks: 0,
    attendanceRatePct: 0,
    checkedInCount: 0,
    absentCount: 0,
    onLeaveCount: 0,
  });

  // Modal / Drawer state
  const [isAddEmployeeOpen, setIsAddEmployeeOpen] = useState<boolean>(false);
  const [editingEmployee, setEditingEmployee] = useState<StaffEmployee | null>(null);

  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState<boolean>(false);
  const [selectedEmployeeForProfile, setSelectedEmployeeForProfile] = useState<StaffEmployee | null>(null);

  const [isCreateShiftOpen, setIsCreateShiftOpen] = useState<boolean>(false);

  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState<boolean>(false);
  const [preselectedEmployeeForTask, setPreselectedEmployeeForTask] = useState<StaffEmployee | null>(null);

  const [isAttendanceOverrideOpen, setIsAttendanceOverrideOpen] = useState<boolean>(false);
  const [selectedAttendanceRecord, setSelectedAttendanceRecord] = useState<AttendanceRecord | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Synchronize state from service
  const refreshLocalState = useCallback(() => {
    const emps = staffService.getEmployees(selectedStoreId);
    const shfs = staffService.getShifts(selectedStoreId);
    const atts = staffService.getAttendance(selectedStoreId);
    const tsks = staffService.getTasks(selectedStoreId);
    const recs = staffService.getRecommendations();
    const calculatedKpis = staffService.getKpis(selectedStoreId);
    const ana = staffService.getWorkloadAnalytics();

    setEmployees(emps);
    setShifts(shfs);
    setShiftTimings(SHIFT_TIMINGS);
    setAttendanceRecords(atts);
    setTasks(tsks);
    setRecommendations(recs);
    setKpis(calculatedKpis);
    setAnalytics(ana);
  }, [selectedStoreId]);

  const [loadError, setLoadError] = useState<unknown>(null);
  const [isHydrating, setIsHydrating] = useState<boolean>(!IS_DEMO_MODE);

  const hydrate = useCallback(async () => {
    try {
      await staffService.hydrate(selectedStoreId);
      setLoadError(null);
    } catch (e) {
      if (!isAbort(e)) setLoadError(e);
    } finally {
      setIsHydrating(false);
      refreshLocalState();
    }
  }, [selectedStoreId, refreshLocalState]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // The shared cache changes after every confirmed write; realtime events refetch what other people changed.
  useEffect(() => staffService.subscribe(refreshLocalState), [refreshLocalState]);
  useLiveRefresh(['task.', 'attendance.', 'shift.', 'staff.', 'recommendation.', 'customer.assistance.'], () => void hydrate());

  /** Run a write; the toast reports success only after the server confirmed it. */
  const run = async (fn: () => unknown, okMessage: string) => {
    try {
      await fn();
      refreshLocalState();
      showToast(okMessage);
    } catch (e) {
      showToast(`Not saved: ${e instanceof Error ? e.message : 'the server rejected the change'}`);
    }
  };

  // Actions
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await hydrate();
    setIsRefreshing(false);
    showToast('Staff records and shift coverage synchronized.');
  };

  // Employee Handlers
  const handleSelectEmployee = (emp: StaffEmployee) => {
    setSelectedEmployeeForProfile(emp);
    setIsProfileDrawerOpen(true);
  };

  const handleEditEmployee = (emp: StaffEmployee) => {
    setEditingEmployee(emp);
    setIsAddEmployeeOpen(true);
  };

  const handleSaveEmployee = (empData: Partial<StaffEmployee>) => {
    if (empData.id) {
      void run(() => staffService.updateEmployee(empData.id as string, empData), 'Employee record updated successfully.');
    } else {
      void run(() => staffService.addEmployee({
        name: empData.name || 'New Staff',
        email: empData.email || 'staff@retailedge.store',
        phone: empData.phone || '+91 98000 00000',
        role: empData.role || 'cashier',
        roleLabel: empData.roleLabel || 'Cashier',
        department: empData.department || 'Checkout & Cashier',
        storeId: selectedStoreId,
        avatar: empData.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&h=120&fit=crop&crop=face',
        availability: empData.availability || 'available',
        attendance: 'scheduled',
        currentShiftLabel: empData.currentShiftLabel,
        skills: empData.skills || ['Customer Service'],
        assignedZone: empData.assignedZone || 'Main Floor',
      }), 'New employee rostered successfully.');
    }
  };

  const handleDeactivateEmployee = (empId: string) => {
    void run(() => staffService.deactivateEmployee(empId), 'Employee deactivated and unassigned from active shifts.');
  };

  const handleUpdateEmployeeStatus = (empId: string, status: StaffAvailabilityStatus) => {
    void run(() => staffService.updateEmployee(empId, { availability: status }), `Staff availability updated to ${status.replace('_', ' ').toUpperCase()}`);
  };

  // Shift Handlers
  const handleCreateShift = (shiftData: Omit<ShiftAssignment, 'id'>) => {
    void run(() => staffService.createShift(shiftData), `Shift scheduled for ${shiftData.employeeName} (${shiftData.shiftName})`);
  };

  const handleDeleteShift = (shiftId: string) => {
    void run(() => staffService.deleteShift(shiftId), 'Shift assignment removed.');
  };

  // Task Handlers
  const handleCreateTask = (taskData: Omit<StaffTaskExtended, 'id' | 'createdTime'>) => {
    void run(() => staffService.createTask(taskData), `Task "${taskData.title}" dispatched.`);
  };

  const handleAssignTaskToEmployee = (emp: StaffEmployee) => {
    setPreselectedEmployeeForTask(emp);
    setIsCreateTaskOpen(true);
  };

  const handleAssignExistingTask = (task: StaffTaskExtended) => {
    if (task.assignedEmployeeId) {
      showToast(`Task is already assigned to ${task.assignedEmployeeName}`);
      return;
    }
    // Pick first available staff
    const availableStaff = employees.find((e) => e.availability === 'available');
    if (availableStaff) {
      void run(() => staffService.assignTask(task.id, availableStaff.id), `Task "${task.title}" assigned to ${availableStaff.name}.`);
    } else {
      setPreselectedEmployeeForTask(null);
      setIsCreateTaskOpen(true);
    }
  };

  const handleUpdateTaskStatus = (taskId: string, status: StaffTaskStatus) => {
    void run(() => staffService.updateTaskStatus(taskId, status), `Task status updated to ${status.replace('_', ' ').toUpperCase()}`);
  };

  // Attendance Handlers
  const handleOpenAttendanceOverride = (record: AttendanceRecord) => {
    setSelectedAttendanceRecord(record);
    setIsAttendanceOverrideOpen(true);
  };

  const handleSaveAttendanceOverride = (
    recordId: string,
    updates: {
      status: AttendanceStatus;
      actualCheckIn?: string;
      actualCheckOut?: string;
      overrideNote: string;
      overriddenBy: string;
    }
  ) => {
    void run(() => staffService.updateAttendance(recordId, updates), 'Attendance correction recorded as a supervisor override.');
  };

  // AI Recommendations Handlers
  const handleAcceptRecommendation = async (recId: string) => {
    try {
      const res = await staffService.acceptRecommendation(recId);
      refreshLocalState();
      showToast(res.createdTask ? `Recommendation accepted: task "${res.createdTask.title}" created` : 'Recommendation accepted.');
    } catch (e) {
      showToast(`Not saved: ${e instanceof Error ? e.message : 'the server rejected the change'}`);
    }
  };

  const handleRejectRecommendation = (recId: string) => {
    void run(() => staffService.rejectRecommendation(recId), 'Recommendation dismissed.');
  };

  if (loadError && !employees.length) {
    return <BackendState error={loadError} onRetry={() => void hydrate()} what="Staff Management" />;
  }

  return (
    <div className="space-y-5" aria-busy={isHydrating}>
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-600 px-4 py-3 text-white shadow-xl animate-in slide-in-from-bottom duration-300">
          <CheckCircle2 className="h-5 w-5 text-white" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* 1. Header with Filters & Primary Actions */}
      <StaffHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedStore={selectedStore}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        departmentFilter={departmentFilter}
        onDepartmentFilterChange={setDepartmentFilter}
        onOpenAddEmployee={() => {
          setEditingEmployee(null);
          setIsAddEmployeeOpen(true);
        }}
        onOpenCreateShift={() => setIsCreateShiftOpen(true)}
        onOpenCreateTask={() => {
          setPreselectedEmployeeForTask(null);
          setIsCreateTaskOpen(true);
        }}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* 2. Top KPI Cards */}
      <StaffKpis kpis={kpis} />

      {/* 3. Main Tab Contents */}
      {activeTab === 'directory' && (
        <StaffDirectoryTab
          employees={employees}
          searchQuery={searchQuery}
          departmentFilter={departmentFilter}
          onSelectEmployee={handleSelectEmployee}
          onAssignTask={handleAssignTaskToEmployee}
          onEditEmployee={handleEditEmployee}
          onDeactivateEmployee={handleDeactivateEmployee}
        />
      )}

      {activeTab === 'scheduling' && (
        <ShiftSchedulingTab
          shifts={shifts}
          shiftTimings={shiftTimings}
          analytics={analytics}
          onOpenCreateShift={() => setIsCreateShiftOpen(true)}
          onDeleteShift={handleDeleteShift}
        />
      )}

      {activeTab === 'attendance' && (
        <AttendanceMonitoringTab
          attendanceRecords={attendanceRecords}
          onOpenOverrideModal={handleOpenAttendanceOverride}
        />
      )}

      {activeTab === 'tasks' && (
        <TaskManagementTab
          tasks={tasks}
          employees={employees}
          onOpenCreateTask={() => {
            setPreselectedEmployeeForTask(null);
            setIsCreateTaskOpen(true);
          }}
          onUpdateTaskStatus={handleUpdateTaskStatus}
          onAssignTask={handleAssignExistingTask}
        />
      )}

      {activeTab === 'recommendations' && (
        <AiStaffingRecommendationsTab
          recommendations={recommendations}
          analytics={analytics}
          onAcceptRecommendation={handleAcceptRecommendation}
          onRejectRecommendation={handleRejectRecommendation}
        />
      )}

      {activeTab === 'availability' && (
        <LiveAvailabilityPanel
          employees={employees}
          onAssignTask={handleAssignTaskToEmployee}
          onSelectEmployee={handleSelectEmployee}
          onUpdateStatus={handleUpdateEmployeeStatus}
        />
      )}

      {/* 4. Modals & Drawers */}
      <AddEmployeeModal
        isOpen={isAddEmployeeOpen}
        onClose={() => {
          setIsAddEmployeeOpen(false);
          setEditingEmployee(null);
        }}
        onSave={handleSaveEmployee}
        initialEmployee={editingEmployee}
        storeId={selectedStoreId}
      />

      <EmployeeProfileDrawer
        isOpen={isProfileDrawerOpen}
        onClose={() => {
          setIsProfileDrawerOpen(false);
          setSelectedEmployeeForProfile(null);
        }}
        employee={selectedEmployeeForProfile}
        tasks={tasks}
        onAssignTask={handleAssignTaskToEmployee}
        onEditEmployee={handleEditEmployee}
        onDeactivateEmployee={handleDeactivateEmployee}
      />

      <CreateShiftModal
        isOpen={isCreateShiftOpen}
        onClose={() => setIsCreateShiftOpen(false)}
        onSave={handleCreateShift}
        employees={employees}
        shiftTimings={shiftTimings}
        storeId={selectedStoreId}
      />

      <CreateTaskModal
        isOpen={isCreateTaskOpen}
        onClose={() => {
          setIsCreateTaskOpen(false);
          setPreselectedEmployeeForTask(null);
        }}
        onSave={handleCreateTask}
        employees={employees}
        preselectedEmployee={preselectedEmployeeForTask}
        storeId={selectedStoreId}
      />

      <AttendanceOverrideModal
        isOpen={isAttendanceOverrideOpen}
        onClose={() => {
          setIsAttendanceOverrideOpen(false);
          setSelectedAttendanceRecord(null);
        }}
        record={selectedAttendanceRecord}
        onSaveOverride={handleSaveAttendanceOverride}
      />
    </div>
  );
};
