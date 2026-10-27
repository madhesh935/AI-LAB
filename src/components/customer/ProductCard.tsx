import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Package, ShoppingCart, Tag } from 'lucide-react';
import type { ProductCard as ProductCardData } from '../../services/customer/types';
import { cart, useCart } from '../../services/customer/cart';
import { formatMinor, locationText } from '../../services/customer/format';
import { absoluteUrl } from '../../services/api/config';
import { AvailabilityBadge, QuantityStepper } from './CustomerUi';

/** Catalog photos are shipped with the shopper app (`public/products`), so they load from this origin. */
function catalogImageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('/products/')) return url;
  return absoluteUrl(url);
}

export const ProductImage: React.FC<{ product: Pick<ProductCardData, 'imageUrl' | 'name'>; className?: string }> = ({
  product,
  className = 'h-32 w-full',
}) => {
  const [failed, setFailed] = React.useState(false);
  const src = catalogImageSrc(product.imageUrl);
  React.useEffect(() => {
    setFailed(false);
  }, [src]);
  return src && !failed ? (
    <img
      src={src}
      alt={product.name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${className} object-contain transition-transform duration-200 group-hover:scale-105`}
    />
  ) : (
    <div className={`${className} flex items-center justify-center bg-slate-50 text-slate-300`} aria-hidden>
      <Package className="h-10 w-10 text-slate-300" />
    </div>
  );
};

export const CartControl: React.FC<{
  storeId: string;
  product: { id: string; name: string };
  onAdded?: (name: string) => void;
  full?: boolean;
}> = ({ storeId, product, onAdded, full = true }) => {
  const items = useCart(storeId);
  const line = items.find((i) => i.productId === product.id);

  if (line) {
    return (
      <div className={full ? 'w-full' : ''}>
        <QuantityStepper
          value={line.quantity}
          label={product.name}
          onChange={(n) => cart.setQuantity(storeId, product.id, n)}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cart.add(storeId, product);
        onAdded?.(product.name);
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2563EB] px-3 font-semibold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95 ${
        full ? 'h-9 w-full text-xs' : 'h-8 text-xs'
      }`}
      aria-label={`Add ${product.name} to cart`}
    >
      <ShoppingCart className="h-3.5 w-3.5" />
      <span>Add</span>
    </button>
  );
};

export const ProductCard: React.FC<{
  product: ProductCardData;
  storeId: string;
  onAdded?: (name: string) => void;
  layout?: 'vertical' | 'horizontal';
}> = ({ product, storeId, onAdded, layout = 'vertical' }) => {
  const where = locationText(product.location);
  const hasDiscount =
    product.price.listPriceMinor !== null &&
    product.price.effectivePriceMinor !== null &&
    product.price.effectivePriceMinor < product.price.listPriceMinor;
  const discountPercent = hasDiscount
    ? Math.round(
        ((product.price.listPriceMinor! - product.price.effectivePriceMinor!) /
          product.price.listPriceMinor!) *
          100
      )
    : 0;

  if (layout === 'horizontal') {
    return (
      <article
        className="group flex gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
        data-testid="product-card"
      >
        <Link
          to={`/customer/products/${encodeURIComponent(product.id)}`}
          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-50 p-1"
          aria-label={`Open ${product.name}`}
        >
          <ProductImage product={product} className="h-full w-full" />
          {hasDiscount && (
            <span className="absolute left-1 top-1 rounded bg-[#EF4444] px-1 py-0.5 text-[9px] font-bold text-white">
              {discountPercent}% OFF
            </span>
          )}
        </Link>
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div>
            <Link to={`/customer/products/${encodeURIComponent(product.id)}`} className="block">
              <h3 className="line-clamp-2 text-xs font-semibold leading-snug text-[#0F172A] group-hover:text-[#2563EB]">
                {product.name}
              </h3>
              <p className="truncate text-[11px] text-[#64748B]">
                {[product.brand, product.pack?.label].filter(Boolean).join(' · ')}
              </p>
            </Link>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-[#0F172A]">
                {formatMinor(product.price.effectivePriceMinor)}
              </span>
              {hasDiscount && (
                <span className="text-[11px] text-[#94A3B8] line-through">
                  {formatMinor(product.price.listPriceMinor!)}
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <AvailabilityBadge availability={product.availability} />
            <div className="w-24">
              <CartControl storeId={storeId} product={product} onAdded={onAdded} full />
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="group relative flex h-full flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
      data-testid="product-card"
    >
      {/* Top Image & Badges */}
      <div className="relative">
        <Link
          to={`/customer/products/${encodeURIComponent(product.id)}`}
          className="flex h-32 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-50/80 p-2"
          aria-label={`Open ${product.name}`}
        >
          <ProductImage product={product} className="h-full w-full" />
        </Link>

        {/* Discount Badge */}
        {hasDiscount && (
          <span className="absolute left-1.5 top-1.5 rounded-lg bg-[#EF4444] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
            {discountPercent}% OFF
          </span>
        )}

        {/* Active offer badge if available */}
        {!hasDiscount && product.price.conditionalOffers.length > 0 && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-lg bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#2563EB] border border-blue-100 shadow-sm">
            <Tag className="h-2.5 w-2.5" />
            <span className="truncate max-w-[80px]">
              {product.price.conditionalOffers[0].label ?? 'Offer'}
            </span>
          </span>
        )}
      </div>

      {/* Product Information */}
      <div className="flex flex-1 flex-col justify-between pt-2.5">
        <div>
          {/* Brand & Pack size */}
          <p className="truncate text-[11px] font-medium text-[#64748B]">
            {[product.brand, product.pack?.label].filter(Boolean).join(' · ') || product.category || 'Grocery'}
          </p>

          {/* Product Name (Fixed 2-line max height for alignment) */}
          <Link
            to={`/customer/products/${encodeURIComponent(product.id)}`}
            className="block"
            title={product.name}
          >
            <h3 className="line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-snug text-[#0F172A] transition-colors group-hover:text-[#2563EB]">
              {product.name}
            </h3>
          </Link>

          {/* Price Alignment */}
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-sm font-bold text-[#0F172A]">
              {formatMinor(product.price.effectivePriceMinor)}
            </span>
            {hasDiscount && (
              <span className="text-[11px] text-[#94A3B8] line-through">
                {formatMinor(product.price.listPriceMinor!)}
              </span>
            )}
          </div>

          {/* Availability */}
          <div className="mt-1">
            <AvailabilityBadge availability={product.availability} />
          </div>

          {/* Location Chip */}
          <div className="mt-1.5">
            {product.mapped ? (
              <Link
                to={`/customer/map?product=${encodeURIComponent(product.id)}`}
                className="group/loc flex items-center gap-1 text-[11px] font-medium text-[#64748B] hover:text-[#2563EB]"
                title="View location on store map"
              >
                <MapPin className="h-3 w-3 shrink-0 text-[#2563EB]" />
                <span className="truncate underline-offset-2 group-hover/loc:underline">
                  {where ?? 'Aisle Location'}
                </span>
              </Link>
            ) : (
              <p className="flex items-center gap-1 text-[11px] text-slate-400">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{where ?? 'Unmapped'}</span>
              </p>
            )}
          </div>
        </div>

        {/* Bottom Action Area (Always aligned) */}
        <div className="pt-3">
          <CartControl storeId={storeId} product={product} onAdded={onAdded} full />
        </div>
      </div>
    </article>
  );
};
