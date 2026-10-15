/** auth 路由：register / login / logout / me / change-password */
import { KV, ERROR_CODES, SESSION_TTL } from "@chsi/shared";
import { ok, err } from "../core/http.js";
import { username, password as pwOf, asObject } from "../core/validator.js";
import { hashPassword, newSalt, verifyPassword, randHex, safeEqual } from "../core/password.js";
import { createSession, destroySession, getSessionUser, invalidateUserSessions, sessionHeaders } from "../core/session.js";
import { getJSON, putJSON } from "../core/kv.js";
import { verifyTurnstile } from "../middleware/turnstile.js";
import { clientIp, rateLimit } from "../middleware/rateLimit.js";

const RESERVED = "admin";

export function registerAuthRoutes(router) {
  router.add("POST", "/api/register", async ({ req, env }) => {
    const ip = clientIp(req);
    if (!(await rateLimit(env, "register", ip, 5))) {
      return err(429, ERROR_CODES.RATE_LIMITED, "注册过于频繁，请稍后再试");
    }
    const b = asObject(await safeJson(req));
    if (!(await verifyTurnstile(env, b.turnstileToken, ip))) {
      return err(403, ERROR_CODES.CAPTCHA_FAILED, "人机验证未通过");
    }
    const u = username(b.username);
    const p = pwOf(b.password);
    if (!u) return err(400, ERROR_CODES.VALIDATION, "用户名需为 3~20 位字母、数字或下划线");
    if (u.toLowerCase() === RESERVED) return err(400, ERROR_CODES.VALIDATION, "该用户名为系统保留");
    if (!p) return err(400, ERROR_CODES.VALIDATION, "密码长度需为 6~64 位");
    if (await env.KV.get(KV.user(u))) return err(409, ERROR_CODES.CONFLICT, "用户名已存在");
    const salt = newSalt();
    const now = new Date().toISOString();
    const user = {
      id: randHex(8), username: u, salt,
      passHash: await hashPassword(p, salt),
      role: "user", orgId: "demo", tokenVersion: 0, createdAt: now,
    };
    await putJSON(env.KV, KV.user(u), user);
    const token = await createSession(env, user);
    return ok({ user: pickUser(user) }, sessionHeaders(token));
  });

  router.add("POST", "/api/login", async ({ req, env }) => {
    const ip = clientIp(req);
    if (!(await rateLimit(env, "login", ip, 10))) {
      return err(429, ERROR_CODES.RATE_LIMITED, "登录尝试过于频繁，请稍后再试");
    }
    const b = asObject(await safeJson(req));
    if (!(await verifyTurnstile(env, b.turnstileToken, ip))) {
      return err(403, ERROR_CODES.CAPTCHA_FAILED, "人机验证未通过");
    }
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

  router.add("POST", "/api/change-password", async ({ req, env }) => {
    const s = await getSessionUser(env, req);
    if (!s) return err(401, ERROR_CODES.UNAUTHORIZED, "未登录");
    if (s.role === "admin") {
      return err(400, ERROR_CODES.VALIDATION, "管理员密码请通过部署密钥修改");
    }
    const b = asObject(await safeJson(req));
    const np = pwOf(b.newPassword);
    if (!np) return err(400, ERROR_CODES.VALIDATION, "新密码长度需为 6~64 位");
    const stored = await getJSON(env.KV, KV.user(s.username));
    if (!stored) return err(404, ERROR_CODES.NOT_FOUND, "用户不存在");
    const oldOk = typeof b.oldPassword === "string" && await verifyPassword(b.oldPassword, stored.passHash, stored.salt);
    if (!oldOk) return err(400, ERROR_CODES.VALIDATION, "原密码错误");
    stored.salt = newSalt();
    stored.passHash = await hashPassword(np, stored.salt);
    stored.tokenVersion = (stored.tokenVersion ?? 0) + 1;
    await putJSON(env.KV, KV.user(stored.username), stored);
    // 踢出其他会话（含当前），要求全部重新登录
    await invalidateUserSessions(env, stored.id, stored.username);
    // 发回新会话，当前设备无感
    const token = await createSession(env, stored);
    return ok({}, sessionHeaders(token));
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
