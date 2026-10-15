import { resources, getResource } from "./schema.js";
import { HttpError, json, readJson, parseCookies, sessionCookie } from "./lib/http.js";
import { randHex, secretEquals } from "./lib/crypto.js";
import {
  listRecords, listOptions, getRecord, createRecord, updateRecord, deleteRecord,
  present, stats, writeAudit, listAudit, isId,
} from "./lib/store.js";

const SESSION_TTL = 7 * 24 * 3600;
const CSP = "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      return await serveStatic(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message, fields: e.fields }, e.status);
      console.error(e);
      const msg = /ID_ENC_KEY/.test(String(e && e.message)) ? "服务端缺少 ID_ENC_KEY，暂时无法保存证件号" : "服务器内部错误";
      return json({ ok: false, error: msg }, 500);
    }
  },
};

async function serveStatic(request, env, url) {
  if (url.pathname === "/" || url.pathname === "/admin") return Response.redirect(new URL("/admin/", url), 302);
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  if ((headers.get("Content-Type") || "").includes("text/html")) {
    headers.set("Content-Security-Policy", CSP);
    headers.set("Cache-Control", "no-cache");
  }
  return new Response(res.body, { status: res.status, headers });
}

/* ---------------- 认证 ---------------- */

async function currentSession(request, env) {
  const token = parseCookies(request).admin_session;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return (await env.KV.get(`session:${token}`)) ? token : null;
}

async function limitLogin(env, ip) {
  if (env.LOGIN_LIMITER) {
    const { success } = await env.LOGIN_LIMITER.limit({ key: ip });
    if (!success) throw new HttpError(429, "尝试次数过多，请一分钟后再试");
    return;
  }
  const k = `rl:login:${ip}`;
  const n = parseInt((await env.KV.get(k)) || "0", 10);
  if (n >= 10) throw new HttpError(429, "尝试次数过多，请一分钟后再试");
  await env.KV.put(k, String(n + 1), { expirationTtl: 60 });
}

async function handleAuth(request, env, url, ip) {
  const secure = url.protocol === "https:";
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    if (!(await currentSession(request, env))) throw new HttpError(401, "请先登录");
    return json({ ok: true });
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    await limitLogin(env, ip);
    if (!env.ADMIN_PASSWORD) throw new HttpError(503, "尚未设置管理员密码（secret ADMIN_PASSWORD）");
    const body = await readJson(request);
    if (!(await secretEquals(String(body.password || ""), env.ADMIN_PASSWORD))) {
      await writeAudit(env, { action: "login_failed", target: "管理员", ip });
      throw new HttpError(401, "密码不正确");
    }
    const token = randHex(32);
    await env.KV.put(`session:${token}`, "1", { expirationTtl: SESSION_TTL });
    await writeAudit(env, { action: "login", target: "管理员", ip });
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, { secure, maxAge: SESSION_TTL }) });
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = parseCookies(request).admin_session;
    if (token) await env.KV.delete(`session:${token}`);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", { secure, maxAge: 0 }) });
  }
  throw new HttpError(404, "接口不存在");
}

/* ---------------- 后台接口 ---------------- */

async function handleApi(request, env, url) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (url.pathname.startsWith("/api/auth/")) return handleAuth(request, env, url, ip);

  if (!(await currentSession(request, env))) throw new HttpError(401, "登录已过期，请重新登录");
  // 写操作必须带自定义请求头：跨站表单提交无法带上它
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("X-Requested-With") !== "fetch") {
    throw new HttpError(403, "请求来源不受信任");
  }
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/admin/meta" && method === "GET") {
    return json({ ok: true, site: { name: env.SITE_NAME || "培训管理后台" }, resources });
  }
  if (path === "/api/admin/stats" && method === "GET") return json({ ok: true, ...(await stats(env)) });
  if (path === "/api/admin/audit" && method === "GET") {
    return json({ ok: true, ...(await listAudit(env, { cursor: url.searchParams.get("cursor") })) });
  }

  const m = path.match(/^\/api\/admin\/r\/([a-z]+)(?:\/([0-9a-z]+|options))?$/);
  if (!m) throw new HttpError(404, "接口不存在");
  const res = getResource(m[1]);
  if (!res) throw new HttpError(404, "没有这个资源");
  const sub = m[2];

  if (!sub && method === "GET") {
    const filters = {};
    for (const f of res.fields.filter((f) => f.filter)) {
      const v = url.searchParams.get(`f_${f.key}`);
      if (v) filters[f.key] = v;
    }
    const out = await listRecords(env, res, { cursor: url.searchParams.get("cursor"), q: url.searchParams.get("q"), filters });
    return json({ ok: true, ...out });
  }
  if (!sub && method === "POST") {
    const rec = await createRecord(env, res, await readJson(request));
    await writeAudit(env, { action: "create", target: `${res.label}：${rec[res.labelField] || rec.id}`, ip });
    return json({ ok: true, record: await present(env, res, rec) }, 201);
  }
  if (sub === "options" && method === "GET") return json({ ok: true, ...(await listOptions(env, res)) });

  if (sub && isId(sub)) {
    if (method === "GET") {
      const rec = await getRecord(env, res, sub);
      if (!rec) throw new HttpError(404, "记录不存在或已被删除");
      return json({ ok: true, record: await present(env, res, rec) });
    }
    if (method === "PUT") {
      const rec = await updateRecord(env, res, sub, await readJson(request));
      await writeAudit(env, { action: "update", target: `${res.label}：${rec[res.labelField] || rec.id}`, ip });
      return json({ ok: true, record: await present(env, res, rec) });
    }
    if (method === "DELETE") {
      const old = await deleteRecord(env, res, sub);
      await writeAudit(env, { action: "delete", target: `${res.label}：${old[res.labelField] || old.id}`, ip });
      return json({ ok: true });
    }
  }
  throw new HttpError(405, "不支持的请求方式");
}
