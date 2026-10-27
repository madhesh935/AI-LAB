import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Check,
  Clock,
  HandHelping,
  Loader2,
  MapPin,
  Navigation,
  RotateCcw,
  Scale,
  Send,
  Tag,
  User,
} from 'lucide-react';
import { useCustomer } from '../../components/customer/customerContext';
import { CartControl, ProductImage } from '../../components/customer/ProductCard';
import { AvailabilityBadge, PriceTag } from '../../components/customer/CustomerUi';
import { customerApi } from '../../services/customer/api';
import { getRoutePrefs, useCart } from '../../services/customer/cart';
import { ApiError, isAbort } from '../../services/api/client';
import { formatMinor, locationText } from '../../services/customer/format';
import type { CopilotReply, CopilotStatus } from '../../services/customer/types';

const NAME = 'RetailEdge Shopping Copilot';
const WELCOME =
  "Hi! I'm your RetailEdge Shopping Copilot. I can help you find products, compare prices, discover active offers, and plan the shortest walking route to your items.";

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reply?: CopilotReply;
  failed?: boolean;
}

const chatKey = (storeId: string) => `retailedge_copilot_chat_v1:${storeId}`;

function loadChat(storeId: string): Msg[] {
  try {
    const raw = sessionStorage.getItem(chatKey(storeId));
    if (raw) return JSON.parse(raw) as Msg[];
  } catch {
    /* ignore */
  }
  return [{ id: 'welcome', role: 'assistant', text: WELCOME }];
}

export const CustomerCopilot: React.FC = () => {
  const { storeId, showToast } = useCustomer();
  const items = useCart(storeId);
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [messages, setMessages] = useState<Msg[]>(() => loadChat(storeId));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new AbortController();
    customerApi
      .copilotStatus(c.signal)
      .then(setStatus)
      .catch(() => undefined);
    return () => c.abort();
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(chatKey(storeId), JSON.stringify(messages.slice(-30)));
    } catch {
      /* ignore */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, storeId]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const send = async (text: string) => {
    const message = text.trim().slice(0, 500);
    if (!message || sending) return;
    const history = messages
      .filter((m) => m.id !== 'welcome' && !m.failed)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', text: message };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setSending(true);
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    try {
      const prefs = getRoutePrefs(storeId);
      const reply = await customerApi.copilotChat(
        {
          storeId,
          message,
          history,
          cartProductIds: items.map((i) => i.productId),
          startNodeId: prefs.from ?? prefs.start,
        },
        c.signal
      );
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', text: reply.answer, reply }]);
    } catch (e) {
      if (isAbort(e)) return;
      const text =
        e instanceof ApiError && e.kind === 'offline'
          ? 'I cannot reach the store server right now, so I cannot answer with live prices or availability. Please connect to the store Wi-Fi or try again shortly.'
          : e instanceof ApiError && e.status === 429
          ? 'You are sending messages very quickly. Please wait a moment and try again.'
          : `Sorry, I could not process that request right now. You can try asking another question or speak to a store team member.`;
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'assistant', text, failed: true }]);
    } finally {
      if (ctrl.current === c) setSending(false);
    }
  };

  const onlyWelcome = messages.length === 1;

  return (
    <div className="flex min-h-[calc(100vh-12rem)] flex-col space-y-4">
      {/* Copilot Header */}
      <header className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2563EB] text-white shadow-sm">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-bold text-[#0F172A]">{status?.name ?? NAME}</h1>
              <span className="flex h-2 w-2 rounded-full bg-green-500" title="Online" />
            </div>
            <p className="text-xs text-[#64748B]">
              Intelligent in-store supermarket assistant · live shelf data
            </p>
          </div>
        </div>

        {!onlyWelcome && (
          <button
            type="button"
            onClick={() => setMessages([{ id: 'welcome', role: 'assistant', text: WELCOME }])}
            className="inline-flex items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A] transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
        )}
      </header>

      {/* Chat Messages Stream */}
      <div className="flex-1 space-y-4 overflow-y-auto" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'assistant' && (
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB]">
                <Bot className="h-4 w-4" />
              </div>
            )}

            <div className={`max-w-[88%] sm:max-w-[75%] space-y-2.5 ${m.role === 'user' ? 'items-end' : ''}`}>
              <div
                className={`whitespace-pre-line rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed shadow-sm ${
                  m.role === 'user'
                    ? 'rounded-br-sm bg-[#2563EB] text-white'
                    : m.failed
                    ? 'rounded-bl-sm border border-red-200 bg-red-50 text-red-800'
                    : 'rounded-bl-sm border border-[#E2E8F0] bg-white text-[#0F172A]'
                }`}
              >
                {m.text}
              </div>

              {/* Structured Response Cards */}
              {m.reply && (
                <ReplyCards
                  reply={m.reply}
                  storeId={storeId}
                  onAdded={(n) => showToast(`${n} added to cart`)}
                />
              )}
            </div>

            {m.role === 'user' && (
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#64748B]">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 pl-11 text-xs text-[#64748B]">
            <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
            <span>Consulting live store inventory and shelf map...</span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Floating Bottom Input Bar */}
      <div className="sticky bottom-16 md:bottom-2 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-2 shadow-lg"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder="Ask about a product, price comparison, offer, or shelf location..."
            aria-label="Ask the shopping copilot"
            className="min-w-0 flex-1 bg-transparent px-3 text-xs sm:text-sm text-[#0F172A] placeholder-slate-400 focus:outline-none"
            data-testid="copilot-input"
          />

          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2563EB] text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

const ReplyCards: React.FC<{
  reply: CopilotReply;
  storeId: string;
  onAdded: (name: string) => void;
}> = ({ reply, storeId, onAdded }) => {
  const { products, route, offers, help, checkout } = reply.cards;

  return (
    <div className="space-y-3 pt-1">
      {/* 1. Structured Product Cards */}
      {products.length > 0 && (
        <div className="space-y-2">
          {products.slice(0, 3).map((p) => {
            const loc = locationText(p.location);
            return (
              <div
                key={p.id}
                className="flex gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-sm"
                data-testid="copilot-product"
              >
                <Link
                  to={`/customer/products/${encodeURIComponent(p.id)}`}
                  className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-50 p-1 flex items-center justify-center"
                >
                  <ProductImage product={p} className="h-full w-full" />
                </Link>

                <div className="min-w-0 flex-1 flex flex-col justify-between">
                  <div>
                    <Link
                      to={`/customer/products/${encodeURIComponent(p.id)}`}
                      className="line-clamp-2 text-xs sm:text-sm font-semibold text-[#0F172A] hover:text-[#2563EB]"
                    >
                      {p.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <PriceTag price={p.price} />
                      <AvailabilityBadge availability={p.availability} />
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-[#64748B]">
                      <MapPin className="h-3 w-3 text-[#2563EB] shrink-0" />
                      <span className="truncate">{loc ?? 'Location unmapped'}</span>
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="w-24">
                      <CartControl storeId={storeId} product={p} onAdded={onAdded} full />
                    </div>
                    {p.mapped && (
                      <Link
                        to={`/customer/map?product=${encodeURIComponent(p.id)}`}
                        className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#E2E8F0] px-3 text-xs font-semibold text-[#0F172A] hover:bg-slate-50 hover:text-[#2563EB]"
                      >
                        <Navigation className="h-3.5 w-3.5 text-[#2563EB]" />
                        <span>View on Map</span>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. Structured Route Card */}
      {route && route.routeAvailable && (
        <div className="space-y-2.5 rounded-2xl border border-blue-200 bg-blue-50/60 p-3.5 text-xs shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#0F172A]">
              Walking Route: {route.stops.length} {route.stops.length === 1 ? 'stop' : 'stops'} · {route.totalDistanceM} m
            </span>
            <span className="text-[11px] text-[#2563EB] font-semibold">Shortest Path</span>
          </div>

          <ol className="list-decimal space-y-1 pl-4 text-[#334155]">
            {route.stops.slice(0, 5).map((s) => (
              <li key={s.shelfId}>
                <strong>{s.products.map((x) => x.name).join(', ') || `Shelf ${s.shelfLabel}`}</strong> —{' '}
                {[s.aisleLabel, `Shelf ${s.shelfLabel}`].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ol>

          <Link
            to={
              reply.cards.routeProductIds.length === 1
                ? `/customer/map?product=${encodeURIComponent(reply.cards.routeProductIds[0])}`
                : '/customer/map'
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 py-2 font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>Open Store Map</span>
          </Link>
        </div>
      )}

      {/* 3. Structured Offers Cards */}
      {offers.length > 0 && (
        <div className="space-y-1.5">
          {offers.slice(0, 3).map((o) => (
            <div
              key={o.id}
              className="flex items-start gap-2.5 rounded-2xl border border-green-200 bg-green-50 p-3 text-xs"
            >
              <Tag className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" />
              <div className="min-w-0 flex-1">
                <span className="block font-bold text-green-900">{o.title}</span>
                <span className="text-green-800">
                  {o.label ?? o.description}
                  {o.offerPriceMinor !== null ? ` · ${formatMinor(o.offerPriceMinor)}` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Structured Staff Help Card */}
      {help && (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 shadow-sm">
          <div className="flex items-center gap-2">
            <HandHelping className="h-4 w-4 text-amber-700" />
            <p className="font-bold">Request Staff Assistance: {help.categoryLabel}</p>
          </div>
          <p className="text-amber-800">Review the pre-filled request before sending to in-store staff:</p>
          <Link
            to={`/customer/help?${new URLSearchParams({
              category: help.category,
              ...(help.productId ? { productId: help.productId } : {}),
              ...(help.productName ? { productName: help.productName } : {}),
              ...(help.zone ? { zone: help.zone } : {}),
              message: help.message,
            })}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 py-2 font-bold text-white shadow-sm hover:bg-blue-700"
          >
            <span>Review & Send Help Request</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* 5. Checkout Wait Information */}
      {checkout && (
        <Link
          to="/customer/queues"
          className="flex items-center gap-2.5 rounded-2xl border border-[#E2E8F0] bg-white p-3 text-xs shadow-sm hover:border-blue-300 transition-colors"
        >
          <Clock className="h-4 w-4 text-[#2563EB]" />
          <span className="text-[#0F172A]">
            {checkout.dataAvailable && checkout.recommendedCounterName
              ? `Fastest checkout line right now: ${checkout.recommendedCounterName}`
              : 'Checkout lines are currently operating normally.'}
          </span>
        </Link>
      )}

      {(reply.providerNotice || reply.disclaimer) && (
        <p className="text-[10px] text-[#94A3B8]">{reply.providerNotice ?? reply.disclaimer}</p>
      )}
    </div>
  );
};

export default CustomerCopilot;
