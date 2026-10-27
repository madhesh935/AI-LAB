import React, { useState } from 'react';
import {
  Package,
  Search,
  Filter,
  ArrowUpDown,
  Plus,
  Eye,
  CheckCircle2,
  AlertTriangle,
  PackageX,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
} from 'lucide-react';
import type { Product } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface ProductAvailabilityTableProps {
  products: Product[];
  onSelectProduct: (product: Product) => void;
  onCreateTaskForProduct: (product: Product) => void;
}

export const ProductAvailabilityTable: React.FC<ProductAvailabilityTableProps> = ({
  products,
  onSelectProduct,
  onCreateTaskForProduct,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');
  const [sortField, setSortField] = useState<'name' | 'availabilityPct' | 'stockroomQty'>('availabilityPct');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 6;

  // Filter
  const filtered = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.shelfCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.department.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    if (sortField === 'name') diff = a.name.localeCompare(b.name);
    else if (sortField === 'availabilityPct') diff = (a.availabilityPct ?? 0) - (b.availabilityPct ?? 0);
    else if (sortField === 'stockroomQty') diff = (a.stockroomQty ?? 0) - (b.stockroomQty ?? 0);
    return sortAsc ? diff : -diff;
  });

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize) || 1;
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSort = (field: 'name' | 'availabilityPct' | 'stockroomQty') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'out_of_stock':
        return <Badge variant="error" size="sm" dot>Out of Stock</Badge>;
      case 'low_stock':
        return <Badge variant="warning" size="sm" dot>Low Stock</Badge>;
      default:
        return <Badge variant="success" size="sm" dot>In Stock</Badge>;
    }
  };

  return (
    <Card className="flex flex-col border-slate-200 shadow-card h-full">
      <CardHeader className="flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              Product Availability
            </CardTitle>
          </div>
          
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Segmented Control */}
          <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            {(
              [
                { label: 'All', val: 'all' },
                { label: 'Low', val: 'low_stock' },
                { label: 'OOS', val: 'out_of_stock' },
                { label: 'Optimal', val: 'in_stock' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.val}
                onClick={() => {
                  setStatusFilter(tab.val);
                  setCurrentPage(1);
                }}
                className={`px-2 py-0.5 text-caption font-semibold rounded transition-colors ${
                  statusFilter === tab.val
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search SKU..."
              className="bg-white border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-36"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 flex flex-col justify-between">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-caption font-semibold text-slate-600 uppercase">
                <th
                  onClick={() => handleSort('name')}
                  className="py-2.5 px-3 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Product & SKU</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-3">Shelf</th>
                <th
                  onClick={() => handleSort('availabilityPct')}
                  className="py-2.5 px-3 cursor-pointer hover:bg-slate-100 transition-colors min-w-[130px]"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Visible Fill</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('stockroomQty')}
                  className="py-2.5 px-3 cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>ERP Stock</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-3">Confidence</th>
                <th className="py-2.5 px-3">Condition</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 text-xs">
                    No products found matching &quot;{searchTerm}&quot;
                  </td>
                </tr>
              ) : (
                paginated.map((product) => {
                  const isCritical = product.status === 'out_of_stock';
                  const isLow = product.status === 'low_stock';

                  return (
                    <tr
                      key={product.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isCritical ? 'bg-rose-50/20' : isLow ? 'bg-amber-50/15' : ''
                      }`}
                    >
                      {/* Product Name & SKU */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-600">
                            <Package className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 leading-snug">{product.name}</p>
                            <span className="font-mono text-caption text-slate-400">{product.sku}</span>
                          </div>
                        </div>
                      </td>

                      {/* Shelf & Dept */}
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-caption font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                          {product.shelfCode}
                        </span>
                        <p className="text-caption text-slate-500 mt-0.5">{product.department}</p>
                      </td>

                      {/* Visible Shelf Fill & Progress Bar */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-between text-caption mb-1">
                          <span className="font-mono font-semibold text-slate-900">
                            {product.detectedVisibleQty} / {product.expectedVisibleQty}
                          </span>
                          <span className="font-semibold text-slate-700">{product.availabilityPct}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isCritical
                                ? 'bg-rose-500'
                                : isLow
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${product.availabilityPct}%` }}
                          />
                        </div>
                      </td>

                      {/* ERP Warehouse Stock (Distinct from visible shelf) */}
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-semibold text-slate-900 text-xs">
                          {product.stockroomQty} {product.unit}s
                        </span>
                        <p className="text-caption text-slate-400">Back stockroom</p>
                      </td>

                      {/* AI Confidence */}
                      <td className="py-2.5 px-3 font-mono text-caption text-slate-600">
                        {product.confidenceScore === null ? '—' : `${Math.round(product.confidenceScore * 100)}%`}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3">{getStatusBadge(product.status)}</td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {(isLow || isCritical) && (
                            <button
                              onClick={() => onCreateTaskForProduct(product)}
                              className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-caption transition-colors cursor-pointer whitespace-nowrap"
                              title="Create Restocking Task"
                            >
                              Restock Task
                            </button>
                          )}
                          <button
                            onClick={() => onSelectProduct(product)}
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Inspect product detail"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, sorted.length)} of{' '}
            {sorted.length} items
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="p-1 rounded bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="p-1 rounded bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
