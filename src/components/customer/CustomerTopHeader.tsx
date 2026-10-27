import React, { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Bot,
  Check,
  ChevronDown,
  HandHelping,
  Home,
  MapPin,
  Search,
  ShoppingBag,
  ShoppingCart,
  TicketPercent,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { CustomerStorePublic } from '../../types/retail';
import { useCart } from '../../services/customer/cart';
import { useConnectivity } from '../../services/api/client';
import type { OpenStatus } from '../../services/customer/types';

interface Props {
  store: CustomerStorePublic;
  stores: CustomerStorePublic[];
  openStatus: OpenStatus | null;
  onSelectStore: (storeId: string) => void;
}

const DESKTOP_NAV_LINKS = [
  { to: '/customer', label: 'Home', icon: Home, exact: true },
  { to: '/customer/products', label: 'Products', icon: Search, exact: false },
  { to: '/customer/offers', label: 'Offers', icon: TicketPercent, exact: false },
  { to: '/customer/map', label: 'Store Map', icon: MapPin, exact: false },
  { to: '/customer/copilot', label: 'AI Copilot', icon: Bot, exact: false },
  { to: '/customer/help', label: 'Help', icon: HandHelping, exact: false },
];

export const CustomerTopHeader: React.FC<Props> = ({ store, stores, openStatus, onSelectStore }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const location = useLocation();
  const items = useCart(store.id);
  const conn = useConnectivity();
  const online = conn.state !== 'offline' && conn.state !== 'not_configured';

  return (
    <header className="sticky top-0 z-30 border-b border-[#E2E8F0] bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
        {/* Brand & Store Selector */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/customer"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
            aria-label="RetailEdge home"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2563EB] text-white shadow-sm">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div className="hidden sm:block">
              <span className="block text-sm font-extrabold tracking-tight text-[#0F172A]">
                Retail<span className="text-[#2563EB]">Edge</span>
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-[#64748B]">
                Customer PWA
              </span>
            </div>
          </Link>

          <div className="h-5 w-[1px] bg-[#E2E8F0] hidden sm:block" />

          {/* Store Selector Dropdown */}
          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="group flex min-w-0 items-center gap-1.5 rounded-xl border border-transparent px-2 py-1 text-left transition-colors hover:border-[#E2E8F0] hover:bg-slate-50"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-label={`Store: ${store.name}. Change store`}
              data-testid="store-selector"
            >
              <div className="min-w-0">
                <span className="flex items-center gap-1 text-xs font-bold leading-none text-[#0F172A]">
                  <span className="truncate max-w-[140px] sm:max-w-[200px]">{store.name || 'Select a store'}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-slate-400 group-hover:text-blue-600" />
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#64748B]">
                  {openStatus?.verified ? (
                    <span className={`font-semibold ${openStatus.status === 'open' ? 'text-[#16A34A]' : 'text-[#EF4444]'}`}>
                      ● {openStatus.label}
                    </span>
                  ) : (
                    <span className="truncate max-w-[130px] sm:max-w-[180px]">{store.city || store.branch || 'In-store'}</span>
                  )}
                </span>
              </div>
            </button>

            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={() => setPickerOpen(false)} />
                <div
                  className="absolute left-0 z-50 mt-2 w-72 space-y-1.5 rounded-2xl border border-[#E2E8F0] bg-white p-2 shadow-2xl"
                  role="listbox"
                  aria-label="Choose a store"
                >
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Choose your store
                  </p>
                  {stores.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">No stores are available.</p>}
                  {stores.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={s.id === store.id}
                      onClick={() => {
                        setPickerOpen(false);
                        if (s.id !== store.id) onSelectStore(s.id);
                      }}
                      className={`flex w-full items-start justify-between gap-2 rounded-xl border p-2.5 text-left text-xs transition-colors ${
                        s.id === store.id ? 'border-blue-500 bg-blue-50/60' : 'border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-[#0F172A]">{s.name}</span>
                        <span className="block truncate text-[11px] text-[#64748B]">
                          {[s.address, s.city].filter(Boolean).join(', ') || s.code}
                        </span>
                        {s.isDemo && (
                          <span className="mt-0.5 block text-[10px] font-bold uppercase text-amber-700">Demo store</span>
                        )}
                      </span>
                      {s.id === store.id && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Desktop customer navigation">
          {DESKTOP_NAV_LINKS.map((link) => {
            const active = link.exact
              ? location.pathname === link.to || location.pathname === `${link.to}/`
              : location.pathname.startsWith(link.to);
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.exact}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? 'bg-blue-50 text-[#2563EB] shadow-sm'
                    : 'text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{link.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Right Actions: Live Status & Cart */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              online ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
            title={online ? 'Connected to the store server' : conn.lastError ?? 'Offline'}
            data-testid="connection-indicator"
          >
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span>{online ? 'Live' : 'Offline'}</span>
          </span>

          <Link
            to="/customer/cart"
            className="relative flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:text-[#2563EB]"
            aria-label={`Cart, ${items.length} items`}
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Cart</span>
            {items.length > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#2563EB] px-1 text-[10px] font-bold text-white">
                {items.length > 9 ? '9+' : items.length}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
};
