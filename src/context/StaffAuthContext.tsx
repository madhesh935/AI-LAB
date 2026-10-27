/**
 * RetailEdge AI — Staff PWA context.
 *
 * There is NO authentication. "Signing in" selects which employee this phone acts as (a demo context recorded for audit);
 * it is not a verified identity and anyone who can open the app can pick anyone. In REAL mode the roster comes from the backend.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import type { StaffEmployee } from '../types/retail';
import { INITIAL_STAFF_EMPLOYEES, staffService } from '../services/staffService';
import { offlineStorage } from '../services/offlineStorage';
import { IS_DEMO_MODE } from '../services/api/config';
import { ApiError, apiGet, isAbort } from '../services/api/client';
import { adaptEmployee } from '../services/api/adapters/workforce';
import { Dto, arr, items, str } from '../services/api/adapters/common';

export interface StaffAuthContextType {
  currentStaff: StaffEmployee | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Selects an employee by id / email / name. The PIN is ignored: there is no authentication. */
  login: (identifier: string, pinOrPass?: string) => Promise<boolean>;
  quickSwitchUser: (employeeId: string) => void;
  logout: () => void;
  availableStaffList: StaffEmployee[];
  storeId: string;
  storeName: string;
  /** The store holds seeded fixture data (shown with a DEMO strip). */
  storeIsDemo: boolean;
  /** Roster could not be loaded (backend offline / not configured). */
  rosterError: ApiError | null;
  reloadRoster: () => void;
}

const StaffAuthContext = createContext<StaffAuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'retalledge_staff_active_session_id';
const STORE_KEY = 'retalledge_staff_store';
const DEMO_STORE = 'store-blr-104';

function initialStoreId(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('store');
    if (q) {
      localStorage.setItem(STORE_KEY, q);
      return q;
    }
    return localStorage.getItem(STORE_KEY) ?? '';
  } catch {
    return '';
  }
}

export const StaffAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentStaff, setCurrentStaff] = useState<StaffEmployee | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [availableStaffList, setAvailableStaffList] = useState<StaffEmployee[]>([]);
  const [storeId, setStoreId] = useState<string>(IS_DEMO_MODE ? DEMO_STORE : initialStoreId());
  const [storeName, setStoreName] = useState<string>(IS_DEMO_MODE ? 'T. Nagar, Chennai (demo)' : '');
  const [storeIsDemo, setStoreIsDemo] = useState<boolean>(IS_DEMO_MODE);
  const [rosterError, setRosterError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { pathname } = useLocation();
  const onStaffRoute = /^\/staff(\/|$)/.test(pathname);

  // Roster. Only mounts the work on the staff routes (the admin console never needs it).
  useEffect(() => {
    if (!onStaffRoute && !IS_DEMO_MODE) {
      setIsLoading(false);
      return undefined;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        let list: StaffEmployee[];
        if (IS_DEMO_MODE) {
          const fixtures = staffService.getEmployees(DEMO_STORE).filter((e) => e.isActive);
          list = fixtures.length ? fixtures : INITIAL_STAFF_EMPLOYEES;
        } else {
          let sid = storeId;
          if (!sid) {
            // Public endpoint (also reachable from a phone on the LAN): the first listed store is the default.
            const pub = arr<Dto>(await apiGet<Dto[]>('/api/public/stores', undefined, ctrl.signal));
            sid = str(pub[0]?.id);
            setStoreName(str(pub[0]?.name));
            setStoreIsDemo(pub[0]?.isDemo === true);
            setStoreId(sid);
          } else {
            const pub = arr<Dto>(await apiGet<Dto[]>('/api/public/stores', undefined, ctrl.signal)).find((s) => s.id === sid);
            setStoreName(str(pub?.name, sid));
            setStoreIsDemo(pub?.isDemo === true);
          }
          const staff = items<Dto>(await apiGet<Dto>(`/api/stores/${encodeURIComponent(sid)}/staff`, undefined, ctrl.signal));
          list = staff.filter((e) => e.isActive !== false).map((e) => adaptEmployee(e));
          if (list.length === 0) {
            // The remembered / first store has no employees (e.g. an empty demo shell): use the first store that does, so the login is never a dead end.
            const all = arr<Dto>(await apiGet<Dto[]>('/api/public/stores', undefined, ctrl.signal));
            for (const st of all) {
              if (str(st.id) === sid) continue;
              const other = items<Dto>(await apiGet<Dto>(`/api/stores/${encodeURIComponent(str(st.id))}/staff`, undefined, ctrl.signal)).filter((e) => e.isActive !== false);
              if (other.length > 0) {
                sid = str(st.id);
                setStoreId(sid);
                setStoreName(str(st.name));
                setStoreIsDemo(st.isDemo === true);
                try { localStorage.setItem(STORE_KEY, sid); } catch { /* storage unavailable */ }
                list = other.map((e) => adaptEmployee(e));
                break;
              }
            }
          }
        }
        setAvailableStaffList(list);
        setRosterError(null);

        const storedId = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
        const match = storedId ? list.find((e) => e.id === storedId) : undefined;
        if (match) setCurrentStaff(match);
        else if (IS_DEMO_MODE && list[0]) {
          setCurrentStaff(list[0]);
          sessionStorage.setItem(AUTH_STORAGE_KEY, list[0].id);
        }
      } catch (e) {
        if (ctrl.signal.aborted || isAbort(e)) return;
        setRosterError(e instanceof ApiError ? e : new ApiError('offline', String(e)));
      } finally {
        if (!ctrl.signal.aborted) setIsLoading(false);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, onStaffRoute]);

  const select = useCallback(
    (found: StaffEmployee) => {
      setCurrentStaff(found);
      sessionStorage.setItem(AUTH_STORAGE_KEY, found.id);
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, found.id);
      } catch {
        /* storage unavailable */
      }
    },
    [],
  );

  const login = useCallback(
    async (identifier: string): Promise<boolean> => {
      const clean = identifier.trim().toLowerCase();
      const found = availableStaffList.find((s) => s.id.toLowerCase() === clean || s.email.toLowerCase() === clean || s.name.toLowerCase().includes(clean));
      if (!found) return false;
      select(found);
      return true;
    },
    [availableStaffList, select],
  );

  const quickSwitchUser = useCallback(
    (employeeId: string) => {
      const target = availableStaffList.find((s) => s.id === employeeId);
      if (target) {
        select(target);
        window.dispatchEvent(new CustomEvent('retalledge:staff-switched', { detail: { staff: target } }));
      }
    },
    [availableStaffList, select],
  );

  const logout = useCallback(() => {
    if (currentStaff) offlineStorage.clearUserPrivateData(currentStaff.id);
    setCurrentStaff(null);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, [currentStaff]);

  const reloadRoster = useCallback(() => {
    setIsLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <StaffAuthContext.Provider
      value={{ currentStaff, isAuthenticated: !!currentStaff, isLoading, login, quickSwitchUser, logout, availableStaffList, storeId, storeName, storeIsDemo, rosterError, reloadRoster }}
    >
      {children}
    </StaffAuthContext.Provider>
  );
};

export const useStaffAuth = (): StaffAuthContextType => {
  const context = useContext(StaffAuthContext);
  if (!context) {
    throw new Error('useStaffAuth must be used within a StaffAuthProvider');
  }
  return context;
};
