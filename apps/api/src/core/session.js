/** 会话：绑定 uid，改密/删号时按前缀失效 */
import { KV, SESSION_COOKIE, SESSION_TTL } from "@chsi/shared";
import { getJSON, putJSON, listAll } from "./kv.js";
import { err, SECURITY_HEADERS } from "./http.js";
import { randHex } from "./password.js";

function parseCookies(req) {
  const h = req.headers.get("Cookie") || "";
  const out = {};
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token) {
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}
export function clearSessionCookie() {
  return `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** 创建会话（key 绑 uid + ver），返回 token；同时写 token→uid 索引 */
export async function createSession(env, user /* {id,username,role} */) {
  const token = randHex(32);
  await putJSON(env.KV, KV.session(user.id, token), {
    uid: user.id, username: user.username, role: user.role,
    ver: user.tokenVersion ?? 0, createdAt: new Date().toISOString(),
  }, { expirationTtl: SESSION_TTL });
  await putJSON(env.KV, `sidx:${token}`, { uid: user.id }, { expirationTtl: SESSION_TTL });
  return token;
}

/** 当前会话；ver 不匹配 / 上游用户已删 → 作废 */
export async function getSessionUser(env, req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  // token 换 uid：session key 需要 uid；橙色策略 —— 单独 token 查找代价高，
  // 我们在 session 内先按 token 反查 uid。为省 KV 空间，用 `orientation:token→uid` 小表
  const uid = await getJSON(env.KV, `sidx:${token}`);
  if (!uid) return null;
  const rec = await getJSON(env.KV, KV.session(uid.uid, token));
  if (!rec) return null;
  const userKey = `${KV.user(rec.username)}`;
  if (rec.role === "admin") {
    // 管理员：无 KV user 记录，只允许 role=admin
    return { ...rec, token };
  }
  const stored = await getJSON(env.KV, userKey);
  if (!stored) return null;
  if ((stored.tokenVersion ?? 0) !== (rec.ver ?? 0)) {
    await env.KV.delete(`sidx:${token}`);
    return null;
  }
  return { ...rec, token };
}

export async function destroySession(env, req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const uid = await getJSON(env.KV, `sidx:${token}`);
    if (uid) {
      await env.KV.delete(KV.session(uid.uid, token));
      await env.KV.delete(`sidx:${token}`);
    }
  }
}

/** 改密 / 删号后：作废该用户全部会话（tokenVersion + 1 也行，这里直接删前缀更彻底） */
export async function invalidateUserSessions(env, uid, username) {
  const keys = await listAll(env.KV, KV.sessionPrefixFor(uid));
  for (const k of keys) {
    await env.KV.delete(k.name);
  }
  await env.KV.put(`uvkill:${username}`, String(Date.now()), { expirationTtl: 3600 });
}

export async function requireUser(env, req) {
  const s = await getSessionUser(env, req);
  if (!s) return { err: err(401, "E_UNAUTHORIZED", "未登录，请先登录") };
  return { user: s };
}

export async function requireAdmin(env, req) {
  const r = await requireUser(env, req);
  if (r.err) return r;
  if (r.user.role !== "admin") return { err: err(403, "E_FORBIDDEN", "需要管理员权限") };
  return r;
}

/** 注册后 / 登录后统一返回 Set-Cookie；新 token 已在 createSession 里建好索引 */
export function sessionHeaders(token) {
  return { "Set-Cookie": sessionCookie(token), ...SECURITY_HEADERS };
}
