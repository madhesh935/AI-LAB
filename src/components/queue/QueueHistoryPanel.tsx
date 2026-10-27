import React from 'react';
import { History } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { QueueHistoricalAnalytics } from '../../types/retail';
import { Card } from '../common/Card';

/** Measured queue history (average people waiting per hour, from the queue camera). Replaces the forecast: nothing here is predicted. */
export const QueueHistoryPanel: React.FC<{ history: QueueHistoricalAnalytics }> = ({ history }) => {
  const data = history.hourlyQueueData.filter((h) => h.totalWaiting !== null).map((h) => ({ hour: h.hour, waiting: h.totalWaiting }));
  const maxWaiting = data.length > 0 ? Math.max(...data.map((d) => d.waiting ?? 0)) : 0;
  const avgWaiting =
    data.length > 0 ? (data.reduce((sum, d) => sum + (d.waiting ?? 0), 0) / data.length).toFixed(1) : '0';

  return (
    <Card className="flex flex-col border-slate-200 bg-white p-3.5 sm:p-4 shadow-card h-full justify-between" data-testid="queue-history-panel">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <History className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-900">Queue history</div>
            <div className="text-caption text-slate-500">Measured by the queue camera · average people waiting per hour</div>
          </div>
        </div>

        {data.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-caption font-semibold text-slate-700">
              Peak: <strong className="text-blue-600">{maxWaiting}</strong>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-caption font-semibold text-slate-700">
              Avg: <strong className="text-slate-900">{avgWaiting}</strong>
            </span>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">No queue measurements yet. Nothing is predicted or estimated without measurements.</p>
      ) : (
        <div className="flex-1 min-h-[200px] max-h-[285px] w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="queueHistoryGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis dataKey="hour" fontSize={11} tickLine={false} stroke="#94A3B8" />
              <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#94A3B8" allowDecimals />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload;
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md text-xs">
                        <p className="font-semibold text-slate-800">{item.hour}</p>
                        <p className="text-blue-600 font-medium">Avg waiting: {item.waiting} people</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="waiting"
                name="Avg waiting"
                stroke="#2563EB"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#queueHistoryGrad)"
                dot={{ r: 3.5, fill: '#2563EB', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                activeDot={{ r: 5.5, fill: '#2563EB', stroke: '#FFFFFF', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.length > 0 && (
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 -mx-3.5 -mb-3.5 sm:-mx-4 sm:-mb-4 px-3.5 sm:px-4 py-1.5 text-xs text-slate-600 rounded-b-2xl">
          <span>{data.length} hourly intervals recorded</span>
          <span className="text-caption text-slate-400">Live camera measurements</span>
        </div>
      )}
    </Card>
  );
};
