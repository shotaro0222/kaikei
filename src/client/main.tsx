import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { api, setUnauthorizedHandler } from "./api";
import { AppProvider, useApp, useRoute } from "./app";
import { YearPicker } from "./components";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { QuickEntryPage } from "./pages/QuickEntry";
import { JournalsPage } from "./pages/Journals";
import { BankPage } from "./pages/Bank";
import { ReceiptsPage } from "./pages/Receipts";
import { RulesPage } from "./pages/Rules";
import { ApportionPage } from "./pages/Apportion";
import { AssetsPage } from "./pages/Assets";
import { ClosingPage } from "./pages/Closing";
import { ReportsPage } from "./pages/Reports";
import { TaxReturnPage } from "./pages/TaxReturn";
import { SettingsPage } from "./pages/Settings";

const NAV: Array<{ group: string; items: Array<{ path: string; label: string; badge?: "unprocessed" | "unlinked" }> }> = [
  { group: "日々の記帳", items: [
    { path: "/", label: "ホーム" },
    { path: "/quick", label: "かんたん入力" },
    { path: "/bank", label: "銀行・カード明細", badge: "unprocessed" },
    { path: "/receipts", label: "領収書・請求書", badge: "unlinked" },
    { path: "/journals", label: "仕訳帳" },
  ] },
  { group: "設定・ルール", items: [
    { path: "/rules", label: "自動仕訳ルール" },
    { path: "/apportion", label: "家事按分" },
    { path: "/assets", label: "固定資産台帳" },
  ] },
  { group: "決算・申告", items: [
    { path: "/reports", label: "帳簿・レポート" },
    { path: "/closing", label: "決算整理" },
    { path: "/tax", label: "確定申告書類" },
    { path: "/settings", label: "事業者設定" },
  ] },
];

const PAGES: Record<string, () => React.ReactElement> = {
  "/": DashboardPage,
  "/quick": QuickEntryPage,
  "/journals": JournalsPage,
  "/bank": BankPage,
  "/receipts": ReceiptsPage,
  "/rules": RulesPage,
  "/apportion": ApportionPage,
  "/assets": AssetsPage,
  "/closing": ClosingPage,
  "/reports": ReportsPage,
  "/tax": TaxReturnPage,
  "/settings": SettingsPage,
};

function Shell({ onLogout }: { onLogout: () => void }) {
  const { path } = useRoute();
  const { counts, settings } = useApp();
  const [open, setOpen] = useState(false);
  const Page = PAGES[path] ?? DashboardPage;
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="layout">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">帳</span> かいけい帳
        </div>
        {settings.business_name && <div className="muted small" style={{ padding: "0 10px" }}>{settings.business_name}</div>}
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((it) => (
                <a key={it.path} href={`#${it.path}`} className={path === it.path ? "active" : ""}>
                  <span>{it.label}</span>
                  {it.badge && counts[it.badge] > 0 && <span className="badge">{counts[it.badge]}</span>}
                </a>
              ))}
            </div>
          ))}
          <div className="nav-group" />
          <a href="#" onClick={(e) => (e.preventDefault(), onLogout())}>
            ログアウト
          </a>
        </nav>
      </aside>
      <main className="main">
        <div className="topbar">
          <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="メニュー">
            ☰
          </button>
          <div className="spacer" />
          <YearPicker />
        </div>
        <Page />
      </main>
    </div>
  );
}

function Root() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    api
      .get("/me")
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);
  if (authed === null) return null;
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;
  return (
    <AppProvider>
      <Shell onLogout={() => api.post("/logout").finally(() => setAuthed(false))} />
    </AppProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
