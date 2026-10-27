import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, Sparkles, Tag, X } from 'lucide-react';
import { customerApi } from '../../services/customer/api';
import type { Suggestions } from '../../services/customer/types';
import { isAbort } from '../../services/api/client';
import { formatMinor } from '../../services/customer/format';

const DEBOUNCE_MS = 250;

interface Props {
  storeId: string;
  initial?: string;
  autoFocus?: boolean;
  /** Called on Enter / "search all". Defaults to opening the Products page with ?q=. */
  onSubmit?: (q: string) => void;
}

/**
 * Real-time product search: keystrokes are debounced, every new query aborts the request before it, so suggestions always
 * belong to what is currently typed.
 */
export const SearchBox: React.FC<Props> = ({ storeId, initial = '', autoFocus, onSubmit }) => {
  const navigate = useNavigate();
  const listId = useId();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Suggestions | null>(null);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(initial), [initial]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1 || !open) {
      setResult(null);
      setBusy(false);
      return undefined;
    }
    const ctrl = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      customerApi
        .suggestions(storeId, term, ctrl.signal)
        .then((r) => {
          setResult(r);
          setFailed(false);
        })
        .catch((e) => {
          if (!isAbort(e)) setFailed(true);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, storeId, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const submit = (term: string) => {
    setOpen(false);
    const clean = term.trim();
    if (onSubmit) onSubmit(clean);
    else navigate(clean ? `/customer/products?q=${encodeURIComponent(clean)}` : '/customer/products');
  };

  const hasAny = !!result && (result.products.length > 0 || result.brands.length > 0 || result.categories.length > 0);

  return (
    <div ref={boxRef} className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <label className="flex h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            placeholder="Search products, brands or categories..."
            aria-label="Search products, brands or categories"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open && hasAny}
            maxLength={120}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            data-testid="customer-search"
          />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Searching" />}
          {q && !busy && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setResult(null);
              }}
              className="rounded-full p-1 text-slate-400 hover:text-slate-700"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </form>

      {open && q.trim() && (result || failed) && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-14 z-40 max-h-[60vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          {failed && !result && <p className="px-2 py-3 text-xs text-slate-500">Suggestions are unavailable right now. Press Enter to search.</p>}
          {result?.didYouMean && (
            <button
              type="button"
              onClick={() => {
                setQ(result.didYouMean ?? '');
                submit(result.didYouMean ?? '');
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-600" /> Did you mean <strong className="text-blue-700">{result.didYouMean}</strong>?
            </button>
          )}
          {result && !hasAny && !result.didYouMean && (
            <p className="px-2 py-3 text-xs text-slate-500">No products match "{q.trim()}" in this store. Try a brand or category name.</p>
          )}
          {result?.products.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                setOpen(false);
                navigate(`/customer/products/${encodeURIComponent(p.id)}`);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{[p.brand, p.category].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-slate-700">{formatMinor(p.price.effectivePriceMinor)}</span>
            </button>
          ))}
          {result && (result.brands.length > 0 || result.categories.length > 0) && (
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-2 pb-1 pt-2">
              {result.categories.map((c) => (
                <button
                  key={`c-${c.name}`}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/customer/products?category=${encodeURIComponent(c.name)}`);
                  }}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                >
                  {c.name} ({c.productCount})
                </button>
              ))}
              {result.brands.map((b) => (
                <button
                  key={`b-${b.name}`}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/customer/products?brand=${encodeURIComponent(b.name)}`);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"
                >
                  <Tag className="h-3 w-3" /> {b.name}
                </button>
              ))}
            </div>
          )}
          {hasAny && (
            <button type="button" onClick={() => submit(q)} className="mt-1 w-full rounded-xl px-2 py-2 text-center text-xs font-semibold text-blue-700 hover:bg-blue-50">
              See all results for "{q.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
};
