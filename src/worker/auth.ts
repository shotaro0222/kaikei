import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { safeEqual, signToken, verifyToken } from "./lib/crypto";

const COOKIE = "kaikei_session";
const TTL_SEC = 60 * 60 * 24 * 14;

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const { APP_PASSWORD, SESSION_SECRET } = c.env;
  if (!APP_PASSWORD || !SESSION_SECRET) return c.json({ error: "APP_PASSWORD / SESSION_SECRET が未設定です（README 参照）" }, 503);
  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  if (!(await safeEqual(String(body.password ?? ""), APP_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 800)); // 総当たり対策
    return c.json({ error: "パスワードが違います" }, 401);
  }
  const token = await signToken({ exp: Date.now() + TTL_SEC * 1000 }, SESSION_SECRET);
  setCookie(c, COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: TTL_SEC });
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { SESSION_SECRET, APP_PASSWORD } = c.env;
  if (!SESSION_SECRET || !APP_PASSWORD) return c.json({ error: "APP_PASSWORD / SESSION_SECRET が未設定です（README 参照）" }, 503);
  const token = getCookie(c, COOKIE);
  const payload = token ? await verifyToken<{ exp: number }>(token, SESSION_SECRET) : null;
  if (!payload || payload.exp < Date.now()) return c.json({ error: "ログインしてください" }, 401);
  await next();
};
