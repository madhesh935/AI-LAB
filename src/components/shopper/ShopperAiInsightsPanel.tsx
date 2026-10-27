import React, { useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  ShoppingBag,
  Users,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { ShopperInsight } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';

interface ShopperAiInsightsPanelProps {
  insights: ShopperInsight[];
  onSelectZone: (zoneId: string) => void;
}

export const ShopperAiInsightsPanel: React.FC<ShopperAiInsightsPanelProps> = ({
  insights,
  onSelectZone,
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [appliedActions, setAppliedActions] = useState<string[]>([]);

  const handleApply = (id: string) => {
    if (!appliedActions.includes(id)) {
      setAppliedActions([...appliedActions, id]);
    }
  };

  const filteredInsights =
    filterType === 'all'
      ? insights
      : insights.filter((item) => item.type === filterType);

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'bottleneck':
        return <AlertTriangle className="w-4 h-4 text-rose-500" />;
      case 'merchandising':
        return <ShoppingBag className="w-4 h-4 text-purple-500" />;
      case 'staffing':
        return <Users className="w-4 h-4 text-amber-500" />;
      default:
        return <TrendingUp className="w-4 h-4 text-blue-500" />;
    }
  };

  const getImportanceBadge = (importance: string) => {
    switch (importance) {
      case 'high':
        return (
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            High Priority
          </span>
        );
      case 'medium':
        return (
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            Medium
          </span>
        );
      default:
        return (
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            Advisory
          </span>
        );
    }
  };

  return (
    <Card className="flex flex-col border-slate-200 h-full">
      {/* Header */}
      <CardHeader className="flex-col items-start 2xl:flex-row 2xl:items-center justify-between gap-2.5 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900">
              AI Insights
            </CardTitle>
            
          </div>
        </div>

      </CardHeader>

      <CardContent className="p-3 sm:p-4 space-y-3 flex-1 flex flex-col">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
          {[
            { label: 'All', val: 'all', count: insights.length },
            { label: 'Bottlenecks', val: 'bottleneck', count: insights.filter((i) => i.type === 'bottleneck').length },
            { label: 'Staffing', val: 'staffing', count: insights.filter((i) => i.type === 'staffing').length },
            { label: 'Merchandising', val: 'merchandising', count: insights.filter((i) => i.type === 'merchandising').length },
          ].map((tab) => (
            <button
              key={tab.val}
              type="button"
              onClick={() => setFilterType(tab.val)}
              className={`px-2.5 py-1 rounded-lg border font-semibold text-caption transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                filterType === tab.val
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-caption px-1 py-0.2 rounded-full font-semibold ${
                  filterType === tab.val ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Scrollable / Stacked Insights List */}
        <div className="space-y-2 flex-1 overflow-y-auto max-h-[460px] pr-1">
          {filteredInsights.map((insight) => {
            const isBottleneck = insight.type === 'bottleneck';
            const isApplied = appliedActions.includes(insight.id);

            return (
              <div
                key={insight.id}
                className={`px-3 py-2.5 rounded-lg border transition-all ${
                  isBottleneck
                    ? 'bg-rose-50/25 border-rose-200 hover:border-rose-300'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-slate-100 shrink-0">{getInsightIcon(insight.type)}</div>
                  <h4 className="min-w-0 flex-1 text-xs font-semibold text-slate-900 leading-snug">{insight.title}</h4>
                  {getImportanceBadge(insight.importance)}
                </div>

                <p className="mt-1 pl-8 text-caption text-slate-600 leading-snug">
                  {insight.description}
                  <span className="text-slate-400"> · {insight.metricImpact}</span>
                </p>

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pl-8">
                  <p className="min-w-0 flex-1 basis-40 text-caption text-slate-700 leading-snug">
                    <span className="text-blue-600">→</span> {insight.suggestedAction}
                  </p>
                  <div className="flex shrink-0 items-center gap-2 text-caption">
                    {insight.zoneId && (
                      <button
                        type="button"
                        onClick={() => onSelectZone(insight.zoneId!)}
                        className="text-blue-600 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                        title="Highlight on map"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>Map</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleApply(insight.id)}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                        isApplied
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-blue-600 text-white hover:bg-blue-700 shadow-2xs'
                      }`}
                    >
                      {isApplied ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Dispatched</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3 h-3" />
                          <span>Apply</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Confidence Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-caption text-slate-400">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Computed from stored observations</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default ShopperAiInsightsPanel;
