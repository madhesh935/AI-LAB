import { runStaffAction, useServerChanged, errorText } from '../../services/api/useStaffPage';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ClipboardList,
  Sparkles,
  ArrowUpDown,
  RefreshCw,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService } from '../../services/staffApiService';
import type { StaffTaskExtended, StaffTaskStatus, StaffTaskCategory } from '../../types/retail';
import { TaskCardMobile } from '../../components/staff-pwa/TaskCardMobile';

export const StaffTasks: React.FC = () => {
  const navigate = useNavigate();
  const { currentStaff } = useStaffAuth();
  const { showToast, refreshBadges } = useOutletContext<{
    showToast: (msg: string) => void;
    refreshBadges: () => void;
  }>();

  const [tasks, setTasks] = useState<StaffTaskExtended[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'new' | 'in_progress' | 'completed' | 'overdue'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTasks = async () => {
    if (!currentStaff) return;
    try {
      const list = await staffApiService.getTasks(currentStaff.id, currentStaff.storeId);
      setTasks(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  };

  useEffect(() => {
    loadTasks();
  }, [currentStaff]);
  useServerChanged(() => void loadTasks());

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadTasks();
    refreshBadges();
    setTimeout(() => {
      setIsRefreshing(false);
      showToast('Task list refreshed.');
    }, 400);
  };

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mTitle = t.title.toLowerCase().includes(q);
        const mId = t.id.toLowerCase().includes(q);
        const mZone = t.zone.toLowerCase().includes(q);
        const mEntity = t.relatedEntity?.label.toLowerCase().includes(q);
        if (!mTitle && !mId && !mZone && !mEntity) return false;
      }

      // Status Tab
      if (activeTab === 'new' && t.status !== 'new' && t.status !== 'assigned') return false;
      if (activeTab === 'in_progress' && t.status !== 'in_progress') return false;
      if (activeTab === 'completed' && t.status !== 'completed') return false;
      if (activeTab === 'overdue') {
        if (t.status === 'completed' || t.priority !== 'critical') return false;
      }

      // Category
      if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;

      return true;
    });
  }, [tasks, activeTab, selectedCategory, searchQuery]);

  // Actions
  const handleAcceptTask = async (taskId: string) => {
    if (!currentStaff) return;
    await runStaffAction(() => staffApiService.acceptTask(taskId, currentStaff.id), 'Task accepted.', showToast);
    await loadTasks();
    refreshBadges();
  };

  const handleStartTask = async (taskId: string) => {
    if (!currentStaff) return;
    await runStaffAction(() => staffApiService.startTask(taskId, currentStaff.id), 'Work started.', showToast);
    await loadTasks();
    refreshBadges();
  };

  const handleCompleteTask = async (taskId: string) => {
    if (!currentStaff) return;
    await runStaffAction(() => staffApiService.completeTask(taskId, currentStaff.id), 'Task completed and confirmed by the store server.', showToast);
    await loadTasks();
    refreshBadges();
  };

  const categories: { label: string; value: string }[] = [
    { label: 'All Categories', value: 'all' },
    { label: 'Shelf Replenish', value: 'shelf_replenishment' },
    { label: 'Checkout Assist', value: 'checkout_assistance' },
    { label: 'Audit / Inspect', value: 'inventory_inspection' },
    { label: 'Customer Care', value: 'customer_assistance' },
    { label: 'Cameras / Tech', value: 'camera_maintenance' },
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {loadError && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          Tasks could not be loaded: {loadError}.{' '}
          <button onClick={() => void loadTasks()} className="font-semibold underline">Retry</button>
        </div>
      )}

      {/* 1. Page Title & Count */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">Workforce Tasks</h1>
          <p className="text-xs text-slate-500">
            {tasks.length} total assignments for {currentStaff?.name.split(' ')[0]}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-slate-300 shadow-2xs"
          title="Refresh tasks"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
        </button>
      </div>

      {/* 2. Search & Category Select */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks, shelves (SH-B2), or zones..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
          />
        </div>

        {/* Category Horizontal Scroll Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          {categories.map((c) => (
            <button
              key={c.value}
              onClick={() => setSelectedCategory(c.value)}
              className={`px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === c.value
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Status Tabs Ribbon */}
      <div className="flex items-center justify-between p-1 rounded-2xl bg-slate-200/60 text-xs font-bold">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-1 py-1.5 rounded-xl transition-all ${
            activeTab === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All ({tasks.length})
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`flex-1 py-1.5 rounded-xl transition-all ${
            activeTab === 'new' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          New ({tasks.filter((t) => t.status === 'new' || t.status === 'assigned').length})
        </button>
        <button
          onClick={() => setActiveTab('in_progress')}
          className={`flex-1 py-1.5 rounded-xl transition-all ${
            activeTab === 'in_progress' ? 'bg-white text-amber-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Active ({tasks.filter((t) => t.status === 'in_progress').length})
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`flex-1 py-1.5 rounded-xl transition-all ${
            activeTab === 'completed' ? 'bg-white text-emerald-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Done ({tasks.filter((t) => t.status === 'completed').length})
        </button>
      </div>

      {/* 4. Task List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-3xl border border-dashed border-slate-200 space-y-2">
            <ClipboardList className="h-8 w-8 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No matching tasks found</h3>
            <p className="text-xs text-slate-400">
              Try changing the search or filters.
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <TaskCardMobile
              key={task.id}
              task={task}
              onAccept={handleAcceptTask}
              onStart={handleStartTask}
              onComplete={handleCompleteTask}
            />
          ))
        )}
      </div>
    </div>
  );
};
