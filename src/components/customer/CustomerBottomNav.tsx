import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Bot, Home, MapPin, Search, ShoppingCart } from 'lucide-react';
import { useCart } from '../../services/customer/cart';

export const CustomerBottomNav: React.FC<{ storeId: string }> = ({ storeId }) => {
  const location = useLocation();
  const items = useCart(storeId);
  const cartLines = items.length;

  const navItems = [
    { to: '/customer', label: 'Home', icon: Home, exact: true, badge: 0 },
    { to: '/customer/products', label: 'Products', icon: Search, exact: false, badge: 0 },
    { to: '/customer/cart', label: 'Cart', icon: ShoppingCart, exact: false, badge: cartLines },
    { to: '/customer/map', label: 'Map', icon: MapPin, exact: false, badge: 0 },
    { to: '/customer/copilot', label: 'Copilot', icon: Bot, exact: false, badge: 0 },
  ];

  return (
    <nav
      aria-label="Customer navigation"
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-[#E2E8F0] bg-white/95 px-1 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-md items-center justify-around">
        {navItems.map((item) => {
          const active = item.exact ? location.pathname === item.to || location.pathname === `${item.to}/` : location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-full flex-1 flex-col items-center justify-center py-1 text-[11px] transition-colors ${
                active ? 'font-bold text-[#2563EB]' : 'font-medium text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <span className="relative">
                <span className={`block rounded-xl p-1 ${active ? 'bg-blue-50' : ''}`}>
                  <Icon className="h-5 w-5" />
                </span>
                {item.badge > 0 && (
                  <span
                    className="absolute -right-1.5 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#2563EB] px-1 text-[10px] font-bold text-white"
                    aria-label={`${item.badge} items in cart`}
                    data-testid="cart-badge"
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </span>
              <span className="mt-0.5 tracking-tight">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};
