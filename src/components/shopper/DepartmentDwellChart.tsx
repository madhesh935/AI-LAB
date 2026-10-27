import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Timer,
  Clock,
  Sparkles,
} from 'lucide-react';
import type { DwellTimeRecord } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';

interface DepartmentDwellChartProps {
  dwellData: DwellTimeRecord[];
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string) => void;
}

export const DepartmentDwellChart: React.FC<DepartmentDwellChartProps> = ({
  dwellData,
  selectedZoneId,
  onSelectZone,
}) => {
  const chartData = dwellData.map((d) => ({
    name: d.zoneName.split('&')[0].trim(),
    fullName: d.zoneName,
    zoneId: d.zoneId,
    actualDwell: d.avgDwellMinutes,
    targetBenchmark: d.benchmarkTargetMinutes,
  }));

  const longest = [...chartData].filter((d) => d.actualDwell !== null).sort((a, b) => (b.actualDwell ?? 0) - (a.actualDwell ?? 0))[0];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-2.5 rounded-xl shadow-xl border border-slate-200 text-xs font-sans min-w-[150px]">
          <p className="font-semibold text-slate-800 border-b border-slate-100 pb-1 mb-1.5">
            {data.fullName}
          </p>
          <div className="space-y-1">
            <div className="flex justify-between gap-3">
              <span className="text-blue-600 font-medium">Measured Dwell:</span>
              <span className="font-mono font-semibold text-slate-900">{data.actualDwell} mins</span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Target SLA:</span>
              <span className="font-mono font-medium text-slate-600">{data.targetBenchmark === null ? '—' : `${data.targetBenchmark} mins`}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="flex flex-col border-slate-200">
      <CardHeader className="flex-col items-start 2xl:flex-row 2xl:items-center justify-between gap-2.5 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
            <Timer className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900">
              Time per Department
            </CardTitle>
            
          </div>
        </div>

        {dwellData.some((d) => d.benchmarkTargetMinutes !== null) && (
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Target {Math.min(...dwellData.map((d) => d.benchmarkTargetMinutes ?? Infinity))}–{Math.max(...dwellData.map((d) => d.benchmarkTargetMinutes ?? 0))} min
          </span>
        )}
      </CardHeader>

      <CardContent className="pt-3 pb-2 px-2 sm:px-4">
        <div className="h-[230px] w-full" style={{ height: 230, minHeight: 230 }}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart
              data={chartData}
              margin={{ top: 12, right: 15, left: -10, bottom: 0 }}
              onClick={(e: any) => {
                if (e && e.activePayload && e.activePayload[0]) {
                  const zId = e.activePayload[0].payload.zoneId;
                  onSelectZone(zId);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis
                dataKey="name"
                stroke="#94A3B8"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#E2E8F0' }}
              />
              <YAxis
                stroke="#94A3B8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                unit="m"
                width={46}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: '8px', fontSize: '11px' }}
                iconType="circle"
              />
              <Bar
                dataKey="actualDwell"
                name="Measured Dwell (Mins)"
                fill="#2563EB"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="targetBenchmark"
                name="Target Benchmark"
                fill="#E2E8F0"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>

      <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Tap a bar to filter</span>
        <span className="font-semibold text-slate-800">{longest ? `Longest Dwell: ${longest.fullName.split('&')[0].trim()} (${longest.actualDwell}m)` : 'Longest Dwell: —'}</span>
      </div>
    </Card>
  );
};

export default DepartmentDwellChart;
