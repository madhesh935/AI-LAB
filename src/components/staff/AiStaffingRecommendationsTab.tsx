import React from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Send,
  X,
  Clock,
  Activity,
  Layers,
  ArrowRight,
  TrendingUp,
  Briefcase,
  Users,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { StaffingAiRecommendation, StaffWorkloadAnalytics } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface AiStaffingRecommendationsTabProps {
  recommendations: StaffingAiRecommendation[];
  analytics: StaffWorkloadAnalytics;
  onAcceptRecommendation: (id: string) => void;
  onRejectRecommendation: (id: string) => void;
}

export const AiStaffingRecommendationsTab: React.FC<AiStaffingRecommendationsTabProps> = ({
  recommendations,
  analytics,
  onAcceptRecommendation,
  onRejectRecommendation,
}) => {
  const pendingRecs = recommendations.filter((r) => r.status === 'pending');

  return (
    <div className="space-y-6">
      {/* 1. AI Staffing Recommendations Banner */}
      <section aria-label="AI Staffing Allocations" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Staffing Suggestions
              </h3>
              
            </div>
          </div>
        </div>

        {pendingRecs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500 mb-2" />
            <h4 className="text-xs font-semibold text-slate-800">All done</h4>
            <p className="text-caption text-slate-500 mt-0.5">Staffing matches current traffic.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {pendingRecs.map((rec) => {
              const isCritical = rec.priority === 'critical';
              return (
                <Card
                  key={rec.id}
                  className={`p-4 flex flex-col justify-between border-l-4 transition-all shadow-2xs ${
                    isCritical ? 'border-l-rose-500 bg-rose-50/15' : 'border-l-blue-500 bg-white'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-caption font-semibold text-slate-400">{rec.id}</span>
                      <Badge
                        variant={isCritical ? 'error' : 'warning'}
                        size="sm"
                        className="text-caption uppercase font-semibold"
                      >
                        {rec.priority}
                      </Badge>
                    </div>

                    <h4 className="text-xs font-semibold text-slate-900 leading-snug">{rec.title}</h4>
                    <p className="text-caption text-slate-600 leading-relaxed">{rec.reason}</p>

                    <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-2 text-caption space-y-1">
                      <div className="text-slate-500 font-medium">Zone: <strong className="text-slate-700">{rec.zone}</strong></div>
                      <div className="text-slate-500 font-medium">
                        Suggested Staff: <strong className="text-blue-700">{rec.suggestedEmployeeName || 'Any eligible'}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRejectRecommendation(rec.id)}
                      className="text-xs h-7 px-2 text-slate-400 hover:text-slate-600"
                    >
                      Dismiss
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onAcceptRecommendation(rec.id)}
                      className="text-xs h-7 px-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Accept & Dispatch</span>
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Recharts Workload & Allocation Analytics Grid */}
      <section aria-label="Workload Analytics" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks by Department Bar Chart */}
        <Card className="p-5 border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Workload by department</h3>
              
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.departmentLoads} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="department" stroke="#94A3B8" fontSize={9} tickLine={false} interval={0} angle={-15} textAnchor="end" height={40} />
                <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '10px',
                    border: '1px solid #E2E8F0',
                    fontSize: '11px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="assignedTasks" name="Active Tasks" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completedTasks" name="Completed Today" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Individual Associate Assignment Load */}
        <Card className="p-5 border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tasks per person</h3>
              
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.employeeWorkloads}
                layout="vertical"
                margin={{ top: 10, right: 20, left: 20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                <XAxis type="number" stroke="#94A3B8" fontSize={10} tickLine={false} />
                <YAxis dataKey="name" type="category" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} width={90} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '10px',
                    border: '1px solid #E2E8F0',
                    fontSize: '11px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="activeTasks" name="Active Assigned" fill="#F59E0B" radius={[0, 4, 4, 0]} barSize={12} />
                <Bar dataKey="completedToday" name="Completed Today" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>
    </div>
  );
};
