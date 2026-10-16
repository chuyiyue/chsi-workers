/** auth 路由：login / logout / me（学员账号改由管理后台建号，自助注册与公开查询已下线） */
import { KV, ERROR_CODES } from "@chsi/shared";
import { ok, err } from "../core/http.js";
import { asObject } from "../core/validator.js";
import { hashPassword, safeEqual, verifyPassword } from "../core/password.js";
import { createSession, destroySession, getSessionUser, sessionHeaders } from "../core/session.js";
import { getJSON } from "../core/kv.js";
import { clientIp, rateLimit } from "../middleware/rateLimit.js";

const RESERVED = "admin";

export function registerAuthRoutes(router) {
  router.add("POST", "/api/login", async ({ req, env }) => {
    const ip = clientIp(req);
    if (!(await rateLimit(env, "login", ip, 10))) {
      return err(429, ERROR_CODES.RATE_LIMITED, "登录尝试过于频繁，请稍后再试");
    }
    const b = asObject(await safeJson(req));
    const u = (typeof b.username === "string" ? b.username.trim() : "").slice(0, 64);
    const p = typeof b.password === "string" ? b.password : "";
    if (!u || !p) return err(400, ERROR_CODES.VALIDATION, "请输入用户名和密码");

    if (u.toLowerCase() === RESERVED) {
      const adminPw = typeof env.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : "";
      if (!adminPw) return err(503, ERROR_CODES.SERVER, "管理员密码尚未设置，请联系系统部署人员");
      const h = await hashPassword(p, "admin-fixed-salt");
      const target = await hashPassword(adminPw, "admin-fixed-salt");
      if (!safeEqual(h, target)) return err(401, ERROR_CODES.UNAUTHORIZED, "用户名或密码错误");
      const user = { id: "admin", username: "admin", role: "admin", tokenVersion: 0 };
      const token = await createSession(env, user);
      return ok({ user: { username: "admin", role: "admin" } }, sessionHeaders(token));
    }

    const stored = await getJSON(env.KV, KV.user(u));
    const okPw = stored && typeof stored.passHash === "string" && typeof stored.salt === "string"
      ? await verifyPassword(p, stored.passHash, stored.salt) : false;
    if (!okPw) {
      // 统一报错，不区分「用户存在但密码错」
      return err(401, ERROR_CODES.UNAUTHORIZED, "用户名或密码错误");
    }
    const token = await createSession(env, stored);
    return ok({ user: pickUser(stored) }, sessionHeaders(token));
  });

  router.add("POST", "/api/logout", async ({ req, env }) => {
    await destroySession(env, req);
    return ok({}, sessionHeaders(""));
  });

  router.add("GET", "/api/me", async ({ req, env }) => {
    const s = await getSessionUser(env, req);
    if (!s) return err(401, ERROR_CODES.UNAUTHORIZED, "未登录");
    return ok({ user: { username: s.username, role: s.role, orgId: s.orgId || "demo" } });
  });
}

function pickUser(u) {
  return { id: u.id, username: u.username, role: u.role, orgId: u.orgId, createdAt: u.createdAt };
}

async function safeJson(req) {
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return {}; // 仅接受 JSON
  try { return await req.json(); } catch { return {}; }
}
