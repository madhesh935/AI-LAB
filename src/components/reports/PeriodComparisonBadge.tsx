import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface PeriodComparisonBadgeProps {
  percentChange: number | null;
  delta: number | null;
  unit?: string;
  isPositiveGood?: boolean;
  className?: string;
  label?: string;
}

export const PeriodComparisonBadge: React.FC<PeriodComparisonBadgeProps> = ({
  percentChange,
  delta,
  unit = '',
  isPositiveGood = true,
  className = '',
  label,
}) => {
  if (percentChange === null || percentChange === undefined) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-caption font-medium text-slate-500 ${className}`}>
        <Minus className="h-3 w-3" />
        <span>No comparison baseline</span>
      </span>
    );
  }

  if (percentChange === 0) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-caption font-medium text-slate-600 ${className}`}>
        <Minus className="h-3 w-3" />
        <span>0.0% unchanged</span>
      </span>
    );
  }

  const isUp = percentChange > 0;
  // If isUp and isPositiveGood -> green. If isUp and !isPositiveGood -> red.
  // If !isUp and isPositiveGood -> red. If !isUp and !isPositiveGood -> green.
  const isFavorable = isUp ? isPositiveGood : !isPositiveGood;

  const colorClasses = isFavorable
    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    : 'bg-rose-50 text-rose-700 border border-rose-200';

  const Icon = isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold ${colorClasses} ${className}`}
      title={label || `Compared to previous period: ${isUp ? '+' : ''}${delta ?? ''} ${unit}`}
    >
      <Icon className="h-3 w-3 stroke-[2.5]" />
      <span>
        {isUp ? '+' : ''}
        {percentChange.toFixed(1)}%
      </span>
      {label && <span className="text-caption font-normal opacity-80 ml-0.5">{label}</span>}
    </span>
  );
};
