import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Package,
  Layers,
  ArrowRight,
  Flame,
  Snowflake,
  ShoppingBag,
} from 'lucide-react';
import type { RetailOpportunity } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface RetailOpportunityCardsProps {
  opportunities: RetailOpportunity[];
}

export const RetailOpportunityCards: React.FC<RetailOpportunityCardsProps> = ({ opportunities }) => {
  const navigate = useNavigate();

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'high_traffic':
        return <Flame className="h-4 w-4 text-amber-500" />;
      case 'bottleneck':
        return <AlertTriangle className="h-4 w-4 text-rose-500" />;
      case 'shelf_velocity':
        return <Package className="h-4 w-4 text-emerald-500" />;
      case 'cold_spot':
        return <Snowflake className="h-4 w-4 text-sky-500" />;
      default:
        return <Sparkles className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <Card className="border-slate-200 bg-white p-4 shadow-card space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-semibold text-slate-900">
                Alerts
              </h2>
              
            </div>
          </div>
        </div>

        <Badge variant="warning" size="sm" className="text-caption bg-amber-50 text-amber-800 border-amber-200 self-start sm:self-auto">
          {opportunities.length} alerts
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {opportunities.map((opp) => (
          <div
            key={opp.id}
            className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 transition-all hover:bg-white hover:border-blue-300 hover:shadow-md"
          >
            <div>
              <div className="flex items-center gap-2">
                {getTypeIcon(opp.type)}
                <h3 className="min-w-0 flex-1 text-xs font-semibold text-slate-900 leading-snug">{opp.title}</h3>
                <Badge variant="primary" size="sm" className="text-caption font-mono shrink-0">
                  {opp.metricValue}
                </Badge>
              </div>
              <p className="mt-0.5 pl-6 text-caption text-slate-400">{opp.zone}</p>
              <p className="mt-1.5 pl-6 text-caption text-slate-600 leading-snug">{opp.observation}</p>
              <p className="mt-1 pl-6 text-caption text-slate-700 leading-snug">
                <span className="text-blue-600">→</span> {opp.opportunityNote}
              </p>
            </div>

            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(opp.targetUrl)}
                className="text-xs h-7 px-2.5 border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700 gap-1.5 font-medium"
              >
                <span>{opp.actionLabel}</span>
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
