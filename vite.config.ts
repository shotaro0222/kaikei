import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    // ローカル開発では D1/R2 をローカル実行。Workers AI もリモートで使う場合は CF_REMOTE_BINDINGS=1 で起動（要 wrangler login）
    cloudflare({ remoteBindings: process.env.CF_REMOTE_BINDINGS === "1" }),
  ],
});
