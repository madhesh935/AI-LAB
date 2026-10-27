import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { StoreProvider } from './context/StoreContext';
import { StaffAuthProvider } from './context/StaffAuthContext';
import { staffQueryClient } from './services/staffApiService';

// Admin Dashboard Components
import { AppLayout } from './components/layout/AppLayout';
import { OverviewDashboard } from './pages/OverviewDashboard';
import { ShopperAnalytics } from './pages/ShopperAnalytics';
import { SmartInventory } from './pages/SmartInventory';
import { QueueIntelligence } from './pages/QueueIntelligence';
import { AiInsights } from './pages/AiInsights';
import { ReportsAnalytics } from './pages/ReportsAnalytics';
import { StaffManagement } from './pages/StaffManagement';
import { StoreCopilot } from './pages/StoreCopilot';

// Staff PWA Mobile Shell & Route Guard
import { StaffLayout } from './components/staff-pwa/StaffLayout';
import { StaffProtectedRoute } from './components/staff-pwa/StaffProtectedRoute';

// Customer PWA Mobile Shell
import { CustomerLayout } from './components/customer/CustomerLayout';

// Lazy-loaded Staff PWA Routes
const StaffLogin = lazy(() => import('./pages/staff/StaffLogin').then((m) => ({ default: m.StaffLogin })));
const StaffHome = lazy(() => import('./pages/staff/StaffHome').then((m) => ({ default: m.StaffHome })));
const StaffTasks = lazy(() => import('./pages/staff/StaffTasks').then((m) => ({ default: m.StaffTasks })));
const StaffTaskDetail = lazy(() => import('./pages/staff/StaffTaskDetail').then((m) => ({ default: m.StaffTaskDetail })));
const StaffSchedule = lazy(() => import('./pages/staff/StaffSchedule').then((m) => ({ default: m.StaffSchedule })));
const StaffAttendance = lazy(() => import('./pages/staff/StaffAttendance').then((m) => ({ default: m.StaffAttendance })));
const StaffNotifications = lazy(() => import('./pages/staff/StaffNotifications').then((m) => ({ default: m.StaffNotifications })));
const StaffProfile = lazy(() => import('./pages/staff/StaffProfile').then((m) => ({ default: m.StaffProfile })));

// Lazy-loaded Customer PWA Routes
const CustomerHome = lazy(() => import('./pages/customer/CustomerHome').then((m) => ({ default: m.CustomerHome })));
const CustomerProducts = lazy(() => import('./pages/customer/CustomerProducts').then((m) => ({ default: m.CustomerProducts })));
const CustomerProductDetail = lazy(() => import('./pages/customer/CustomerProductDetail').then((m) => ({ default: m.CustomerProductDetail })));
const CustomerMap = lazy(() => import('./pages/customer/CustomerMap').then((m) => ({ default: m.CustomerMap })));
const CustomerCart = lazy(() => import('./pages/customer/CustomerCart').then((m) => ({ default: m.CustomerCart })));
const CustomerCopilot = lazy(() => import('./pages/customer/CustomerCopilot').then((m) => ({ default: m.CustomerCopilot })));
const CustomerQueues = lazy(() => import('./pages/customer/CustomerQueues').then((m) => ({ default: m.CustomerQueues })));
const CustomerOffers = lazy(() => import('./pages/customer/CustomerOffers').then((m) => ({ default: m.CustomerOffers })));
const CustomerHelp = lazy(() => import('./pages/customer/CustomerHelp').then((m) => ({ default: m.CustomerHelp })));

// Mobile loading fallback
const StaffLoadingFallback = () => (
  <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 space-y-3">
    <div className="h-8 w-8 rounded-full border-3 border-blue-600 border-t-transparent animate-spin" />
    <span className="text-xs font-semibold text-slate-500">Loading RetailEdge Staff...</span>
  </div>
);

const CustomerLoadingFallback = () => (
  <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 space-y-3">
    <div className="h-8 w-8 rounded-full border-3 border-blue-600 border-t-transparent animate-spin" />
    <span className="text-xs font-semibold text-slate-500">Loading RetailEdge Shopper...</span>
  </div>
);

export const App: React.FC = () => {
  return (
    <BrowserRouter>
    <QueryClientProvider client={staffQueryClient}>
      <StoreProvider>
        <StaffAuthProvider>
            <Routes>
              {/* ========================================================= */}
              {/* 1. STANDALONE MOBILE-FIRST STAFF PWA ROUTES (/staff/*)    */}
              {/* ========================================================= */}
              <Route
                path="/staff/login"
                element={
                  <Suspense fallback={<StaffLoadingFallback />}>
                    <StaffLogin />
                  </Suspense>
                }
              />

              <Route
                path="/staff"
                element={
                  <StaffProtectedRoute>
                    <StaffLayout />
                  </StaffProtectedRoute>
                }
              >
                <Route
                  index
                  element={
                    <Suspense fallback={<StaffLoadingFallback />}>
                      <StaffHome />
                    </Suspense>
                  }
                />
                <Route
                  path="tasks"
                  element={
                    <Suspense fallback={<StaffLoadingFallback />}>
                      <StaffTasks />
                    </Suspense>
                  }
                />
                <Route
                  path="tasks/:id"
                  element={
                    <Suspense fallback={<StaffLoadingFallback />}>
                      <StaffTaskDetail />
                    </Suspense>
                  }
                />
                <Route
                  path="schedule"
                  element={
                    <Suspense fallback={<StaffLoadingFallback />}>
                      <StaffSchedule />
                    </Suspense>
                  }
                />
                <Route
                  path="attendance"
                  element={
                    <Suspense fallback={<StaffLoadingFallback />}>
                      <StaffAttendance />
                    </Suspense>
                  }
                />
                <Route
                  path="notifications"
                  element={
                    <Suspense fallback={<StaffLoadingFallback />}>
                      <StaffNotifications />
                    </Suspense>
                  }
                />
                <Route
                  path="profile"
                  element={
                    <Suspense fallback={<StaffLoadingFallback />}>
                      <StaffProfile />
                    </Suspense>
                  }
                />
              </Route>

              {/* ========================================================= */}
              {/* 2. STANDALONE CUSTOMER PROGRESSIVE WEB APP (/customer/*)  */}
              {/* ========================================================= */}
              <Route path="/customer" element={<CustomerLayout />}>
                <Route
                  index
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerHome />
                    </Suspense>
                  }
                />
                <Route
                  path="products"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerProducts />
                    </Suspense>
                  }
                />
                <Route
                  path="products/:id"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerProductDetail />
                    </Suspense>
                  }
                />
                <Route
                  path="map"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerMap />
                    </Suspense>
                  }
                />
                <Route
                  path="cart"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerCart />
                    </Suspense>
                  }
                />
                <Route path="list" element={<Navigate to="/customer/cart" replace />} />
                <Route
                  path="copilot"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerCopilot />
                    </Suspense>
                  }
                />
                <Route
                  path="queues"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerQueues />
                    </Suspense>
                  }
                />
                <Route
                  path="offers"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerOffers />
                    </Suspense>
                  }
                />
                <Route
                  path="help"
                  element={
                    <Suspense fallback={<CustomerLoadingFallback />}>
                      <CustomerHelp />
                    </Suspense>
                  }
                />
                <Route path="*" element={<Navigate to="/customer" replace />} />
              </Route>

              {/* ========================================================= */}
              {/* 3. ADMIN DASHBOARD DESKTOP / ENTERPRISE ROUTES (/)        */}
              {/* ========================================================= */}
              <Route path="/" element={<AppLayout />}>
                {/* 1. Main Overview Dashboard */}
                <Route index element={<OverviewDashboard />} />

                {/* 2. Shopper Analytics Route */}
                <Route path="shopper-analytics" element={<ShopperAnalytics />} />

                {/* 3. Smart Inventory Route */}
                <Route path="smart-inventory" element={<SmartInventory />} />

                {/* 4. Queue Intelligence Route */}
                <Route path="queue-intelligence" element={<QueueIntelligence />} />

                {/* 5. AI Insights Route */}
                <Route path="ai-insights" element={<AiInsights />} />

                {/* 7. Reports & Analytics Route */}
                <Route path="reports" element={<ReportsAnalytics />} />

                {/* 8. Staff Management Route */}
                <Route path="staff-management" element={<StaffManagement />} />

                {/* 9. Store Copilot Route */}
                <Route path="store-copilot" element={<StoreCopilot />} />

                {/* Catch-all redirect */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
        </StaffAuthProvider>
      </StoreProvider>
    </QueryClientProvider>
    </BrowserRouter>
  );
};

export default App;
