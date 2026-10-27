import { BackendState } from '../components/common/BackendState';
import { isAbort } from '../services/api/client';
import { useLiveRefresh } from '../services/api/realtime';
import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../context/StoreContext';
import { apiService } from '../services/apiService';
import type {
  SmartInventoryData,
  ShelfDetail,
  Product,
  ReplenishmentTask,
  ReplenishmentTaskStatus,
  InventoryAlert,
  CameraFeed,
} from '../types/retail';
import { InventoryHeader } from '../components/inventory/InventoryHeader';
import { InventoryKpis } from '../components/inventory/InventoryKpis';
import { LiveShelfCameraMonitoring } from '../components/inventory/LiveShelfCameraMonitoring';
import { LiveShelfCameraReal } from '../components/inventory/LiveShelfCameraReal';
import { IS_DEMO_MODE } from '../services/api/config';
import { ShelfMonitoringGrid } from '../components/inventory/ShelfMonitoringGrid';
import { ProductAvailabilityTable } from '../components/inventory/ProductAvailabilityTable';
import { PlanogramComplianceSection } from '../components/inventory/PlanogramComplianceSection';
import { RestockingTaskManagement } from '../components/inventory/RestockingTaskManagement';
import { InventoryAlertsSection } from '../components/inventory/InventoryAlertsSection';
import { CreateTaskModal } from '../components/inventory/CreateTaskModal';
import { ShelfInspectionModal } from '../components/inventory/ShelfInspectionModal';
import { ProductDetailDrawer } from '../components/inventory/ProductDetailDrawer';

export const SmartInventory: React.FC = () => {
  const { selectedStoreId, dateRange } = useStore();
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inventoryData, setInventoryData] = useState<SmartInventoryData | null>(null);
  const [cameras, setCameras] = useState<CameraFeed[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Selected entities for drilldowns
  const [selectedShelfId, setSelectedShelfId] = useState<string>('shf-a4');
  const [selectedCameraId, setSelectedCameraId] = useState<string>('CAM-02');

  // Modals & Drawers state
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [taskTargetProduct, setTaskTargetProduct] = useState<Product | null>(null);
  const [taskTargetShelf, setTaskTargetShelf] = useState<ShelfDetail | null>(null);

  const [inspectedShelf, setInspectedShelf] = useState<ShelfDetail | null>(null);
  const [isInspectShelfModalOpen, setIsInspectShelfModalOpen] = useState(false);

  const [inspectedProduct, setInspectedProduct] = useState<Product | null>(null);
  const [isProductDrawerOpen, setIsProductDrawerOpen] = useState(false);

  const loadData = useCallback(async (isRefresh: boolean = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [inv, cams] = await Promise.all([
        apiService.getSmartInventoryData(selectedStoreId, dateRange, departmentFilter),
        apiService.getStoreCameras(selectedStoreId),
      ]);
      setInventoryData(inv);
      setLoadError(null);
      setCameras(cams);
    } catch (err) {
      if (!isAbort(err)) setLoadError(err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedStoreId, dateRange, departmentFilter]);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  useLiveRefresh(['shelf.', 'inventory.', 'task.', 'alert.'], () => void loadData(true));

  const handleRefresh = async () => {
    await loadData(true);
  };

  // Task Actions
  const handleCreateTask = async (taskInput: Omit<ReplenishmentTask, 'id' | 'taskCode' | 'createdAt'>) => {
    try {
      const newTask = await apiService.createReplenishmentTask(selectedStoreId, taskInput);
      setInventoryData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          tasks: [newTask, ...prev.tasks],
          kpis: {
            ...prev.kpis,
            pendingTasksCount: prev.kpis.pendingTasksCount + 1,
          },
        };
      });
    } catch (err) {
      console.error('Error creating task:', err);
    }
  };

  const handleUpdateTaskStatus = async (
    taskId: string,
    status: ReplenishmentTaskStatus,
    cameraVerified: boolean = false
  ) => {
    try {
      await apiService.updateTaskStatus(taskId, status, status === 'completed' ? 'Just now' : undefined);
      setInventoryData((prev) => {
        if (!prev) return null;
        const updatedTasks = prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status,
                completedAt: status === 'completed' ? 'Just now' : t.completedAt,
                cameraVerified: cameraVerified ? true : t.cameraVerified,
                cameraVerifiedAt: cameraVerified ? 'Just now' : t.cameraVerifiedAt,
              }
            : t
        );
        const pendingCount = updatedTasks.filter((t) => t.status !== 'completed').length;
        return {
          ...prev,
          tasks: updatedTasks,
          kpis: {
            ...prev.kpis,
            pendingTasksCount: pendingCount,
          },
        };
      });
    } catch (err) {
      console.error('Error updating task:', err);
    }
  };

  // Alert Actions
  const handleAcknowledgeAlert = (alertId: string) => {
    setInventoryData((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        alerts: prev.alerts.map((a) => (a.id === alertId ? { ...a, status: 'acknowledged' } : a)),
      };
    });
    apiService.acknowledgeAlert(alertId, selectedStoreId);
  };

  const handleResolveAlert = (alertId: string) => {
    setInventoryData((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        alerts: prev.alerts.map((a) => (a.id === alertId ? { ...a, status: 'resolved' } : a)),
      };
    });
    apiService.resolveAlert(alertId, selectedStoreId);
  };

  const handleCreateTaskFromAlert = (alert: InventoryAlert) => {
    const matchingShelf = inventoryData?.shelves.find((s) => s.id === alert.shelfId) || null;
    const matchingProduct = inventoryData?.products.find((p) => p.shelfId === alert.shelfId) || null;
    setTaskTargetShelf(matchingShelf);
    setTaskTargetProduct(matchingProduct);
    setIsCreateTaskModalOpen(true);
  };

  if (loadError && !inventoryData) {
    return <BackendState error={loadError} onRetry={() => void loadData(true)} what="Smart Inventory" />;
  }

  if (isLoading || !inventoryData) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-12 rounded-xl bg-slate-200" />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-96 rounded-xl bg-slate-200" />
      </div>
    );
  }

  // Filtered products list matching search query
  const displayProducts = inventoryData?.products.filter((p) => {
    if (!searchQuery) return true;
    return (
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.shelfCode.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }) || [];

  const selectedShelf = inventoryData?.shelves.find((s) => s.id === selectedShelfId) || null;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* 1. Sleek Action Bar */}
      <InventoryHeader
        departmentFilter={departmentFilter}
        setDepartmentFilter={setDepartmentFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        inventoryData={inventoryData}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onOpenCreateTask={() => {
          setTaskTargetProduct(null);
          setTaskTargetShelf(null);
          setIsCreateTaskModalOpen(true);
        }}
      />

      {/* 2. Key Inventory Metrics (Single Row of 6 Cards) */}
      <InventoryKpis data={inventoryData} isLoading={isLoading} />

      {/* 3. Live Optical Shelf Camera Feed (Left) & Planogram match Inspector (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        {IS_DEMO_MODE ? (
          <LiveShelfCameraMonitoring
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onSelectCameraId={setSelectedCameraId}
            selectedShelf={selectedShelf}
          />
        ) : (
          <LiveShelfCameraReal
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onSelectCameraId={setSelectedCameraId}
            selectedShelf={selectedShelf}
          />
        )}

        {inventoryData && (
          <PlanogramComplianceSection
            planograms={inventoryData.planograms}
            selectedShelfId={selectedShelfId}
            onSelectShelfId={(shelfId) => {
              setSelectedShelfId(shelfId);
              const sh = inventoryData.shelves.find((s) => s.id === shelfId);
              if (sh) setSelectedCameraId(sh.associatedCameraId);
            }}
            alertsSlot={
              <InventoryAlertsSection
                embedded
                alerts={inventoryData.alerts}
                onAcknowledgeAlert={handleAcknowledgeAlert}
                onResolveAlert={handleResolveAlert}
                onCreateTaskFromAlert={handleCreateTaskFromAlert}
              />
            }
          />
        )}
      </div>

      {/* 4. Shelves (Left) & Restock Tasks (Right) */}
      {inventoryData && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
          <ShelfMonitoringGrid
            shelves={inventoryData.shelves}
            selectedShelfId={selectedShelfId}
            onSelectShelf={(id) => {
              setSelectedShelfId(id);
              const sh = inventoryData.shelves.find((s) => s.id === id);
              if (sh) setSelectedCameraId(sh.associatedCameraId);
            }}
            onInspectShelfModal={(shelf) => {
              setInspectedShelf(shelf);
              setIsInspectShelfModalOpen(true);
            }}
            onSelectCamera={(camId) => setSelectedCameraId(camId)}
          />

          <div className="relative min-h-[420px]">
            <div className="xl:absolute xl:inset-0">
              <RestockingTaskManagement
                tasks={inventoryData.tasks}
                onUpdateTaskStatus={handleUpdateTaskStatus}
                onOpenCreateTaskModal={() => {
                  setTaskTargetProduct(null);
                  setTaskTargetShelf(null);
                  setIsCreateTaskModalOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 5. Product Availability */}
      {inventoryData && (
        <ProductAvailabilityTable
          products={displayProducts}
          onSelectProduct={(product) => {
            setInspectedProduct(product);
            setIsProductDrawerOpen(true);
          }}
          onCreateTaskForProduct={(product) => {
            setTaskTargetProduct(product);
            setTaskTargetShelf(inventoryData.shelves.find((s) => s.id === product.shelfId) || null);
            setIsCreateTaskModalOpen(true);
          }}
        />
      )}

      {/* Modals & Drawers */}
      {inventoryData && (
        <CreateTaskModal
          isOpen={isCreateTaskModalOpen}
          onClose={() => {
            setIsCreateTaskModalOpen(false);
            setTaskTargetProduct(null);
            setTaskTargetShelf(null);
          }}
          staffList={inventoryData.staff}
          products={inventoryData.products}
          shelves={inventoryData.shelves}
          initialProduct={taskTargetProduct}
          initialShelf={taskTargetShelf}
          onSaveTask={handleCreateTask}
          existingTasks={inventoryData.tasks}
        />
      )}

      <ShelfInspectionModal
        shelf={inspectedShelf}
        isOpen={isInspectShelfModalOpen}
        onClose={() => setIsInspectShelfModalOpen(false)}
        products={inventoryData?.products || []}
        onCreateTask={(shelf) => {
          setTaskTargetShelf(shelf);
          const p = inventoryData?.products.find((prod) => prod.shelfId === shelf.id) || null;
          setTaskTargetProduct(p);
          setIsCreateTaskModalOpen(true);
        }}
      />

      <ProductDetailDrawer
        product={inspectedProduct}
        isOpen={isProductDrawerOpen}
        onClose={() => setIsProductDrawerOpen(false)}
        onCreateTask={(product) => {
          setTaskTargetProduct(product);
          setTaskTargetShelf(inventoryData?.shelves.find((s) => s.id === product.shelfId) || null);
          setIsCreateTaskModalOpen(true);
        }}
      />
    </div>
  );
};

export default SmartInventory;
