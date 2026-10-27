import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  CircleDashed,
  CreditCard,
  HandHelping,
  Info,
  Loader2,
  MapPinned,
  MessageCircleQuestion,
  Package,
  PackageX,
  Search,
  ShieldCheck,
  UserCheck,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import { useCustomer } from '../../components/customer/customerContext';
import { customerApi } from '../../services/customer/api';
import { myHelp, useMyHelpRequests, type MyHelpRequest } from '../../services/customer/help';
import { ApiError, newIdempotencyKey, useConnectivity } from '../../services/api/client';
import { relativeTime } from '../../services/customer/format';
import type { AssistanceStatus, AssistanceView } from '../../services/customer/types';

const CATEGORIES: Array<{ id: string; label: string; hint: string; icon: React.ElementType }> = [
  { id: 'cannot_find_product', label: 'Cannot Find Product', hint: 'Staff will guide you to the shelf', icon: Search },
  { id: 'product_information', label: 'Product Information', hint: 'Ingredients, expiration, pack details', icon: Info },
  { id: 'product_not_available', label: 'Product Unavailable', hint: 'Empty shelf - check backroom inventory', icon: PackageX },
  { id: 'checkout_help', label: 'Checkout Help', hint: 'Counter assistance, scanning or billing', icon: CreditCard },
  { id: 'navigation_help', label: 'Navigation Help', hint: 'Find specific aisles or facilities', icon: MapPinned },
  { id: 'other', label: 'Other Assistance', hint: 'General in-store inquiries', icon: MessageCircleQuestion },
];

const STEPS: Array<{ status: AssistanceStatus; label: string }> = [
  { status: 'submitted', label: 'Submitted' },
  { status: 'assigned', label: 'Assigned' },
  { status: 'on_the_way', label: 'On The Way' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'resolved', label: 'Resolved' },
];

export const CustomerHelp: React.FC = () => {
  const { storeId, showToast } = useCustomer();
  const [params] = useSearchParams();
  const conn = useConnectivity();
  const [deviceOnline, setDeviceOnline] = useState(navigator.onLine);
  const online = deviceOnline && conn.state !== 'offline' && conn.state !== 'not_configured';

  const initialCategory = CATEGORIES.some((c) => c.id === params.get('category'))
    ? (params.get('category') as string)
    : 'cannot_find_product';

  const [category, setCategory] = useState(initialCategory);
  const [productId, setProductId] = useState(params.get('productId') ?? '');
  const [productName, setProductName] = useState(params.get('productName') ?? '');
  const [zone, setZone] = useState(params.get('zone') ?? '');
  const [message, setMessage] = useState(params.get('message') ?? '');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemKey = useRef<string>(newIdempotencyKey('help'));
  const mine = useMyHelpRequests(storeId);

  useEffect(() => {
    const on = () => setDeviceOnline(true);
    const off = () => setDeviceOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const cat = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
  const description = message.trim() || `${cat.label}${productName ? `: ${productName}` : ''}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!online) {
      setError('You are offline. Please connect to the store network or ask a nearby team member.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await customerApi.createHelp(
        {
          storeId,
          category,
          description: description.slice(0, 1000),
          aisleOrZone: zone.trim() || undefined,
          productId: productId || undefined,
          productName: productName.trim() || undefined,
          customerContact: contact.trim() || undefined,
        },
        idemKey.current
      );
      const r = res.request;
      myHelp.add({
        ref: r.statusRef,
        requestId: r.requestId,
        storeId,
        categoryLabel: cat.label,
        createdAt: r.submittedAt,
      });
      idemKey.current = newIdempotencyKey('help');
      setMessage('');
      showToast(`Assistance request ${r.requestId} sent to staff!`);
    } catch (err) {
      setError(
        err instanceof ApiError && err.kind === 'offline'
          ? 'Store server could not be reached. Request not sent - please ask a nearby team member.'
          : `Request was not sent: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">Staff Assistance</h1>
        <p className="text-xs sm:text-sm text-[#64748B]">
          Request on-floor help from our store team. Your request is dispatched instantly to staff devices.
        </p>
      </header>

      {/* Responsive layout: 2 columns on Desktop (Requests on right/left, Form on other) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Assistance Request Form (7 cols on Desktop) */}
        <div className="lg:col-span-7 space-y-5">
          <form onSubmit={submit} className="space-y-5">
            {/* Category Grid */}
            <fieldset className="space-y-2.5">
              <legend className="text-sm font-bold text-[#0F172A]">Select Assistance Category</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {CATEGORIES.map((c) => {
                  const Icon = c.icon;
                  const isSelected = category === c.id;
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer flex-col justify-between rounded-2xl border p-3.5 text-left transition-all ${
                        isSelected
                          ? 'border-[#2563EB] bg-blue-50/60 ring-1 ring-[#2563EB] shadow-sm'
                          : 'border-[#E2E8F0] bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={c.id}
                        checked={isSelected}
                        onChange={() => setCategory(c.id)}
                        className="sr-only"
                      />
                      <Icon className={`h-5 w-5 ${isSelected ? 'text-[#2563EB]' : 'text-[#64748B]'}`} />
                      <div className="mt-2">
                        <span className="block text-xs font-bold text-[#0F172A]">{c.label}</span>
                        <span className="mt-0.5 block text-[11px] text-[#64748B] line-clamp-1">{c.hint}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Input Details Card */}
            <div className="space-y-3.5 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                Product (Optional)
                {productId ? (
                  <span className="mt-1 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#2563EB]">
                    <span className="flex items-center gap-1.5 truncate">
                      <Package className="h-4 w-4 shrink-0" />
                      <span>{productName || productId}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setProductId('');
                        setProductName('');
                      }}
                      aria-label="Remove product"
                      className="text-blue-500 hover:text-blue-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                ) : (
                  <input
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    maxLength={160}
                    placeholder="e.g. Amul Butter 500g, Olive Oil"
                    className="mt-1 h-10 w-full rounded-xl border border-[#E2E8F0] px-3 text-xs sm:text-sm text-[#0F172A] focus:outline-none"
                  />
                )}
              </label>

              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                Your Location / Aisle (Optional)
                <input
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  maxLength={160}
                  placeholder="e.g. Aisle 4 near Dairy, or Checkout Counter 2"
                  className="mt-1 h-10 w-full rounded-xl border border-[#E2E8F0] px-3 text-xs sm:text-sm text-[#0F172A] focus:outline-none"
                />
              </label>

              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                Additional Details
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Tell staff what you need or ask any specific questions..."
                  className="mt-1 w-full rounded-xl border border-[#E2E8F0] px-3 py-2 text-xs sm:text-sm text-[#0F172A] focus:outline-none"
                />
              </label>

              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                Contact Info (Optional)
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  maxLength={120}
                  placeholder="Name or phone number if you would like a call back"
                  className="mt-1 h-10 w-full rounded-xl border border-[#E2E8F0] px-3 text-xs sm:text-sm text-[#0F172A] focus:outline-none"
                />
              </label>
            </div>

            {!online && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800" role="status">
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
                <span>You are currently offline. Requests require an active network connection.</span>
              </p>
            )}

            {error && (
              <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700" role="alert">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={sending || !online}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-sm font-bold text-white shadow-md transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-50"
              data-testid="request-staff"
            >
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <HandHelping className="h-5 w-5" />}
              <span>{sending ? 'Dispatching Request...' : 'Send Request to Staff'}</span>
            </button>

            <p className="flex items-center gap-1.5 text-[11px] text-[#94A3B8]">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span>No login or account required. This device keeps a secure local tracking token.</span>
            </p>
          </form>
        </div>

        {/* Right: Active Help Requests & Status Timeline (5 cols on Desktop) */}
        <div className="lg:col-span-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#0F172A]">
            Active Requests ({mine.length})
          </h2>

          {mine.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white p-6 text-center text-xs text-[#64748B]">
              <HandHelping className="mx-auto h-8 w-8 text-slate-300 mb-2" />
              <p className="font-semibold text-[#0F172A]">No active requests</p>
              <p className="mt-1">When you submit a request, live updates from staff will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3" aria-label="Your help requests">
              {mine.map((r) => (
                <RequestStatus key={r.ref} entry={r} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RequestStatus: React.FC<{ entry: MyHelpRequest }> = ({ entry }) => {
  const { helpTick, showToast } = useCustomer();
  const [view, setView] = useState<AssistanceView | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      customerApi
        .getHelp(entry.ref, ctrl.signal)
        .then((v) => {
          setView(v);
          setErr(null);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setErr(e);
        });
    void load();
    const t = setInterval(load, 15000);
    return () => {
      clearInterval(t);
      ctrl.abort();
    };
  }, [entry.ref, helpTick]);

  const cancel = async () => {
    setCancelling(true);
    try {
      setView(await customerApi.cancelHelp(entry.ref));
      showToast('Assistance request cancelled', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not cancel request', 'error');
    } finally {
      setCancelling(false);
      setConfirm(false);
    }
  };

  const notFound = err instanceof ApiError && err.status === 404;
  const finished = view && (view.status === 'resolved' || view.status === 'cancelled');
  const currentIdx = view ? STEPS.findIndex((s) => s.status === view.status) : -1;
  const recorded = new Set<string>(['submitted', ...(view?.history ?? []).map((h) => h.status), ...(view ? [view.status] : [])]);
  const seen = new Set(STEPS.filter((s, i) => recorded.has(s.status) && i <= currentIdx).map((s) => s.status));

  return (
    <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm" data-testid="help-status">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="block text-xs font-bold text-[#0F172A]">
            {view?.categoryLabel ?? entry.categoryLabel}
          </span>
          <span className="font-mono text-[11px] text-[#64748B]">#{entry.requestId}</span>
          <p className="text-[11px] text-[#94A3B8]">Submitted {relativeTime(view?.submittedAt ?? entry.createdAt)}</p>
        </div>

        {view && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              view.status === 'resolved'
                ? 'bg-green-50 text-[#16A34A] border border-green-200'
                : view.status === 'cancelled'
                ? 'bg-slate-100 text-slate-600'
                : view.status === 'on_the_way'
                ? 'bg-[#2563EB] text-white shadow-sm'
                : 'bg-blue-50 text-[#2563EB] border border-blue-200'
            }`}
          >
            {view.statusLabel}
          </span>
        )}
      </div>

      {notFound && <p className="text-xs text-[#64748B]">This request has concluded on the store system.</p>}

      {/* 5-Step Visual Progress Bar */}
      {view && view.status !== 'cancelled' && (
        <div className="pt-2">
          <ol className="flex items-center justify-between gap-1" aria-label="Request progress">
            {STEPS.map((s, idx) => {
              const isPassed = seen.has(s.status);
              const isCurrent = s.status === view.status;
              return (
                <li key={s.status} className="flex flex-1 flex-col items-center gap-1 text-center">
                  {isPassed ? (
                    <CheckCircle2 className={`h-4 w-4 ${isCurrent ? 'text-[#2563EB]' : 'text-[#16A34A]'}`} />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-slate-300" />
                  )}
                  <span
                    className={`text-[9px] leading-tight ${
                      isCurrent
                        ? 'font-bold text-[#2563EB]'
                        : isPassed
                        ? 'font-semibold text-[#0F172A]'
                        : 'text-[#94A3B8]'
                    }`}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {view?.status === 'on_the_way' && (
        <div className="flex items-center gap-2 rounded-xl bg-blue-50 p-2.5 text-xs font-semibold text-[#2563EB] border border-blue-200">
          <UserCheck className="h-4 w-4 shrink-0" />
          <span>A team member has accepted your request and is walking to you now.</span>
        </div>
      )}

      {view?.history && view.history.length > 0 && (
        <p className="text-[11px] text-[#94A3B8]">
          Last update: {view.history[view.history.length - 1].label} · {relativeTime(view.history[view.history.length - 1].at)}
        </p>
      )}

      {/* Action buttons (Cancel, Remove) */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
        {view?.canCancel &&
          (confirm ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={cancelling}
                className="rounded-xl bg-[#EF4444] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="rounded-xl border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
              >
                Keep Request
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="rounded-xl border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:border-red-200 hover:text-[#EF4444] transition-colors"
            >
              Cancel Request
            </button>
          ))}

        {(finished || notFound) && (
          <button
            type="button"
            onClick={() => myHelp.remove(entry.ref)}
            className="rounded-xl border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
          >
            Clear from List
          </button>
        )}
      </div>
    </div>
  );
};

export default CustomerHelp;
