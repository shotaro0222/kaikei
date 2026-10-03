import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Account, Settings } from "./types";

interface AppState {
  accounts: Account[];
  settings: Settings;
  year: number;
  setYear: (y: number) => void;
  reload: () => Promise<void>;
  toast: (msg: string) => void;
  counts: { unprocessed: number; unlinked: number };
  refreshCounts: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider missing");
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [year, setYearState] = useState<number>(() => Number(localStorage.getItem("kaikei.year")) || new Date().getFullYear());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [counts, setCounts] = useState({ unprocessed: 0, unlinked: 0 });
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const [a, s] = await Promise.all([api.get<Account[]>("/accounts"), api.get<Settings>("/settings")]);
    setAccounts(a);
    setSettings(s);
  }, []);

  const refreshCounts = useCallback(() => {
    api
      .get<{ unprocessed_bank: number; unlinked_receipts: number }>(`/reports/dashboard?year=${year}`)
      .then((d) => setCounts({ unprocessed: d.unprocessed_bank, unlinked: d.unlinked_receipts }))
      .catch(() => {});
  }, [year]);

  useEffect(() => {
    reload().then(() => setReady(true));
  }, [reload]);
  useEffect(refreshCounts, [refreshCounts]);

  const setYear = (y: number) => {
    localStorage.setItem("kaikei.year", String(y));
    setYearState(y);
  };

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3000);
  }, []);

  if (!ready) return <div className="main muted">読み込み中…</div>;
  return (
    <Ctx.Provider value={{ accounts, settings, year, setYear, reload, toast, counts, refreshCounts }}>
      {children}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

/** location.hash ベースのルーティング */
export function useRoute(): { path: string; params: URLSearchParams } {
  const parse = () => {
    const h = window.location.hash.replace(/^#/, "") || "/";
    const [path, q] = h.split("?");
    return { path, params: new URLSearchParams(q ?? "") };
  };
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export function navigate(path: string) {
  window.location.hash = path;
}

/** 非同期データ取得の小さなフック */
export function useFetch<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
