import React, { useState } from 'react';
import {
  X,
  Sliders,
  Save,
  RotateCcw,
  Clock,
  Users,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { QueueRulesConfig } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface QueueRulesConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  config: QueueRulesConfig;
  onSaveConfig: (newConfig: QueueRulesConfig) => Promise<void>;
  onResetDefaults: () => void;
}

export const QueueRulesConfigDrawer: React.FC<QueueRulesConfigDrawerProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onResetDefaults,
}) => {
  const [formConfig, setFormConfig] = useState<QueueRulesConfig>({ ...config });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveConfig(formConfig);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 700);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    onResetDefaults();
    setFormConfig({
      maxPreferredQueueLength: 4,
      slaWarningWaitMinutes: 3.5,
      slaCriticalWaitMinutes: 4.5,
      assumedServiceRatePerMin: 1.2,
      forecastHorizonMinutes: 15,
      autoAlertTriggers: true,
      expressItemLimit: 10,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col justify-between">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/70">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Queue SLA Rules & Triggers</h2>
                
              </div>
            </div>

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Drawer Form Body */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="rounded-xl bg-blue-50/70 border border-blue-200/60 p-3.5 text-xs text-blue-900 flex items-start gap-2.5">
              <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <span>
                These limits decide when a queue is flagged.
              </span>
            </div>

            {/* 1. Max Preferred Queue Length */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-800 mb-1">
                <span>Max Preferred Queue Length</span>
                <span className="font-semibold text-blue-600 font-mono">
                  {formConfig.maxPreferredQueueLength} shoppers
                </span>
              </div>
              <p className="text-caption text-slate-500 mb-2">
                Warn when a lane has more people than this.
              </p>
              <input
                type="range"
                min="2"
                max="8"
                step="1"
                value={formConfig.maxPreferredQueueLength}
                onChange={(e) =>
                  setFormConfig({ ...formConfig, maxPreferredQueueLength: Number(e.target.value) })
                }
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-caption text-slate-400 mt-1">
                <span>2 (Strict)</span>
                <span>5 (Standard)</span>
                <span>8 (High Tolerance)</span>
              </div>
            </div>

            {/* 2. SLA Warning Wait Time Threshold */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-800 mb-1">
                <span>SLA Warning Wait Time</span>
                <span className="font-semibold text-amber-600 font-mono">
                  {formConfig.slaWarningWaitMinutes} minutes
                </span>
              </div>
              <p className="text-caption text-slate-500 mb-2">
                Mark the counter as busy.
              </p>
              <input
                type="range"
                min="1.5"
                max="5.0"
                step="0.5"
                value={formConfig.slaWarningWaitMinutes}
                onChange={(e) =>
                  setFormConfig({ ...formConfig, slaWarningWaitMinutes: Number(e.target.value) })
                }
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-caption text-slate-400 mt-1">
                <span>1.5m</span>
                <span>3.5m</span>
                <span>5.0m</span>
              </div>
            </div>

            {/* 3. Critical SLA Breach Threshold */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-800 mb-1">
                <span>Critical SLA Breach Wait Time</span>
                <span className="font-semibold text-rose-600 font-mono">
                  {formConfig.slaCriticalWaitMinutes} minutes
                </span>
              </div>
              <p className="text-caption text-slate-500 mb-2">
                Raise an alert and suggest opening a counter.
              </p>
              <input
                type="range"
                min="3.0"
                max="8.0"
                step="0.5"
                value={formConfig.slaCriticalWaitMinutes}
                onChange={(e) =>
                  setFormConfig({ ...formConfig, slaCriticalWaitMinutes: Number(e.target.value) })
                }
                className="w-full accent-rose-500"
              />
              <div className="flex justify-between text-caption text-slate-400 mt-1">
                <span>3.0m</span>
                <span>4.5m</span>
                <span>8.0m</span>
              </div>
            </div>

            {/* 4. Assumed Cashier Service Rate */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-800 mb-1">
                <span>Cashier speed</span>
                <span className="font-semibold text-blue-600 font-mono">
                  {formConfig.assumedServiceRatePerMin} cust/min
                </span>
              </div>
              <p className="text-caption text-slate-500 mb-2">
                Default people served per minute.
              </p>
              <input
                type="range"
                min="0.6"
                max="2.2"
                step="0.1"
                value={formConfig.assumedServiceRatePerMin ?? ''}
                onChange={(e) =>
                  setFormConfig({ ...formConfig, assumedServiceRatePerMin: Number(e.target.value) })
                }
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-caption text-slate-400 mt-1">
                <span>0.6 (Slow/Cart)</span>
                <span>1.2 (Standard)</span>
                <span>2.2 (Fast Express)</span>
              </div>
            </div>

            {/* 5. Forecast Horizon Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                Forecast window
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 30].map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    onClick={() =>
                      setFormConfig({ ...formConfig, forecastHorizonMinutes: hz as any })
                    }
                    className={`rounded-lg py-2 text-xs font-semibold border transition-all ${
                      formConfig.forecastHorizonMinutes === hz
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    +{hz} mins
                  </button>
                ))}
              </div>
            </div>

            {/* 6. Express Item Limit & Auto-Dispatch */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">
                    Express Lane Cart Limit
                  </span>
                  <span className="text-caption text-slate-500">
                    Alert above this basket size
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="5"
                    max="20"
                    value={formConfig.expressItemLimit}
                    onChange={(e) =>
                      setFormConfig({ ...formConfig, expressItemLimit: Number(e.target.value) })
                    }
                    className="w-16 rounded-lg border border-slate-300 p-1 text-center text-xs font-semibold text-slate-800"
                  />
                  <span className="text-xs text-slate-500">items</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">
                    Auto notifications
                  </span>
                  <span className="text-caption text-slate-500">
                    Notify floor runners when a limit is passed
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formConfig.autoAlertTriggers}
                  onChange={(e) =>
                    setFormConfig({ ...formConfig, autoAlertTriggers: e.target.checked })
                  }
                  className="h-4 w-4 rounded-sm border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </div>
            </div>
          </form>

          {/* Drawer Footer Actions */}
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Defaults</span>
            </button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="border-slate-300 text-slate-700"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={isSaving}
                className="bg-blue-600 text-white hover:bg-blue-700 gap-1.5"
              >
                {saveSuccess ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-white" />
                    <span>Applied!</span>
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    <span>{isSaving ? 'Applying...' : 'Save Configuration'}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
