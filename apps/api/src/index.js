/**
 * 学员学籍信息平台（演示）— API Worker 入口
 * Phase 1：单 Worker 网关 —— /api/v1/* API，/admin/* 后台静态包，/* 前台静态包
 */
import { createRouter } from "./router.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerStudentRoutes } from "./routes/students.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerAdminUserRoutes } from "./routes/admin-users.js";
import { registerPhotoRoutes } from "./routes/photos.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { json, err } from "./core/http.js";

const router = createRouter();
registerAuthRoutes(router);
registerStudentRoutes(router);
registerQueryRoutes(router);
registerAdminUserRoutes(router);
registerPhotoRoutes(router);
registerSettingsRoutes(router);

/** MIME 表（静态代理用） */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 健康检查
    if (url.pathname === "/api/v1/health") {
      return json({ ok: true, t: Date.now() });
    }

    // API 路由
    if (url.pathname.startsWith("/api/")) {
      try {
        const handled = await router.dispatch(req, env, ctx);
        if (handled) return handled;
        return err(404, "E_NOT_FOUND", "接口不存在");
      } catch (e) {
        console.error("API error", url.pathname, e?.stack || e);
        return err(500, "E_SERVER", "服务器内部错误");
      }
    }

    // 静态：优先查 ASSETS binding（Phase 1 单网关模式）
    if (env.ASSETS) {
      try {
        // /admin → /admin/index.html
        const assetRes = await env.ASSETS.fetch(new Request(req, { redirect: "manual" }));
        if (assetRes.status !== 404) {
          const res = new Response(assetRes.body, assetRes);
          res.headers.set("X-Content-Type-Options", "nosniff");
          const ct = res.headers.get("Content-Type") || "";
          if (ct.includes("text/html")) {
            res.headers.set("X-Frame-Options", "DENY");
          } else {
            res.headers.set("Cache-Control", "public, max-age=3600");
          }
          res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
          return res;
        }
      } catch (e) {
        console.error("ASSETS fetch error", e?.stack || e);
      }
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  },
};
