import React, { useEffect, useState } from 'react';
import { Search, X, Video, AlertTriangle, Layers, Clock, ArrowRight } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Modal } from '../common/Modal';

export const SearchModal: React.FC = () => {
  const { isSearchOpen, setIsSearchOpen, overviewData } = useStore();
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsSearchOpen]);

  if (!isSearchOpen) return null;

  const cameras = overviewData?.cameras || [];
  const shelves = overviewData?.shelves || [];
  const alerts = overviewData?.alerts || [];
  const queues = overviewData?.queues || [];

  const filteredCameras = cameras.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.zone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredShelves = shelves.filter(
    (s) =>
      s.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.shelfCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.zone.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredAlerts = alerts.filter(
    (a) =>
      a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.zone.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredQueues = queues.filter((q) =>
    q.counterName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalResults =
    filteredCameras.length + filteredShelves.length + filteredAlerts.length + filteredQueues.length;

  return (
    <Modal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} size="lg">
      <div className="p-4 border-b border-slate-100 flex items-center gap-3">
        <Search className="w-5 h-5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search cameras, shelves, alerts, queues, or zones... (e.g. Almond Milk, Counter 2, CAM-01)"
          className="w-full text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none bg-transparent"
          autoFocus
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-4 max-h-96 overflow-y-auto space-y-4">
        {searchTerm && totalResults === 0 && (
          <div className="py-8 text-center text-slate-400 text-sm">
            No retail entities found matching &quot;{searchTerm}&quot;
          </div>
        )}

        {/* Live Cameras Results */}
        {filteredCameras.length > 0 && (
          <div>
            <div className="text-caption font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5 text-blue-600" />
              Live CCTV Cameras ({filteredCameras.length})
            </div>
            <div className="space-y-1.5">
              {filteredCameras.map((cam) => (
                <div
                  key={cam.id}
                  onClick={() => setIsSearchOpen(false)}
                  className="p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-mono font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {cam.id}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-slate-900">{cam.name}</p>
                      <p className="text-caption text-slate-500">{cam.zone}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alerts Results */}
        {filteredAlerts.length > 0 && (
          <div>
            <div className="text-caption font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              AI Operational Alerts ({filteredAlerts.length})
            </div>
            <div className="space-y-1.5">
              {filteredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  onClick={() => setIsSearchOpen(false)}
                  className="p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer group"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-900">{alert.title}</p>
                    <p className="text-caption text-slate-500">{alert.zone} &bull; {alert.timestamp}</p>
                  </div>
                  <span className="text-caption text-amber-600 font-medium group-hover:translate-x-0.5 transition-transform">
                    View &rarr;
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shelves Results */}
        {filteredShelves.length > 0 && (
          <div>
            <div className="text-caption font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              Smart Shelves & Stock ({filteredShelves.length})
            </div>
            <div className="space-y-1.5">
              {filteredShelves.map((shelf) => (
                <div
                  key={shelf.id}
                  onClick={() => setIsSearchOpen(false)}
                  className="p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium text-slate-700">{shelf.shelfCode}</span>
                      <span className="text-xs font-medium text-slate-900">{shelf.productName}</span>
                    </div>
                    <p className="text-caption text-slate-500">{shelf.zone} &bull; {shelf.currentUnits} of {shelf.capacityUnits} units ({shelf.stockPercentage}%)</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Checkout Queues */}
        {filteredQueues.length > 0 && (
          <div>
            <div className="text-caption font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              Checkout Counters ({filteredQueues.length})
            </div>
            <div className="space-y-1.5">
              {filteredQueues.map((q) => (
                <div
                  key={q.counterId}
                  onClick={() => setIsSearchOpen(false)}
                  className="p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer group"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-900">{q.counterName}</p>
                    <p className="text-caption text-slate-500">{q.waitingCustomers} waiting &bull; ~{q.estimatedWaitMinutes} min wait</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-caption text-slate-500">
        <span>Press <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-caption font-mono">ESC</kbd> to close</span>
        <span>RetailEdge AI Quick Navigator</span>
      </div>
    </Modal>
  );
};
