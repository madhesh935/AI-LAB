import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Apple,
  ArrowRight,
  Bot,
  ChevronRight,
  Coffee,
  Cookie,
  Croissant,
  HandHelping,
  Heart,
  Home as HomeIcon,
  MapPin,
  Package,
  ShoppingBag,
  Sparkles,
  Tag,
  TicketPercent,
} from 'lucide-react';
import { useCustomer } from '../../components/customer/customerContext';
import { SearchBox } from '../../components/customer/SearchBox';
import { CartControl, ProductCard } from '../../components/customer/ProductCard';
import { EmptyState, SectionHeader, StaleNotice } from '../../components/customer/CustomerUi';
import { BackendState } from '../../components/common/BackendState';
import { Skeleton } from '../../components/common/Skeleton';
import { formatMinor } from '../../services/customer/format';

interface VisualCategory {
  id: string;
  name: string;
  icon: React.ElementType;
  bg: string;
  textColor: string;
}

const PREDEFINED_CATEGORIES: VisualCategory[] = [
  { id: 'dairy', name: 'Dairy & Eggs', icon: Package, bg: 'bg-amber-50', textColor: 'text-amber-700' },
  { id: 'groceries', name: 'Groceries', icon: ShoppingBag, bg: 'bg-blue-50', textColor: 'text-[#2563EB]' },
  { id: 'snacks', name: 'Snacks', icon: Cookie, bg: 'bg-orange-50', textColor: 'text-orange-600' },
  { id: 'beverages', name: 'Beverages', icon: Coffee, bg: 'bg-emerald-50', textColor: 'text-emerald-700' },
  { id: 'personal_care', name: 'Personal Care', icon: Heart, bg: 'bg-pink-50', textColor: 'text-pink-600' },
  { id: 'household', name: 'Household', icon: HomeIcon, bg: 'bg-indigo-50', textColor: 'text-indigo-600' },
  { id: 'bakery', name: 'Bakery', icon: Croissant, bg: 'bg-yellow-50', textColor: 'text-yellow-700' },
  { id: 'fresh_produce', name: 'Fresh Produce', icon: Apple, bg: 'bg-green-50', textColor: 'text-green-700' },
];

export const CustomerHome: React.FC = () => {
  const navigate = useNavigate();
  const { storeId, showToast, home } = useCustomer();
  const data = home.data;

  return (
    <div className="space-y-6">
      {/* 2. Welcome Banner (Promotional Hero Section) */}
      <section
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700 p-5 sm:p-7 text-white shadow-md"
        aria-label="Welcome banner"
      >
        {/* Soft background accents */}
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute right-12 bottom-0 h-32 w-32 rounded-full bg-blue-400/20 blur-xl" />

        <div className="relative z-10 max-w-xl space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-blue-100 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-blue-200" />
            <span>Smart In-Store Shopping</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
            Shop Smart. Live Better.
          </h1>

          <p className="text-xs sm:text-sm text-blue-100 leading-relaxed max-w-md">
            Find products, discover offers, and shop with ease. Navigate aisles effortlessly with AI guidance.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              to="/customer/offers"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#2563EB] shadow-sm transition-transform hover:scale-105 active:scale-95"
            >
              <TicketPercent className="h-4 w-4" />
              <span>View Offers</span>
            </Link>

            <Link
              to="/customer/map"
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-800/60 border border-blue-400/30 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm hover:bg-blue-800/80 transition-colors"
            >
              <MapPin className="h-4 w-4 text-blue-200" />
              <span>Indoor Map</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 3. Smart Search Bar */}
      <section aria-label="Product search">
        <SearchBox storeId={storeId} />
      </section>

      {/* 4. Quick Action Shortcuts */}
      <section aria-label="Quick actions" className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <Link
          to="/customer/map"
          className="group flex flex-col sm:flex-row items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-3 text-center sm:text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB] group-hover:scale-110 transition-transform">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="block text-xs font-bold text-[#0F172A]">Store Map</span>
            <span className="hidden sm:block text-[11px] text-[#64748B]">Indoor navigation</span>
          </div>
        </Link>

        <Link
          to="/customer/copilot"
          className="group flex flex-col sm:flex-row items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-3 text-center sm:text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 group-hover:scale-110 transition-transform">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="block text-xs font-bold text-[#0F172A]">Ask Copilot</span>
            <span className="hidden sm:block text-[11px] text-[#64748B]">AI assistant</span>
          </div>
        </Link>

        <Link
          to="/customer/help"
          className="group flex flex-col sm:flex-row items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-3 text-center sm:text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 group-hover:scale-110 transition-transform">
            <HandHelping className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="block text-xs font-bold text-[#0F172A]">Staff Help</span>
            <span className="hidden sm:block text-[11px] text-[#64748B]">Request assistance</span>
          </div>
        </Link>
      </section>

      {/* 5. Shop by Category */}
      <section className="space-y-3" aria-label="Shop by category">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Shop by Category</h2>
            <p className="text-xs text-[#64748B]">Browse our wide range of groceries and essentials</p>
          </div>
          <Link
            to="/customer/products"
            className="flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
          >
            <span>See All</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-8 gap-2.5 sm:gap-3">
          {PREDEFINED_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            // Map category name to query
            const queryName = cat.name.split(' ')[0];
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => navigate(`/customer/products?category=${encodeURIComponent(queryName)}`)}
                className="group flex flex-col items-center rounded-2xl border border-[#E2E8F0] bg-white p-2.5 text-center shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${cat.bg} ${cat.textColor} transition-transform group-hover:scale-110`}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <span className="mt-2 text-center text-[11px] font-semibold text-[#0F172A] line-clamp-1 group-hover:text-[#2563EB]">
                  {cat.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* State notices */}
      {home.stale && <StaleNotice savedAt={home.savedAt} what="The store overview" />}
      {!!home.error && !data && <BackendState error={home.error} onRetry={home.reload} what="The store overview" compact />}
      {home.loading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
        </div>
      )}

      {/* 6. Today's Offers (Horizontal Cards) */}
      {data && data.offers.length > 0 && (
        <section className="space-y-3" aria-label="Today's offers">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <TicketPercent className="h-4 w-4 text-[#16A34A]" />
                <h2 className="text-base font-bold text-[#0F172A]">Today's Offers</h2>
              </div>
              <p className="text-xs text-[#64748B]">Exclusive in-store discounts and promotions</p>
            </div>
            <Link
              to="/customer/offers"
              className="flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
            >
              <span>All Offers</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.offers.slice(0, 3).map((o) => (
              <div
                key={o.id}
                className="group flex flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-white p-3.5 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-50 text-[#16A34A]">
                    <TicketPercent className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {o.label && (
                      <span className="inline-block rounded-md bg-green-50 px-2 py-0.5 text-[10px] font-bold text-[#16A34A] border border-green-200">
                        {o.label}
                      </span>
                    )}
                    <h3 className="mt-1 line-clamp-1 text-xs sm:text-sm font-semibold text-[#0F172A]">
                      {o.title}
                    </h3>
                    <p className="line-clamp-1 text-[11px] text-[#64748B]">
                      {o.description || (o.validUntil ? `Valid until ${new Date(o.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'In-store special')}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                  <div>
                    {o.offerPriceMinor !== null ? (
                      <span className="text-sm font-bold text-[#16A34A]">
                        {formatMinor(o.offerPriceMinor)}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-[#2563EB]">Special Deal</span>
                    )}
                  </div>

                  <Link
                    to={o.productId ? `/customer/products/${encodeURIComponent(o.productId)}` : '/customer/offers'}
                    className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-[#2563EB] hover:bg-blue-100 transition-colors"
                  >
                    <span>View</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 7. Recommended Products (Product Carousel / Responsive Grid) */}
      {data && (
        <section className="space-y-3" aria-label="Recommended products">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">Recommended For You</h2>
              <p className="text-xs text-[#64748B]">Popular essentials available on store shelves right now</p>
            </div>
            <Link
              to="/customer/products"
              className="flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
            >
              <span>See All</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {data.featured.length === 0 ? (
            <EmptyState title="No featured products currently listed" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {data.featured.slice(0, 5).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  storeId={storeId}
                  onAdded={(n) => showToast(`${n} added to cart`)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default CustomerHome;
