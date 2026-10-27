import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Navigation,
  RefreshCw,
  Camera,
  ShieldCheck,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { customerService } from '../../services/customerService';

export const CustomerQueues: React.FC = () => {
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [queueData, setQueueData] = useState(() => customerService.getCheckoutQueues());

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await customerService.refreshQueues();
    } catch {
      /* keep the last known estimate; the "Updated" label shows how old it is */
    }
    setQueueData(customerService.getCheckoutQueues());
    setIsRefreshing(false);
  };

  useEffect(() => {
    const sync = () => setQueueData({ ...customerService.getCheckoutQueues() });
    window.addEventListener('retalledge:customer-queues-updated', sync);
    return () => window.removeEventListener('retalledge:customer-queues-updated', sync);
  }, []);

  const getStatusBadge = (status: 'open' | 'standby' | 'closed') => {
    switch (status) {
      case 'open':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Open
          </span>
        );
      case 'standby':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Standby (Opens at surge)
          </span>
        );
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
            Closed
          </span>
        );
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-14 space-y-5 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Checkout Wait Times & Queue Insights
          </h1>
          
        </div>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Recommended Counter Hero Banner */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-2xl p-5 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-10 pointer-events-none">
          <Zap className="h-44 w-44 text-white" />
        </div>

        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/20 backdrop-blur-xs text-blue-100 border border-white/20">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              Fastest Checkout Counter
            </span>
            <span className="text-[11px] text-blue-200 font-medium">
              Updated: {queueData.lastUpdated}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            <div>
              <div className="text-2xl font-black tracking-tight">{queueData.recommendedCounter ?? 'No estimate right now'}</div>
              <div className="text-xs text-blue-100 mt-0.5">
                {queueData.recommendedCounter ? 'The counter with the shortest estimated wait' : (queueData.note ?? 'Queue estimates are not available at the moment.')}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-white/10 backdrop-blur-xs border border-white/20 rounded-xl px-4 py-2 text-center">
                <div className="text-[11px] text-blue-200 font-semibold uppercase">Est. Wait</div>
                <div className="text-xl font-black text-amber-300">{(() => { const rec = queueData.counters.find((c) => c.isRecommended); return rec && rec.estimatedWaitMins !== null ? `~${rec.estimatedWaitMins} min` : '—'; })()}</div>
              </div>
              <button
                onClick={() => navigate('/customer/map')}
                className="px-4 py-2.5 rounded-xl bg-white text-blue-700 hover:bg-blue-50 font-bold text-xs transition shadow-sm flex items-center gap-1.5 shrink-0"
              >
                <Navigation className="h-3.5 w-3.5" />
                Navigate Here
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Store Queue Overview Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-2xs">
          <div className="text-[11px] font-semibold text-slate-400">Open Counters</div>
          <div className="text-lg font-black text-slate-900 mt-0.5">
            {queueData.counters.filter((c) => c.status === 'open').length} <span className="text-xs font-normal text-slate-400">/ {queueData.counters.length} Total</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-2xs">
          <div className="text-[11px] font-semibold text-slate-400">Congestion Level</div>
          <div className="text-lg font-black text-emerald-600 mt-0.5">
            {queueData.congestionLevel === 'unknown' ? 'Unknown' : queueData.congestionLevel.charAt(0).toUpperCase() + queueData.congestionLevel.slice(1)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-2xs">
          <div className="text-[11px] font-semibold text-slate-400">Avg Wait Time</div>
          <div className="text-lg font-black text-slate-900 mt-0.5">{(() => { const w = queueData.counters.filter((c) => c.status === 'open' && c.estimatedWaitMins !== null).map((c) => c.estimatedWaitMins as number); return w.length ? `${(w.reduce((a, b) => a + b, 0) / w.length).toFixed(1)} mins` : '—'; })()}</div>
        </div>
      </div>

      {/* Individual Counter Cards */}
      <div className="space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
          All Store Counters
        </div>

        <div className="grid grid-cols-1 gap-3">
          {queueData.counters.map((counter) => (
            <div
              key={counter.id}
              className={`p-4 rounded-2xl border transition shadow-2xs ${
                counter.isRecommended
                  ? 'border-blue-500 bg-blue-50/20 ring-1 ring-blue-500/20'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Counter Details */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{counter.name}</span>
                    {getStatusBadge(counter.status)}
                    {counter.isRecommended && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-medium">
                    {counter.type}
                  </div>
                </div>

                {/* Metrics & Action */}
                <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                  {counter.status === 'open' ? (
                    <>
                      <div className="flex items-center gap-4 text-xs">
                        <div className="text-center">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase">Wait</div>
                          <div className={`font-black text-sm ${
                            counter.estimatedWaitMins === null
                              ? 'text-slate-500'
                              : counter.estimatedWaitMins <= 3
                              ? 'text-emerald-600'
                              : counter.estimatedWaitMins <= 5
                              ? 'text-amber-600'
                              : 'text-rose-600'
                          }`}>
                            {counter.estimatedWaitMins === null ? 'Not available' : `~${counter.estimatedWaitMins} mins`}
                          </div>
                        </div>

                        <div className="text-center border-l border-slate-200 pl-3">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase">In Line</div>
                          <div className="font-bold text-sm text-slate-800 flex items-center gap-1 justify-center">
                            <Users className="h-3.5 w-3.5 text-slate-400" />
                            <span>{counter.queueLength ?? '—'}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => navigate('/customer/map')}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition flex items-center gap-1"
                      >
                        <Navigation className="h-3 w-3" />
                        <span>Navigate</span>
                      </button>
                    </>
                  ) : (
                    <div className="text-xs text-slate-400 font-medium italic">
                      On standby. Opens when it gets busy.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Computer Vision Privacy & Estimation Disclaimer */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>How wait times are estimated</span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Wait times are estimates based on counts of people in the checkout area and can be wrong.
          <strong> This screen shows numbers only, never camera images.</strong>
        </p>
      </div>
    </div>
  );
};
export default CustomerQueues;
