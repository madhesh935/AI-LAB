/**
 * RetailEdge AI — Staff Management & Workforce Operations Service
 * Manages employee records, shift scheduling, conflict validation,
 * attendance tracking, unified task dispatch, and AI staffing recommendations.
 */

import { IS_DEMO_MODE } from './api/config';
import { staffRemote } from './api/staffRemote';
import type {
  StaffEmployee,
  ShiftTiming,
  ShiftAssignment,
  AttendanceRecord,
  StaffTaskExtended,
  StaffingAiRecommendation,
  StaffWorkloadAnalytics,
  StaffManagementKpis,
  StaffActivityLogItem,
  DepartmentName,
  EmployeeRole,
  StaffAvailabilityStatus,
  AttendanceStatus,
  PriorityLevel,
  StaffTaskCategory,
  StaffTaskStatus,
} from '../types/retail';

const STORAGE_KEYS = {
  EMPLOYEES: 'retalledge_staff_employees',
  SHIFTS: 'retalledge_staff_shifts',
  TASKS: 'retalledge_staff_tasks',
  ATTENDANCE: 'retalledge_staff_attendance',
  RECOMMENDATIONS: 'retalledge_staff_recommendations',
};

export const SHIFT_TIMINGS: ShiftTiming[] = [
  { id: 'sh-morning', name: 'Morning Shift', startTime: '08:00', endTime: '16:00', breakDurationMinutes: 45, color: '#3B82F6' },
  { id: 'sh-afternoon', name: 'Afternoon Shift', startTime: '12:00', endTime: '20:00', breakDurationMinutes: 45, color: '#8B5CF6' },
  { id: 'sh-evening', name: 'Evening Shift', startTime: '16:00', endTime: '23:00', breakDurationMinutes: 30, color: '#F59E0B' },
  { id: 'sh-night', name: 'Overnight Restock', startTime: '23:00', endTime: '07:00', breakDurationMinutes: 60, color: '#64748B' },
];

export const INITIAL_STAFF_EMPLOYEES: StaffEmployee[] = [
  {
    id: 'STF-01',
    name: 'Ramesh Kumar',
    email: 'ramesh.kumar@retalledge.store',
    phone: '+91 98450 11201',
    role: 'inventory_associate',
    roleLabel: 'Senior Inventory Associate',
    department: 'Inventory & Stockroom',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=face',
    availability: 'busy',
    attendance: 'present',
    currentShiftId: 'sh-morning',
    currentShiftLabel: 'Morning (08:00 – 16:00)',
    checkInTime: '07:54 AM',
    activeTasksCount: 2,
    completedTasksCount: 44,
    skills: ['Forklift Certified', 'Inventory Auditing', 'Bakery Restock', 'RF Scanner'],
    isActive: true,
    joinedDate: '2023-04-15',
    assignedZone: 'Backroom / Aisle 3 (Bakery)',
  },
  {
    id: 'STF-02',
    name: 'Pooja Nair',
    email: 'pooja.nair@retalledge.store',
    phone: '+91 98450 22302',
    role: 'shelf_replenishment',
    roleLabel: 'Floor Runner & POS Specialist',
    department: 'Produce & Dairy',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&h=120&fit=crop&crop=face',
    availability: 'available',
    attendance: 'present',
    currentShiftId: 'sh-afternoon',
    currentShiftLabel: 'Afternoon (12:00 – 20:00)',
    checkInTime: '11:48 AM',
    activeTasksCount: 1,
    completedTasksCount: 58,
    skills: ['POS Billing', 'Rapid Restock', 'Customer Service', 'First Aid'],
    isActive: true,
    joinedDate: '2023-08-10',
    assignedZone: 'Dairy Aisles & Checkout Assist',
  },
  {
    id: 'STF-03',
    name: 'Vikram Patel',
    email: 'vikram.patel@retalledge.store',
    phone: '+91 98450 33403',
    role: 'inventory_associate',
    roleLabel: 'Stockroom Receiving Clerk',
    department: 'Inventory & Stockroom',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&h=120&fit=crop&crop=face',
    availability: 'busy',
    attendance: 'present',
    currentShiftId: 'sh-morning',
    currentShiftLabel: 'Morning (08:00 – 16:00)',
    checkInTime: '08:02 AM',
    activeTasksCount: 2,
    completedTasksCount: 38,
    skills: ['Receiving Dock', 'Pallet Jack', 'ERP Tagging', 'Safety Compliance'],
    isActive: true,
    joinedDate: '2022-11-01',
    assignedZone: 'Loading Dock & Stockroom',
  },
  {
    id: 'STF-04',
    name: 'Anita Desai',
    email: 'anita.desai@retalledge.store',
    phone: '+91 98450 44504',
    role: 'floor_supervisor',
    roleLabel: 'Merchandising Floor Supervisor',
    department: 'Management',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&h=120&fit=crop&crop=face',
    availability: 'available',
    attendance: 'present',
    currentShiftId: 'sh-morning',
    currentShiftLabel: 'Morning (08:00 – 16:00)',
    checkInTime: '07:45 AM',
    activeTasksCount: 0,
    completedTasksCount: 29,
    skills: ['Team Leadership', 'Planogram Compliance', 'Dispute Resolution', 'POS Supervisor Key'],
    isActive: true,
    joinedDate: '2021-06-20',
    assignedZone: 'Main Sales Floor & POS',
  },
  {
    id: 'STF-05',
    name: 'Siddharth Rao',
    email: 'siddharth.rao@retalledge.store',
    phone: '+91 98450 55605',
    role: 'shelf_replenishment',
    roleLabel: 'FMCG Restock Specialist',
    department: 'Bakery & Fresh',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=120&h=120&fit=crop&crop=face',
    availability: 'on_break',
    attendance: 'present',
    currentShiftId: 'sh-afternoon',
    currentShiftLabel: 'Afternoon (12:00 – 20:00)',
    checkInTime: '11:55 AM',
    activeTasksCount: 0,
    completedTasksCount: 41,
    skills: ['Facing Precision', 'Inventory Scanning', 'Cold Chain Handling'],
    isActive: true,
    joinedDate: '2023-01-18',
    assignedZone: 'Aisles 4–6 (Packaged Goods)',
  },
  {
    id: 'STF-06',
    name: 'Sneha Sharma',
    email: 'sneha.sharma@retalledge.store',
    phone: '+91 98450 66706',
    role: 'cashier',
    roleLabel: 'Head Cashier (POS Terminal 1)',
    department: 'Checkout & Cashier',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&h=120&fit=crop&crop=face',
    availability: 'busy',
    attendance: 'present',
    currentShiftId: 'sh-morning',
    currentShiftLabel: 'Morning (08:00 – 16:00)',
    checkInTime: '07:50 AM',
    activeTasksCount: 1,
    completedTasksCount: 65,
    skills: ['Fast Scan Rate', 'Cash Handling', 'Loyalty Program', 'UPI / Card POS'],
    isActive: true,
    joinedDate: '2022-09-12',
    assignedZone: 'Checkout Counter 1',
  },
  {
    id: 'STF-07',
    name: 'Arjun Verma',
    email: 'arjun.verma@retalledge.store',
    phone: '+91 98450 77807',
    role: 'cashier',
    roleLabel: 'Cashier & Customer Assistant',
    department: 'Checkout & Cashier',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&h=120&fit=crop&crop=face',
    availability: 'available',
    attendance: 'present',
    currentShiftId: 'sh-afternoon',
    currentShiftLabel: 'Afternoon (12:00 – 20:00)',
    checkInTime: '12:05 PM',
    activeTasksCount: 0,
    completedTasksCount: 31,
    skills: ['POS Operations', 'Bagging Support', 'Returns Processing'],
    isActive: true,
    joinedDate: '2023-10-05',
    assignedZone: 'Checkout Counter 3',
  },
  {
    id: 'STF-08',
    name: 'Deepa Menon',
    email: 'deepa.menon@retalledge.store',
    phone: '+91 98450 88908',
    role: 'customer_support',
    roleLabel: 'Fresh Produce Quality Associate',
    department: 'Produce & Dairy',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&h=120&fit=crop&crop=face',
    availability: 'available',
    attendance: 'present',
    currentShiftId: 'sh-morning',
    currentShiftLabel: 'Morning (08:00 – 16:00)',
    checkInTime: '07:58 AM',
    activeTasksCount: 1,
    completedTasksCount: 22,
    skills: ['Organic Certification', 'Weigh Scale Station', 'Customer Guidance'],
    isActive: true,
    joinedDate: '2023-03-22',
    assignedZone: 'Aisle 1 (Fresh Produce)',
  },
  {
    id: 'STF-09',
    name: 'Rajesh Pillai',
    email: 'rajesh.pillai@retalledge.store',
    phone: '+91 98450 99009',
    role: 'security',
    roleLabel: 'Loss Prevention & CCTV Officer',
    department: 'Security & Loss Prevention',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&h=120&fit=crop&crop=face',
    availability: 'busy',
    attendance: 'present',
    currentShiftId: 'sh-morning',
    currentShiftLabel: 'Morning (08:00 – 16:00)',
    checkInTime: '07:30 AM',
    activeTasksCount: 1,
    completedTasksCount: 19,
    skills: ['CCTV Surveillance', 'Emergency Protocol', 'EAS Gate Inspection'],
    isActive: true,
    joinedDate: '2021-12-05',
    assignedZone: 'Foyer Entrance & Monitor Room',
  },
  {
    id: 'STF-10',
    name: 'Meera Joshi',
    email: 'meera.joshi@retalledge.store',
    phone: '+91 98450 00110',
    role: 'customer_support',
    roleLabel: 'Customer Service Representative',
    department: 'Customer Support',
    storeId: 'store-blr-104',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=120&h=120&fit=crop&crop=face',
    availability: 'off_duty',
    attendance: 'scheduled',
    currentShiftId: 'sh-evening',
    currentShiftLabel: 'Evening (16:00 – 23:00)',
    activeTasksCount: 0,
    completedTasksCount: 14,
    skills: ['Customer Inquiries', 'Exchange Handling', 'Telephone Support'],
    isActive: true,
    joinedDate: '2024-01-10',
    assignedZone: 'Help Desk / Reception',
  },
];

export const INITIAL_STAFF_TASKS: StaffTaskExtended[] = [
  {
    id: 'TSK-101',
    title: 'Replenish Shelf B2 Artisan Sourdough Loaves',
    description: 'Shelf B2 is empty. Bring 24 loaves from the back dock.',
    category: 'shelf_replenishment',
    priority: 'critical',
    status: 'in_progress',
    assignedEmployeeId: 'STF-01',
    assignedEmployeeName: 'Ramesh Kumar',
    assignedEmployeeRole: 'Senior Inventory Associate',
    storeId: 'store-blr-104',
    zone: 'Aisle 3 Bakery',
    relatedEntity: { type: 'shelf', id: 'SH-B2-01', label: 'Shelf B2 (Artisan Sourdough)' },
    createdTime: '14:22:10',
    dueTime: '14:45:00',
    sourceAlertId: 'ALR-INV-201',
    notes: 'Prioritize sourdough baguettes before afternoon rush.',
  },
  {
    id: 'TSK-102',
    title: 'Counter 2 Checkout Queue Assistance',
    description: '7 waiting at Counter 2. Help with bagging.',
    category: 'checkout_assistance',
    priority: 'critical',
    status: 'in_progress',
    assignedEmployeeId: 'STF-02',
    assignedEmployeeName: 'Pooja Nair',
    assignedEmployeeRole: 'Floor Runner & POS Specialist',
    storeId: 'store-blr-104',
    zone: 'Checkout Counters',
    relatedEntity: { type: 'counter', id: 'cnt-02', label: 'Counter 2 (Standard)' },
    createdTime: '14:30:00',
    dueTime: '14:50:00',
    sourceAlertId: 'ALR-Q-104',
    notes: 'Supervisor Anita requested runner support at POS 2.',
  },
  {
    id: 'TSK-103',
    title: 'Organic Whole Milk Cold Shelf Replenish (Shelf A3)',
    description: 'Milk down to 4 units. Restock 26 from the chiller.',
    category: 'shelf_replenishment',
    priority: 'high',
    status: 'assigned',
    assignedEmployeeId: 'STF-01',
    assignedEmployeeName: 'Ramesh Kumar',
    assignedEmployeeRole: 'Senior Inventory Associate',
    storeId: 'store-blr-104',
    zone: 'Aisle 2 Dairy',
    relatedEntity: { type: 'shelf', id: 'SH-A3-02', label: 'Shelf A3 (Organic Milk)' },
    createdTime: '14:10:15',
    dueTime: '14:55:00',
    sourceAlertId: 'ALR-INV-202',
  },
  {
    id: 'TSK-104',
    title: 'Loading Bay CAM-05 Cable & Stream Inspection',
    description: 'Camera stream dropping. Check the cable.',
    category: 'camera_maintenance',
    priority: 'high',
    status: 'assigned',
    assignedEmployeeId: 'STF-09',
    assignedEmployeeName: 'Rajesh Pillai',
    assignedEmployeeRole: 'Loss Prevention Officer',
    storeId: 'store-blr-104',
    zone: 'Backroom Loading Dock',
    relatedEntity: { type: 'camera', id: 'CAM-05', label: 'CAM-05 Loading Bay' },
    createdTime: '13:50:00',
    dueTime: '15:00:00',
  },
  {
    id: 'TSK-105',
    title: 'Fresh Produce Spinach Misting & Facing Audit',
    description: 'Check spinach and greens freshness.',
    category: 'inventory_inspection',
    priority: 'medium',
    status: 'in_progress',
    assignedEmployeeId: 'STF-08',
    assignedEmployeeName: 'Deepa Menon',
    assignedEmployeeRole: 'Fresh Produce Quality Associate',
    storeId: 'store-blr-104',
    zone: 'Aisle 1 Produce',
    relatedEntity: { type: 'zone', id: 'zone-produce', label: 'Produce Bay' },
    createdTime: '13:00:00',
    dueTime: '15:30:00',
  },
  {
    id: 'TSK-106',
    title: 'Snack Aisle 5 Promotional Endcap Restock',
    description: 'Move almond crackers and nuts to the endcap.',
    category: 'shelf_replenishment',
    priority: 'medium',
    status: 'new',
    storeId: 'store-blr-104',
    zone: 'Aisle 5 Snacks',
    createdTime: '14:05:00',
    dueTime: '16:00:00',
  },
  {
    id: 'TSK-107',
    title: 'Checkout Counter 1 Cash Till Midday Balance',
    description: 'Midday cash drop for terminal 1.',
    category: 'general_operations',
    priority: 'medium',
    status: 'in_progress',
    assignedEmployeeId: 'STF-06',
    assignedEmployeeName: 'Sneha Sharma',
    assignedEmployeeRole: 'Head Cashier',
    storeId: 'store-blr-104',
    zone: 'Checkout Area',
    createdTime: '14:15:00',
    dueTime: '15:15:00',
  },
  {
    id: 'TSK-108',
    title: 'Customer Lost Umbrella Retrieval at Foyer Desk',
    description: 'Customer needs help with cart #14.',
    category: 'customer_assistance',
    priority: 'low',
    status: 'completed',
    assignedEmployeeId: 'STF-07',
    assignedEmployeeName: 'Arjun Verma',
    assignedEmployeeRole: 'Cashier & Customer Assistant',
    storeId: 'store-blr-104',
    zone: 'Foyer Entrance',
    createdTime: '12:30:00',
    dueTime: '13:00:00',
    completedTime: '12:48:00',
  },
];

export const INITIAL_STAFF_SHIFTS: ShiftAssignment[] = [
  { id: 'shift-01', employeeId: 'STF-01', employeeName: 'Ramesh Kumar', roleLabel: 'Senior Inventory Associate', department: 'Inventory & Stockroom', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-morning', shiftName: 'Morning Shift', startTime: '08:00', endTime: '16:00', status: 'confirmed' },
  { id: 'shift-02', employeeId: 'STF-04', employeeName: 'Anita Desai', roleLabel: 'Floor Supervisor', department: 'Management', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-morning', shiftName: 'Morning Shift', startTime: '08:00', endTime: '16:00', status: 'confirmed' },
  { id: 'shift-03', employeeId: 'STF-06', employeeName: 'Sneha Sharma', roleLabel: 'Head Cashier', department: 'Checkout & Cashier', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-morning', shiftName: 'Morning Shift', startTime: '08:00', endTime: '16:00', status: 'confirmed' },
  { id: 'shift-04', employeeId: 'STF-08', employeeName: 'Deepa Menon', roleLabel: 'Fresh Produce Quality Associate', department: 'Produce & Dairy', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-morning', shiftName: 'Morning Shift', startTime: '08:00', endTime: '16:00', status: 'confirmed' },
  { id: 'shift-05', employeeId: 'STF-09', employeeName: 'Rajesh Pillai', roleLabel: 'Security Officer', department: 'Security & Loss Prevention', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-morning', shiftName: 'Morning Shift', startTime: '08:00', endTime: '16:00', status: 'confirmed' },
  { id: 'shift-06', employeeId: 'STF-02', employeeName: 'Pooja Nair', roleLabel: 'Floor Runner', department: 'Produce & Dairy', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-afternoon', shiftName: 'Afternoon Shift', startTime: '12:00', endTime: '20:00', status: 'confirmed' },
  { id: 'shift-07', employeeId: 'STF-05', employeeName: 'Siddharth Rao', roleLabel: 'FMCG Restock Specialist', department: 'Bakery & Fresh', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-afternoon', shiftName: 'Afternoon Shift', startTime: '12:00', endTime: '20:00', status: 'confirmed' },
  { id: 'shift-08', employeeId: 'STF-07', employeeName: 'Arjun Verma', roleLabel: 'Cashier', department: 'Checkout & Cashier', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-afternoon', shiftName: 'Afternoon Shift', startTime: '12:00', endTime: '20:00', status: 'confirmed' },
  { id: 'shift-09', employeeId: 'STF-03', employeeName: 'Vikram Patel', roleLabel: 'Receiving Clerk', department: 'Inventory & Stockroom', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-morning', shiftName: 'Morning Shift', startTime: '08:00', endTime: '16:00', status: 'confirmed' },
  { id: 'shift-10', employeeId: 'STF-10', employeeName: 'Meera Joshi', roleLabel: 'Customer Service Representative', department: 'Customer Support', storeId: 'store-blr-104', date: '2026-10-24', shiftTimingId: 'sh-evening', shiftName: 'Evening Shift', startTime: '16:00', endTime: '23:00', status: 'scheduled' },
];

export const INITIAL_ATTENDANCE_RECORDS: AttendanceRecord[] = [
  { id: 'att-01', employeeId: 'STF-01', employeeName: 'Ramesh Kumar', department: 'Inventory & Stockroom', date: '2026-10-24', scheduledShift: 'Morning (08:00 – 16:00)', scheduledStart: '08:00', scheduledEnd: '16:00', actualCheckIn: '07:54 AM', status: 'present', totalHoursWorked: 6.8, isLateCheckIn: false },
  { id: 'att-02', employeeId: 'STF-04', employeeName: 'Anita Desai', department: 'Management', date: '2026-10-24', scheduledShift: 'Morning (08:00 – 16:00)', scheduledStart: '08:00', scheduledEnd: '16:00', actualCheckIn: '07:45 AM', status: 'present', totalHoursWorked: 7.0, isLateCheckIn: false },
  { id: 'att-03', employeeId: 'STF-06', employeeName: 'Sneha Sharma', department: 'Checkout & Cashier', date: '2026-10-24', scheduledShift: 'Morning (08:00 – 16:00)', scheduledStart: '08:00', scheduledEnd: '16:00', actualCheckIn: '07:50 AM', status: 'present', totalHoursWorked: 6.9, isLateCheckIn: false },
  { id: 'att-04', employeeId: 'STF-08', employeeName: 'Deepa Menon', department: 'Produce & Dairy', date: '2026-10-24', scheduledShift: 'Morning (08:00 – 16:00)', scheduledStart: '08:00', scheduledEnd: '16:00', actualCheckIn: '07:58 AM', status: 'present', totalHoursWorked: 6.8, isLateCheckIn: false },
  { id: 'att-05', employeeId: 'STF-09', employeeName: 'Rajesh Pillai', department: 'Security & Loss Prevention', date: '2026-10-24', scheduledShift: 'Morning (08:00 – 16:00)', scheduledStart: '08:00', scheduledEnd: '16:00', actualCheckIn: '07:30 AM', status: 'present', totalHoursWorked: 7.2, isLateCheckIn: false },
  { id: 'att-06', employeeId: 'STF-02', employeeName: 'Pooja Nair', department: 'Produce & Dairy', date: '2026-10-24', scheduledShift: 'Afternoon (12:00 – 20:00)', scheduledStart: '12:00', scheduledEnd: '20:00', actualCheckIn: '11:48 AM', status: 'present', totalHoursWorked: 2.9, isLateCheckIn: false },
  { id: 'att-07', employeeId: 'STF-05', employeeName: 'Siddharth Rao', department: 'Bakery & Fresh', date: '2026-10-24', scheduledShift: 'Afternoon (12:00 – 20:00)', scheduledStart: '12:00', scheduledEnd: '20:00', actualCheckIn: '11:55 AM', status: 'present', totalHoursWorked: 2.8, isLateCheckIn: false },
  { id: 'att-08', employeeId: 'STF-07', employeeName: 'Arjun Verma', department: 'Checkout & Cashier', date: '2026-10-24', scheduledShift: 'Afternoon (12:00 – 20:00)', scheduledStart: '12:00', scheduledEnd: '20:00', actualCheckIn: '12:05 PM', status: 'late', totalHoursWorked: 2.6, isLateCheckIn: true, lateMinutes: 5 },
  { id: 'att-09', employeeId: 'STF-03', employeeName: 'Vikram Patel', department: 'Inventory & Stockroom', date: '2026-10-24', scheduledShift: 'Morning (08:00 – 16:00)', scheduledStart: '08:00', scheduledEnd: '16:00', actualCheckIn: '08:02 AM', status: 'present', totalHoursWorked: 6.7, isLateCheckIn: false },
  { id: 'att-10', employeeId: 'STF-10', employeeName: 'Meera Joshi', department: 'Customer Support', date: '2026-10-24', scheduledShift: 'Evening (16:00 – 23:00)', scheduledStart: '16:00', scheduledEnd: '23:00', status: 'scheduled', totalHoursWorked: 0, isLateCheckIn: false },
];

export const INITIAL_AI_STAFFING_RECOMMENDATIONS: StaffingAiRecommendation[] = [
  {
    id: 'REC-01',
    title: 'Deploy Standby Cashier to Open Counter 4',
    reason: 'Counter 2 wait is 5.8 min (limit 4.5). 7 waiting.',
    zone: 'Checkout Counters',
    priority: 'critical',
    recommendedAction: 'Assign available cashier Arjun Verma to open Counter 4 immediately.',
    suggestedEmployeeId: 'STF-07',
    suggestedEmployeeName: 'Arjun Verma',
    sourceMetrics: '7 queued, 1.4 arrivals/min. One lane cannot keep up.',
    status: 'pending',
  },
  {
    id: 'REC-02',
    title: 'Assign Urgent Bakery Sourdough Restock',
    reason: 'Shelf B2 empty. 40 units at the back dock.',
    zone: 'Aisle 3 Bakery',
    priority: 'critical',
    recommendedAction: 'Send Ramesh Kumar to restock 24 loaves.',
    suggestedEmployeeId: 'STF-01',
    suggestedEmployeeName: 'Ramesh Kumar',
    sourceMetrics: 'YOLOv11x Shelf Model: 0 visible items in bay SH-B2-01 since 14:22:10.',
    status: 'pending',
  },
  {
    id: 'REC-03',
    title: 'Pre-position 2 Floor Runners for Evening Wave',
    reason: '~420 shoppers/hr expected from 17:30.',
    zone: 'Store Floor & POS',
    priority: 'high',
    recommendedAction: 'Move Pooja Nair and Siddharth Rao to checkout.',
    suggestedEmployeeId: 'STF-02',
    suggestedEmployeeName: 'Pooja Nair',
    sourceMetrics: '94% chance of an evening rush.',
    status: 'pending',
  },
];

export const INITIAL_WORKLOAD_ANALYTICS: StaffWorkloadAnalytics = {
  departmentLoads: [
    { department: 'Inventory & Stockroom', assignedTasks: 4, completedTasks: 82, staffCount: 2 },
    { department: 'Checkout & Cashier', assignedTasks: 2, completedTasks: 96, staffCount: 2 },
    { department: 'Produce & Dairy', assignedTasks: 2, completedTasks: 80, staffCount: 2 },
    { department: 'Bakery & Fresh', assignedTasks: 1, completedTasks: 41, staffCount: 1 },
    { department: 'Security & LP', assignedTasks: 1, completedTasks: 19, staffCount: 1 },
    { department: 'Management', assignedTasks: 0, completedTasks: 29, staffCount: 1 },
    { department: 'Customer Support', assignedTasks: 0, completedTasks: 14, staffCount: 1 },
  ],
  hourlyCoverage: [
    { hour: '08:00', scheduledStaff: 5, availableStaff: 4, requiredStaff: 4 },
    { hour: '10:00', scheduledStaff: 5, availableStaff: 4, requiredStaff: 5 },
    { hour: '12:00', scheduledStaff: 8, availableStaff: 6, requiredStaff: 6 },
    { hour: '14:00', scheduledStaff: 8, availableStaff: 5, requiredStaff: 7 },
    { hour: '16:00', scheduledStaff: 7, availableStaff: 5, requiredStaff: 8 },
    { hour: '18:00', scheduledStaff: 8, availableStaff: 6, requiredStaff: 9 },
    { hour: '20:00', scheduledStaff: 5, availableStaff: 4, requiredStaff: 5 },
    { hour: '22:00', scheduledStaff: 3, availableStaff: 3, requiredStaff: 3 },
  ],
  statusDistribution: [
    { status: 'Completed', count: 38, color: '#10B981' },
    { status: 'In Progress', count: 4, color: '#3B82F6' },
    { status: 'Assigned', count: 2, color: '#F59E0B' },
    { status: 'New', count: 1, color: '#8B5CF6' },
  ],
  dailyCompletions: [
    { date: 'Mon', completed: 28, target: 25 },
    { date: 'Tue', completed: 32, target: 30 },
    { date: 'Wed', completed: 34, target: 30 },
    { date: 'Thu', completed: 31, target: 30 },
    { date: 'Fri', completed: 42, target: 35 },
    { date: 'Sat (Today)', completed: 38, target: 35 },
  ],
  employeeWorkloads: [
    { name: 'Ramesh Kumar', activeTasks: 2, completedToday: 8, avgCompletionMins: 16 },
    { name: 'Pooja Nair', activeTasks: 1, completedToday: 11, avgCompletionMins: 12 },
    { name: 'Sneha Sharma', activeTasks: 1, completedToday: 14, avgCompletionMins: 8 },
    { name: 'Deepa Menon', activeTasks: 1, completedToday: 5, avgCompletionMins: 22 },
    { name: 'Rajesh Pillai', activeTasks: 1, completedToday: 3, avgCompletionMins: 28 },
    { name: 'Vikram Patel', activeTasks: 2, completedToday: 6, avgCompletionMins: 24 },
  ],
};

class StaffManagementService {
  /**
   * Load employees from localStorage or defaults
   */
  getEmployees(storeId: string = 'store-blr-104'): StaffEmployee[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
      if (stored) {
        const list: StaffEmployee[] = JSON.parse(stored);
        return list.filter((e) => e.storeId === storeId);
      }
    } catch {
      // Fallback
    }
    return INITIAL_STAFF_EMPLOYEES.filter((e) => e.storeId === storeId);
  }

  saveEmployees(employees: StaffEmployee[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
    } catch {
      // Ignore
    }
  }

  addEmployee(employee: Omit<StaffEmployee, 'id' | 'joinedDate' | 'activeTasksCount' | 'completedTasksCount' | 'isActive'>): StaffEmployee {
    const list = this.getEmployees(employee.storeId);
    const newId = `STF-${String(list.length + 1).padStart(2, '0')}`;
    const newEmp: StaffEmployee = {
      ...employee,
      id: newId,
      joinedDate: new Date().toISOString().split('T')[0],
      activeTasksCount: 0,
      completedTasksCount: 0,
      isActive: true,
    };
    const updated = [newEmp, ...list];
    this.saveEmployees(updated);
    return newEmp;
  }

  updateEmployee(id: string, updates: Partial<StaffEmployee>): StaffEmployee | null {
    const list = this.getEmployees();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...updates };
    this.saveEmployees(list);
    return list[idx];
  }

  deactivateEmployee(id: string): boolean {
    const list = this.getEmployees();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    list[idx].isActive = false;
    list[idx].availability = 'off_duty';
    this.saveEmployees(list);
    return true;
  }

  /**
   * Shift Scheduling
   */
  getShifts(storeId: string = 'store-blr-104', date?: string): ShiftAssignment[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SHIFTS);
      if (stored) {
        const list: ShiftAssignment[] = JSON.parse(stored);
        let filtered = list.filter((s) => s.storeId === storeId);
        if (date) filtered = filtered.filter((s) => s.date === date);
        return filtered;
      }
    } catch {
      // Fallback
    }
    return INITIAL_STAFF_SHIFTS;
  }

  saveShifts(shifts: ShiftAssignment[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.SHIFTS, JSON.stringify(shifts));
    } catch {
      // Ignore
    }
  }

  detectShiftConflict(employeeId: string, date: string, startTime: string, endTime: string, ignoreShiftId?: string): { hasConflict: boolean; reason?: string } {
    const shifts = this.getShifts();
    const matching = shifts.filter(
      (s) => s.employeeId === employeeId && s.date === date && s.id !== ignoreShiftId
    );

    for (const sh of matching) {
      if (
        (startTime >= sh.startTime && startTime < sh.endTime) ||
        (endTime > sh.startTime && endTime <= sh.endTime) ||
        (startTime <= sh.startTime && endTime >= sh.endTime)
      ) {
        return {
          hasConflict: true,
          reason: `Overlaps with existing ${sh.shiftName} (${sh.startTime} – ${sh.endTime}) on ${date}.`,
        };
      }
    }
    return { hasConflict: false };
  }

  createShift(shift: Omit<ShiftAssignment, 'id'>): ShiftAssignment {
    const conflict = this.detectShiftConflict(shift.employeeId, shift.date, shift.startTime, shift.endTime);
    const newId = `shift-${Date.now().toString().slice(-6)}`;
    const newShift: ShiftAssignment = {
      ...shift,
      id: newId,
      hasConflict: conflict.hasConflict,
      conflictReason: conflict.reason,
    };
    const list = this.getShifts(shift.storeId);
    const updated = [newShift, ...list];
    this.saveShifts(updated);
    return newShift;
  }

  deleteShift(id: string): boolean {
    const list = this.getShifts();
    const filtered = list.filter((s) => s.id !== id);
    this.saveShifts(filtered);
    return true;
  }

  /**
   * Attendance Tracking
   */
  getAttendance(storeId: string = 'store-blr-104', date?: string): AttendanceRecord[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ATTENDANCE);
      if (stored) {
        const list: AttendanceRecord[] = JSON.parse(stored);
        return list;
      }
    } catch {
      // Fallback
    }
    return INITIAL_ATTENDANCE_RECORDS;
  }

  saveAttendance(records: AttendanceRecord[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(records));
    } catch {
      // Ignore
    }
  }

  updateAttendance(
    id: string,
    updates: {
      actualCheckIn?: string;
      actualCheckOut?: string;
      status: AttendanceStatus;
      overrideNote: string;
      overriddenBy: string;
    }
  ): AttendanceRecord | null {
    const records = this.getAttendance();
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    records[idx] = {
      ...records[idx],
      actualCheckIn: updates.actualCheckIn ?? records[idx].actualCheckIn,
      actualCheckOut: updates.actualCheckOut ?? records[idx].actualCheckOut,
      status: updates.status,
      manualOverrideNote: updates.overrideNote,
      overriddenBy: updates.overriddenBy,
    };
    this.saveAttendance(records);
    return records[idx];
  }

  /**
   * Task Management
   */
  getTasks(storeId: string = 'store-blr-104'): StaffTaskExtended[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.TASKS);
      if (stored) {
        const list: StaffTaskExtended[] = JSON.parse(stored);
        return list.filter((t) => t.storeId === storeId);
      }
    } catch {
      // Fallback
    }
    return INITIAL_STAFF_TASKS;
  }

  saveTasks(tasks: StaffTaskExtended[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    } catch {
      // Ignore
    }
  }

  createTask(task: Omit<StaffTaskExtended, 'id' | 'createdTime'>): StaffTaskExtended {
    const list = this.getTasks(task.storeId);
    const newId = `TSK-${Math.floor(100 + Math.random() * 900)}`;
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newTask: StaffTaskExtended = {
      ...task,
      id: newId,
      createdTime: nowTime,
    };
    const updated = [newTask, ...list];
    this.saveTasks(updated);

    // If assigned to an employee, increment active tasks count
    if (newTask.assignedEmployeeId) {
      const employees = this.getEmployees();
      const emp = employees.find((e) => e.id === newTask.assignedEmployeeId);
      if (emp) {
        emp.activeTasksCount += 1;
        emp.availability = 'busy';
        this.saveEmployees(employees);
      }
    }

    return newTask;
  }

  updateTaskStatus(taskId: string, status: StaffTaskStatus): StaffTaskExtended | null {
    const list = this.getTasks();
    const idx = list.findIndex((t) => t.id === taskId);
    if (idx === -1) return null;

    const prevStatus = list[idx].status;
    list[idx].status = status;

    if (status === 'completed' && prevStatus !== 'completed') {
      list[idx].completedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Update employee completed stats
      if (list[idx].assignedEmployeeId) {
        const employees = this.getEmployees();
        const emp = employees.find((e) => e.id === list[idx].assignedEmployeeId);
        if (emp) {
          emp.activeTasksCount = Math.max(0, emp.activeTasksCount - 1);
          emp.completedTasksCount += 1;
          if (emp.activeTasksCount === 0 && emp.availability === 'busy') {
            emp.availability = 'available';
          }
          this.saveEmployees(employees);
        }
      }
    }

    this.saveTasks(list);
    return list[idx];
  }

  assignTask(taskId: string, employeeId: string): StaffTaskExtended | null {
    const list = this.getTasks();
    const idx = list.findIndex((t) => t.id === taskId);
    if (idx === -1) return null;

    const employees = this.getEmployees();
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return null;

    list[idx].assignedEmployeeId = emp.id;
    list[idx].assignedEmployeeName = emp.name;
    list[idx].assignedEmployeeRole = emp.roleLabel;
    list[idx].status = 'assigned';

    emp.activeTasksCount += 1;
    emp.availability = 'busy';

    this.saveTasks(list);
    this.saveEmployees(employees);
    return list[idx];
  }

  /**
   * AI Staffing Recommendations
   */
  getRecommendations(): StaffingAiRecommendation[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.RECOMMENDATIONS);
      if (stored) return JSON.parse(stored);
    } catch {
      // Fallback
    }
    return INITIAL_AI_STAFFING_RECOMMENDATIONS;
  }

  saveRecommendations(recs: StaffingAiRecommendation[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.RECOMMENDATIONS, JSON.stringify(recs));
    } catch {
      // Ignore
    }
  }

  acceptRecommendation(recId: string): { success: boolean; createdTask?: StaffTaskExtended } {
    const recs = this.getRecommendations();
    const target = recs.find((r) => r.id === recId);
    if (!target) return { success: false };

    target.status = 'accepted';
    this.saveRecommendations(recs);

    // Auto-create corresponding task
    const newTask = this.createTask({
      title: target.title,
      description: `${target.reason} Grounding metrics: ${target.sourceMetrics}`,
      category: target.zone.includes('Checkout') ? 'checkout_assistance' : 'shelf_replenishment',
      priority: target.priority,
      status: target.suggestedEmployeeId ? 'assigned' : 'new',
      assignedEmployeeId: target.suggestedEmployeeId,
      assignedEmployeeName: target.suggestedEmployeeName,
      storeId: 'store-blr-104',
      zone: target.zone,
      dueTime: '30 mins',
      notes: `Generated from AI Staffing Recommendation #${target.id}`,
    });

    return { success: true, createdTask: newTask };
  }

  rejectRecommendation(recId: string): boolean {
    const recs = this.getRecommendations();
    const target = recs.find((r) => r.id === recId);
    if (!target) return false;
    target.status = 'rejected';
    this.saveRecommendations(recs);
    return true;
  }

  /**
   * Aggregate Overview KPIs
   */
  getKpis(storeId: string = 'store-blr-104'): StaffManagementKpis {
    const employees = this.getEmployees(storeId).filter((e) => e.isActive);
    const attendance = this.getAttendance(storeId);
    const tasks = this.getTasks(storeId);

    const onDuty = employees.filter((e) => e.attendance === 'present' || e.attendance === 'late').length;
    const availableStaff = employees.filter((e) => e.availability === 'available' && (e.attendance === 'present' || e.attendance === 'late')).length;
    const busyStaff = employees.filter((e) => e.availability === 'busy').length;
    const pendingTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;

    const scheduled = attendance.length;
    const checkedIn = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;
    const absent = attendance.filter((a) => a.status === 'absent').length;
    const onLeave = attendance.filter((a) => a.status === 'on_leave').length;
    const attendanceRatePct = scheduled > 0 ? Math.round((checkedIn / scheduled) * 100) : 100;

    return {
      totalEmployees: employees.length,
      onDuty,
      availableStaff,
      busyStaff,
      pendingTasks,
      attendanceRatePct,
      checkedInCount: checkedIn,
      absentCount: absent,
      onLeaveCount: onLeave,
    };
  }

  getWorkloadAnalytics(): StaffWorkloadAnalytics {
    return INITIAL_WORKLOAD_ANALYTICS;
  }
}

/**
 * What the Staff Management page and the Staff PWA depend on. Reads are synchronous (cache / local fixtures); writes may be async
 * because in REAL mode they only take effect once the server confirmed them.
 */
export interface StaffDataSource {
  hydrate(storeId: string, signal?: AbortSignal): Promise<void>;
  subscribe(fn: () => void): () => void;
  getEmployees(storeId?: string): StaffEmployee[];
  getShifts(storeId?: string, date?: string): ShiftAssignment[];
  getAttendance(storeId?: string, date?: string): AttendanceRecord[];
  getTasks(storeId?: string): StaffTaskExtended[];
  getRecommendations(): StaffingAiRecommendation[];
  getKpis(storeId?: string): StaffManagementKpis;
  getWorkloadAnalytics(): StaffWorkloadAnalytics;
  detectShiftConflict(employeeId: string, date: string, startTime: string, endTime: string, ignoreShiftId?: string): { hasConflict: boolean; reason?: string };
  addEmployee(e: Parameters<StaffManagementService['addEmployee']>[0]): StaffEmployee | Promise<StaffEmployee>;
  updateEmployee(id: string, updates: Partial<StaffEmployee>): StaffEmployee | null | Promise<StaffEmployee | null>;
  deactivateEmployee(id: string): boolean | Promise<boolean>;
  createShift(shift: Omit<ShiftAssignment, 'id'>): ShiftAssignment | Promise<ShiftAssignment>;
  deleteShift(id: string): boolean | Promise<boolean>;
  updateAttendance(id: string, updates: Parameters<StaffManagementService['updateAttendance']>[1]): AttendanceRecord | null | Promise<AttendanceRecord | null>;
  createTask(task: Omit<StaffTaskExtended, 'id' | 'createdTime'>): StaffTaskExtended | Promise<StaffTaskExtended>;
  updateTaskStatus(taskId: string, status: StaffTaskStatus): StaffTaskExtended | null | Promise<StaffTaskExtended | null>;
  assignTask(taskId: string, employeeId: string): StaffTaskExtended | null | Promise<StaffTaskExtended | null>;
  acceptRecommendation(recId: string): { success: boolean; createdTask?: StaffTaskExtended } | Promise<{ success: boolean; createdTask?: StaffTaskExtended }>;
  rejectRecommendation(recId: string): boolean | Promise<boolean>;
}

const demoService = new StaffManagementService();
const demoSource: StaffDataSource = Object.assign(demoService, {
  hydrate: async () => undefined,
  subscribe: () => () => undefined,
}) as unknown as StaffDataSource;

/** DEMO mode: the localStorage fixtures above. REAL mode: the backend (services/api/staffRemote.ts). */
export const staffService: StaffDataSource = IS_DEMO_MODE ? demoSource : (staffRemote as unknown as StaffDataSource);
