/** admin 用户管理：列表 / 新增 / 改密 / 删除 */
import { KV, ERROR_CODES } from "@chsi/shared";
import { ok, err } from "../core/http.js";
import { username, password as pwOf, asObject } from "../core/validator.js";
import { hashPassword, newSalt, randHex } from "../core/password.js";
import { requireAdmin, invalidateUserSessions } from "../core/session.js";
import { listAll, getJSON, putJSON } from "../core/kv.js";

export function registerAdminUserRoutes(router) {
  router.add("GET", "/api/v1/admin/users", async ({ req, env }) => {
    const r = await requireAdmin(env, req);
    if (r.err) return r.err;
    const keys = await listAll(env.KV, "user:");
    const users = [];
    for (const k of keys) {
      const u = await getJSON(env.KV, k.name);
      if (!u) continue;
      const sl = await listAll(env.KV, KV.studentPrefixFor(u.id));
      users.push({
        id: u.id, username: u.username, orgId: u.orgId, createdAt: u.createdAt,
        studentCount: sl.length,
      });
    }
    users.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    return ok({ users });
  });

  router.add("POST", "/api/v1/admin/users", async ({ req, env }) => {
    const r = await requireAdmin(env, req);
    if (r.err) return r.err;
    const b = asObject(await safeJson(req));
    const u = username(b.username);
    const p = pwOf(b.password);
    if (!u) return err(400, ERROR_CODES.VALIDATION, "用户名需为 3~20 位字母、数字或下划线");
    if (u.toLowerCase() === "admin") return err(400, ERROR_CODES.VALIDATION, "该用户名为系统保留");
    if (!p) return err(400, ERROR_CODES.VALIDATION, "密码长度需为 6~64 位");
    if (await env.KV.get(KV.user(u))) return err(409, ERROR_CODES.CONFLICT, "用户名已存在");
    const now = new Date().toISOString();
    const salt = newSalt();
    const user = {
      id: randHex(8), username: u, salt,
      passHash: await hashPassword(p, salt),
      role: "user", orgId: "demo", tokenVersion: 0, createdAt: now,
    };
    await putJSON(env.KV, KV.user(u), user);
    return ok({ user: { id: user.id, username: user.username, createdAt: user.createdAt } });
  });

  router.add("PUT", "/api/v1/admin/users/:uid", async ({ req, env, params }) => {
    const r = await requireAdmin(env, req);
    if (r.err) return r.err;
    const b = asObject(await safeJson(req));
    const p = pwOf(b.password);
    if (!p) return err(400, ERROR_CODES.VALIDATION, "密码长度需为 6~64 位");
    const { key, user } = await findUserById(env, params.uid);
    if (!user) return err(404, ERROR_CODES.NOT_FOUND, "用户不存在");
    user.salt = user.salt || newSalt();
    user.passHash = await hashPassword(p, user.salt);
    await putJSON(env.KV, key, user);
    // 重置后踢出该用户全部会话
    await invalidateUserSessions(env, user.id, user.username);
    return ok();
  });

  router.add("DELETE", "/api/v1/admin/users/:uid", async ({ req, env, params }) => {
    const r = await requireAdmin(env, req);
    if (r.err) return r.err;
    const { key, user } = await findUserById(env, params.uid);
    if (!user) return err(404, ERROR_CODES.NOT_FOUND, "用户不存在");
    // 删除其学籍（含照片）
    const skeys = await listAll(env.KV, KV.studentPrefixFor(user.id));
    for (const k of skeys) {
      const rec = await getJSON(env.KV, k.name);
      if (rec?.photoKeys) {
        for (const n of ["photo", "photo2"]) {
          if (rec.photoKeys[n]?.key) await env.R2?.delete?.(rec.photoKeys[n].key);
        }
      }
      await env.KV.delete(k.name);
    }
    await env.KV.delete(key);
    return ok();
  });
}

async function findUserById(env, uid) {
  if (!/^[0-9a-f]{16}$/.test(uid)) return {};
  const keys = await listAll(env.KV, "user:");
  for (const k of keys) {
    const u = await getJSON(env.KV, k.name);
    if (u && u.id === uid) return { key: k.name, user: u };
  }
  return {};
}

async function safeJson(req) {
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return {};
  try { return await req.json(); } catch { return {}; }
}
