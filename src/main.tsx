import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// PWA Service Worker Registration for Staff & Customer PWAs
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    // Staff Mobile PWA
    navigator.serviceWorker.register('/sw-staff.js', { scope: '/staff' }).then((reg) => {
      console.log('[RetailEdge Staff PWA] Service Worker registered under scope:', reg.scope);
    }).catch((err) => {
      console.warn('[RetailEdge Staff PWA] Service worker registration error:', err);
    });

    // Customer Shopper PWA
    navigator.serviceWorker.register('/sw-customer.js', { scope: '/customer' }).then((reg) => {
      console.log('[RetailEdge Shopper PWA] Service Worker registered under scope:', reg.scope);
    }).catch((err) => {
      console.warn('[RetailEdge Shopper PWA] Service worker registration error:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
