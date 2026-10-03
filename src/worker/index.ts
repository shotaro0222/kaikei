import { Hono } from "hono";
import PostalMime from "postal-mime";
import type { AppEnv, Env } from "./env";
import { HttpError } from "./db";
import { authRoutes, requireAuth } from "./auth";
import { masterRoutes } from "./routes/master";
import { journalRoutes } from "./routes/journals";
import { receiptRoutes, storeReceipt } from "./routes/receipts";
import { bankRoutes, syncBankAccount } from "./routes/bank";
import { assetRoutes } from "./routes/assets";
import { closingRoutes } from "./routes/closing";
import { backupJson, reportRoutes } from "./routes/reports";

const app = new Hono<AppEnv>().basePath("/api");

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: "サーバーエラーが発生しました" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.use("*", requireAuth);
app.get("/me", (c) => c.json({ ok: true }));
app.route("/", masterRoutes);
app.route("/", journalRoutes);
app.route("/", receiptRoutes);
app.route("/", bankRoutes);
app.route("/", assetRoutes);
app.route("/", closingRoutes);
app.route("/", reportRoutes);
app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default {
  fetch: app.fetch,

  /** Cron: API 連携口座の明細取得 ＋ R2 への日次バックアップ */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const r = await env.DB.prepare("SELECT * FROM bank_accounts WHERE active = 1 AND provider <> 'csv' AND provider <> 'manual' AND credentials IS NOT NULL").all();
        for (const ba of r.results) {
          try {
            await syncBankAccount(env, ba as never);
          } catch (e) {
            console.error(`bank sync failed: ${(ba as { name: string }).name}`, e);
          }
        }
        const day = new Date().toISOString().slice(0, 10);
        await env.RECEIPTS.put(`backups/${day}.json`, await backupJson(env), { httpMetadata: { contentType: "application/json" } });
      })(),
    );
  },

  /**
   * Email Workers: 領収書受付用アドレス宛のメールの添付ファイル（PDF・画像）を R2 に保存。
   * Cloudflare Email Routing でこの Worker に転送してください。
   */
  async email(message: ForwardableEmailMessage, env: Env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const mail = await PostalMime.parse(raw);
    const from = mail.from?.name || mail.from?.address || message.from;
    const date = mail.date ? new Date(mail.date) : new Date();
    const jst = new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    let saved = 0;
    for (const att of mail.attachments ?? []) {
      if (!/^(application\/pdf|image\/)/.test(att.mimeType)) continue;
      const data = typeof att.content === "string" ? new TextEncoder().encode(att.content).buffer : (att.content as ArrayBuffer);
      await storeReceipt(env, { name: att.filename || "attachment", type: att.mimeType, data: data as ArrayBuffer }, { issued_date: jst, partner: from, memo: `メール受信: ${mail.subject ?? ""}`.slice(0, 200) }, "email");
      saved++;
    }
    if (saved === 0) console.log(`no receipt attachments in mail from ${message.from}`);
  },
} satisfies ExportedHandler<Env>;
