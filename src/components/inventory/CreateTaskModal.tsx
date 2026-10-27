import React, { useState, useEffect } from 'react';
import { Plus, X, AlertTriangle, User, Boxes, Clock } from 'lucide-react';
import type { ReplenishmentTask, StoreStaff, Product, ShelfDetail } from '../../types/retail';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffList: StoreStaff[];
  products: Product[];
  shelves: ShelfDetail[];
  initialProduct?: Product | null;
  initialShelf?: ShelfDetail | null;
  onSaveTask: (taskInput: Omit<ReplenishmentTask, 'id' | 'taskCode' | 'createdAt'>) => void;
  existingTasks: ReplenishmentTask[];
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  staffList,
  products,
  shelves,
  initialProduct,
  initialShelf,
  onSaveTask,
  existingTasks,
}) => {
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedShelfId, setSelectedShelfId] = useState<string>('');
  const [priority, setPriority] = useState<'critical' | 'high' | 'medium' | 'low'>('high');
  const [assignedStaffId, setAssignedStaffId] = useState<string>(staffList[0]?.id || '');
  const [quantity, setQuantity] = useState<number>(20);
  const [dueWithin, setDueWithin] = useState<string>('30 mins');
  const [notes, setNotes] = useState<string>('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    if (initialProduct) {
      setSelectedProductId(initialProduct.id);
      setSelectedShelfId(initialProduct.shelfId);
      setQuantity((initialProduct.expectedVisibleQty ?? 0) - (initialProduct.detectedVisibleQty ?? 0) || 20);
    } else if (initialShelf) {
      setSelectedShelfId(initialShelf.id);
      const matchProd = products.find((p) => p.shelfId === initialShelf.id);
      if (matchProd) setSelectedProductId(matchProd.id);
    } else if (products.length > 0) {
      setSelectedProductId(products[0].id);
      setSelectedShelfId(products[0].shelfId);
    }
  }, [initialProduct, initialShelf, products, isOpen]);

  // Check for duplicates
  useEffect(() => {
    if (selectedShelfId) {
      const activeDuplicate = existingTasks.find(
        (t) => t.shelfId === selectedShelfId && t.status !== 'completed'
      );
      if (activeDuplicate) {
        setDuplicateWarning(
          `Notice: An active replenishment task (${activeDuplicate.taskCode}) is already assigned to ${activeDuplicate.assignedStaffName} for this shelf.`
        );
      } else {
        setDuplicateWarning(null);
      }
    }
  }, [selectedShelfId, existingTasks]);

  if (!isOpen) return null;

  const currentProduct = products.find((p) => p.id === selectedProductId) || products[0];
  const currentShelf = shelves.find((s) => s.id === selectedShelfId) || shelves[0];
  const assignedStaff = staffList.find((s) => s.id === assignedStaffId) || staffList[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSaveTask({
      title: `Replenish ${currentProduct?.name || 'Stock'}`,
      productId: currentProduct?.id || 'prod-01',
      productName: currentProduct?.name || 'Product',
      sku: currentProduct?.sku || 'SKU-GEN',
      shelfId: currentShelf?.id || 'shf-a4',
      shelfCode: currentShelf?.shelfCode || 'Shelf A4',
      department: currentProduct?.department || 'General',
      priority,
      assignedStaffId: assignedStaff.id,
      assignedStaffName: assignedStaff.name,
      assignedStaffRole: assignedStaff.role,
      status: 'assigned',
      dueWithin,
      cameraVerified: false,
      quantityToReplenish: quantity,
      notes,
    });

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Shelf Replenishment Task"
      description="Dispatch a floor runner or stockroom associate to replenish depleted shelving"
      size="md"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {duplicateWarning && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Potential Duplicate Warning</p>
              <p className="mt-0.5 text-caption">{duplicateWarning}</p>
            </div>
          </div>
        )}

        {/* Product selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Select Target Product:</label>
          <select
            value={selectedProductId}
            onChange={(e) => {
              setSelectedProductId(e.target.value);
              const prod = products.find((p) => p.id === e.target.value);
              if (prod) setSelectedShelfId(prod.shelfId);
            }}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}) — {p.shelfCode} ({p.detectedVisibleQty}/{p.expectedVisibleQty} visible)
              </option>
            ))}
          </select>
        </div>

        {/* Priority & Quantity Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Priority:</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="critical">Critical (Immediate SLA)</option>
              <option value="high">High (Within 30 mins)</option>
              <option value="medium">Medium (Within 1 hr)</option>
              <option value="low">Low (Routine Restock)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Units to Replenish:</label>
            <input
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Assign Staff Member */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Assign On-Duty Staff Member:</label>
          <select
            value={assignedStaffId}
            onChange={(e) => setAssignedStaffId(e.target.value)}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.role}) — {s.activeTasksCount} active tasks ({s.status})
              </option>
            ))}
          </select>
        </div>

        {/* Due SLA & Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Target Completion Due Time:</label>
          <select
            value={dueWithin}
            onChange={(e) => setDueWithin(e.target.value)}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="15 mins">Within 15 min (urgent)</option>
            <option value="30 mins">Within 30 minutes (Standard)</option>
            <option value="45 mins">Within 45 minutes</option>
            <option value="60 mins">Within 1 hour</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Stockroom location & notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Pull 2 master cases from Cold Room Bay 4, verify shelf tags."
            rows={2}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Form Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            <Plus className="w-3.5 h-3.5 mr-1" />
            Create restock task
          </Button>
        </div>
      </form>
    </Modal>
  );
};
