import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  ArrowRight,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';

export const InventorySnapshotSection: React.FC = () => {
  const navigate = useNavigate();
  const { overviewData, isLoading } = useStore();

  if (isLoading || !overviewData) return null;

  const shelves = overviewData.shelves;

  const getConditionBadge = (condition: string) => {
    switch (condition) {
      case 'out_of_stock':
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Out of Stock
          </span>
        );
      case 'low_stock':
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Low Stock
          </span>
        );
      case 'optimal':
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Optimal
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            No data
          </span>
        );
    }
  };

  return (
    <Card className="flex flex-col border-slate-200 [&>:last-child]:mt-auto">
      <CardHeader className="pb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <Boxes className="w-4 h-4 text-blue-600" />
            Inventory Status
          </CardTitle>
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            {shelves.filter((s) => s.condition === 'low_stock' || s.condition === 'out_of_stock').length} Shelves Need Action
          </span>
        </div>

        <button
          onClick={() => navigate('/smart-inventory')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
        >
          <span>View All</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-caption font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-2 px-3">Shelf</th>
                <th className="py-2 px-3">Product</th>
                <th className="py-2 px-3">Availability</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Detection</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shelves.slice(0, 4).map((shelf) => {
                const isOutOfStock = shelf.condition === 'out_of_stock';
                const isLowStock = shelf.condition === 'low_stock';

                return (
                  <tr
                    key={shelf.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isOutOfStock ? 'bg-rose-50/20' : isLowStock ? 'bg-amber-50/15' : ''
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <span className="font-mono whitespace-nowrap text-caption font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                        {shelf.shelfCode.replace('Shelf ', '')}
                      </span>
                    </td>

                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-slate-800 text-xs leading-snug line-clamp-2 max-w-[170px]">{shelf.productName}</p>
                      <p className="text-caption text-slate-400 line-clamp-2 break-words">{shelf.zone}</p>
                    </td>

                    <td className="py-2.5 px-3 min-w-[110px]">
                      <div className="flex items-center justify-between text-caption mb-1">
                        <span className="font-mono font-semibold text-slate-800">
                          {shelf.currentUnits}/{shelf.capacityUnits}
                        </span>
                        <span className="text-slate-500 font-semibold">{shelf.stockPercentage}%</span>
                      </div>
                      <div className="w-full bg-slate-200/70 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isOutOfStock
                              ? 'bg-rose-500'
                              : isLowStock
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${shelf.stockPercentage}%` }}
                        />
                      </div>
                    </td>

                    <td className="py-2.5 px-3">{getConditionBadge(shelf.condition)}</td>

                    <td className="py-2.5 px-3 text-right text-slate-400 text-caption font-mono whitespace-nowrap">
                      {shelf.lastDetection}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      <div className="px-4 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Shelves monitored: <strong className="text-slate-700">{shelves.length}</strong></span>
        <button
          onClick={() => navigate('/smart-inventory')}
          className="text-blue-600 font-semibold hover:underline text-caption"
        >
          Planogram →
        </button>
      </div>
    </Card>
  );
};
export default InventorySnapshotSection;
