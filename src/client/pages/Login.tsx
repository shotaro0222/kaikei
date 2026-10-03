import { useState } from "react";
import { api } from "../api";
import { ErrorBox } from "../components";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post("/login", { password });
            onLogin();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand">
          <span className="brand-mark">帳</span> かいけい帳
        </div>
        <p className="muted">個人事業主のための会計・確定申告</p>
        <ErrorBox error={error} />
        <input type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <button className="primary" disabled={busy || !password}>
          ログイン
        </button>
      </form>
    </div>
  );
}
