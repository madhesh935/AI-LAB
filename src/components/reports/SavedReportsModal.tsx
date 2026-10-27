import React, { useState } from 'react';
import {
  Bookmark,
  X,
  Check,
  Trash2,
  Edit2,
  Plus,
  ArrowRight,
  Clock,
  Layers,
} from 'lucide-react';
import type { ReportConfiguration, ReportCategory, DateRange, ComparePeriod } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface SavedReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedConfigs: ReportConfiguration[];
  activeConfigId: string | null;
  onApplyConfig: (config: ReportConfiguration) => void;
  onSaveNewConfig: (name: string) => Promise<void>;
  onRenameConfig: (configId: string, newName: string) => Promise<void>;
  onDeleteConfig: (configId: string) => Promise<void>;
  currentCategory: ReportCategory;
  currentDateRange: DateRange;
  currentComparePeriod: ComparePeriod;
}

export const SavedReportsModal: React.FC<SavedReportsModalProps> = ({
  isOpen,
  onClose,
  savedConfigs,
  activeConfigId,
  onApplyConfig,
  onSaveNewConfig,
  onRenameConfig,
  onDeleteConfig,
  currentCategory,
  currentDateRange,
  currentComparePeriod,
}) => {
  const [newConfigName, setNewConfigName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConfigName.trim()) return;
    await onSaveNewConfig(newConfigName.trim());
    setNewConfigName('');
    setIsCreating(false);
  };

  const handleSaveRename = async (id: string) => {
    if (!editingName.trim()) return;
    await onRenameConfig(id, editingName.trim());
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
              <Bookmark className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Saved Report Presets</h2>
              
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* Quick Save Current View as Preset */}
          {!isCreating ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-blue-900">Save Current Workspace View?</div>
                <div className="text-caption text-blue-700">
                  Category: <strong>{currentCategory}</strong> • Range: <strong>{currentDateRange}</strong> • Compare: <strong>{currentComparePeriod}</strong>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setNewConfigName(`Store ${currentCategory.toUpperCase()} - ${currentDateRange}`);
                  setIsCreating(true);
                }}
                className="text-xs h-8 px-2.5 bg-blue-600 hover:bg-blue-700 text-white gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Save Current</span>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 space-y-2.5">
              <label className="block text-xs font-semibold text-blue-950">Preset Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  autoFocus
                  value={newConfigName}
                  onChange={(e) => setNewConfigName(e.target.value)}
                  placeholder="e.g. Weekly Management Review"
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                />
                <Button type="submit" variant="primary" size="sm" className="text-xs bg-blue-600">
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreating(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* List of Saved Configs */}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {savedConfigs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No saved views yet.
              </div>
            ) : (
              savedConfigs.map((cfg) => {
                const isEditing = editingId === cfg.id;
                const isActive = activeConfigId === cfg.id;

                return (
                  <div
                    key={cfg.id}
                    className={`rounded-xl border p-3 flex items-center justify-between transition-all ${
                      isActive
                        ? 'border-blue-600 bg-blue-50/30'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex-1 flex items-center gap-2 mr-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="w-full rounded-lg border border-blue-400 px-2 py-1 text-xs text-slate-900 focus:outline-none"
                        />
                        <button
                          onClick={() => handleSaveRename(cfg.id)}
                          className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900">{cfg.name}</span>
                          {isActive && (
                            <Badge variant="primary" size="sm" className="text-caption">
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-caption text-slate-500">
                          <span className="capitalize">{cfg.category}</span>
                          <span>•</span>
                          <span>Range: {cfg.dateRange}</span>
                          <span>•</span>
                          <span>Compare: {cfg.comparePeriod.replace('_', ' ')}</span>
                        </div>
                      </div>
                    )}

                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingId(cfg.id);
                            setEditingName(cfg.name);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                          title="Rename"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteConfig(cfg.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          title="Delete Preset"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <Button
                          variant={isActive ? 'outline' : 'primary'}
                          size="sm"
                          onClick={() => {
                            onApplyConfig(cfg);
                            onClose();
                          }}
                          className={`text-xs h-7 px-2.5 font-semibold ${
                            isActive ? 'border-blue-300 text-blue-700' : 'bg-blue-600 text-white'
                          }`}
                        >
                          {isActive ? 'Applied' : 'Load View'}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-slate-200">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs font-semibold">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
