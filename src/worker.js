/**
 * 学员学籍信息查询与管理平台（演示系统）
 * Cloudflare Workers + KV 实现
 *
 * KV key 设计：
 *   user:<username>        -> {id, username, salt, passHash, role, createdAt}
 *   session:<token>        -> {userId, username, role} (TTL 7 天)
 *   student:<ownerId>:<sid> -> 学籍记录 JSON
 *   captcha:<cid>          -> {code} (TTL 5 分钟)
 *   rl:<ip>                -> 查询限流计数 (TTL 60 秒)
 *
 * 管理员：用户名固定为 admin，密码通过 wrangler secret 设置 ADMIN_PASSWORD
 */

const SESSION_TTL = 7 * 24 * 3600; // 7 天
const CAPTCHA_TTL = 300;           // 5 分钟
const QUERY_LIMIT_PER_MIN = 20;

/*__ASSETS_MAP__*/

/* 静态资源：部署包构建时由 build.mjs 把 public/* 内联为 globalThis.__ASSETS__；
   本地 dev 走 wrangler [assets] 时此表为空，不影响 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
function serveAsset(pathname) {
  const map = globalThis.__ASSETS__;
  if (!map) return null;
  let p = pathname === "/" ? "/index.html" : pathname;
  const body = map[p];
  if (body == null) return null;
  const ext = p.slice(p.lastIndexOf("."));
  return new Response(body, {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/* ---------------- 基础工具 ---------------- */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function getCookies(req) {
  const h = req.headers.get("Cookie") || "";
  const out = {};
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}
function clearSessionCookie() {
  return `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, salt) {
  return sha256hex(`${salt}::${password}`);
}

async function getSession(env, req) {
  const { session } = getCookies(req);
  if (!session) return null;
  const s = await env.KV.get(`session:${session}`, "json");
  return s ? { ...s, token: session } : null;
}

async function requireUser(env, req) {
  const s = await getSession(env, req);
  if (!s) return { err: json({ ok: false, error: "未登录，请先登录" }, 401) };
  return { user: s };
}

async function requireAdmin(env, req) {
  const r = await requireUser(env, req);
  if (r.err) return r;
  if (r.user.role !== "admin") return { err: json({ ok: false, error: "需要管理员权限" }, 403) };
  return r;
}

/** 证件号码脱敏：18 位身份证保留前 6 后 4 */
function maskIdNumber(id) {
  if (/^\d{17}[\dXx]$/.test(id)) return id.slice(0, 6) + "********" + id.slice(-4);
  if (id.length > 8) return id.slice(0, 3) + "****" + id.slice(-4);
  return "****";
}

/* ---------------- 验证码 ---------------- */

const CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCaptchaSvg(code) {
  const w = 120, h = 44;
  let chars = "";
  for (let i = 0; i < code.length; i++) {
    const x = 18 + i * 24 + Math.floor(Math.random() * 6 - 3);
    const y = 30 + Math.floor(Math.random() * 6 - 3);
    const r = Math.floor(Math.random() * 40 - 20);
    const c = `hsl(${Math.floor(Math.random() * 360)},60%,35%)`;
    chars += `<text x="${x}" y="${y}" font-size="26" font-weight="bold" fill="${c}" transform="rotate(${r} ${x} ${y})" font-family="Arial">${code[i]}</text>`;
  }
  let lines = "";
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * w, y1 = Math.random() * h, x2 = Math.random() * w, y2 = Math.random() * h;
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#999" stroke-width="1" opacity="0.6"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#f2f6fb"/>${lines}${chars}</svg>`;
}

/* ---------------- 学籍校验 ---------------- */

function validateStudent(b) {
  const errs = [];
  const name = (b.name || "").trim();
  const idNumber = (b.idNumber || "").trim().replace(/\s+/g, "");
  if (!name || name.length > 20) errs.push("姓名不能为空且不超过20字");
  if (!/^\d{15}$|^\d{17}[\dXx]$/.test(idNumber) && !(idNumber.length >= 6 && idNumber.length <= 20)) {
    // 演示系统放宽：允许 6~20 位证件号，但 15/18 位身份证优先
    errs.push("证件号码格式不正确");
  }
  if (b.gender && !["男", "女"].includes(b.gender)) errs.push("性别只能为男/女");
  if (b.photo && b.photo.length > 400 * 1024) errs.push("照片过大（请控制在 300KB 以内）");
  if (b.photo2 && b.photo2.length > 400 * 1024) errs.push("学历照片过大（请控制在 300KB 以内）");
  return { errs, name, idNumber };
}

function sanitizeStudent(b, idNumber, name) {
  const pick = (v, max = 60) => (v == null ? "" : String(v).slice(0, max));
  return {
    name,
    gender: ["男", "女"].includes(b.gender) ? b.gender : "",
    ethnicity: pick(b.ethnicity, 20),
    birthdate: pick(b.birthdate, 20),
    idType: pick(b.idType, 20) || "居民身份证",
    idNumber,
    studentNo: pick(b.studentNo, 30),
    institution: pick(b.institution, 60),
    level: pick(b.level, 30),
    major: pick(b.major, 60),
    duration: pick(b.duration, 20),
    studyMode: pick(b.studyMode, 20),
    eduCategory: pick(b.eduCategory, 20),
    branch: pick(b.branch, 40),
    dept: pick(b.dept, 40),
    className: pick(b.className, 40),
    enrollDate: pick(b.enrollDate, 20),
    gradDate: pick(b.gradDate, 20),
    status: pick(b.status, 20) || "在读",
    degreeName: pick(b.degreeName, 30),
    degreeUnit: pick(b.degreeUnit, 60),
    gradType: pick(b.gradType, 10),
    presidentName: pick(b.presidentName, 20),
    certNo: pick(b.certNo, 40),
    photo2: typeof b.photo2 === "string" ? b.photo2.slice(0, 400000) : "",
    photo: typeof b.photo === "string" && b.photo.startsWith("data:image/") ? b.photo.slice(0, 400 * 1024) : "",
    published: b.published !== false,
    remark: pick(b.remark, 200),
  };
}

/* ---------------- 路由 ---------------- */

async function handleApi(env, req, url) {
  const path = url.pathname;
  const method = req.method;

  /* --- 验证码 --- */
  if (path === "/api/captcha" && method === "GET") {
    let code = "";
    for (let i = 0; i < 4; i++) code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
    const cid = randHex(8);
    await env.KV.put(`captcha:${cid}`, JSON.stringify({ code }), { expirationTtl: CAPTCHA_TTL });
    return new Response(makeCaptchaSvg(code), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
        "Set-Cookie": `cid=${cid}; Path=/; SameSite=Lax; Max-Age=${CAPTCHA_TTL}`,
      },
    });
  }

  /* --- 注册 --- */
  if (path === "/api/register" && method === "POST") {
    const b = await req.json().catch(() => ({}));
    const username = (b.username || "").trim();
    const password = b.password || "";
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return json({ ok: false, error: "用户名需为 3~20 位字母、数字或下划线" }, 400);
    }
    if (username.toLowerCase() === "admin") {
      return json({ ok: false, error: "该用户名为系统保留" }, 400);
    }
    if (password.length < 6 || password.length > 64) {
      return json({ ok: false, error: "密码长度需为 6~64 位" }, 400);
    }
    if (await env.KV.get(`user:${username}`)) {
      return json({ ok: false, error: "用户名已存在" }, 409);
    }
    const id = randHex(8);
    const salt = randHex(16);
    const user = {
      id, username, salt,
      passHash: await hashPassword(password, salt),
      role: "user",
      createdAt: new Date().toISOString(),
    };
    await env.KV.put(`user:${username}`, JSON.stringify(user));
    const token = randHex(32);
    await env.KV.put(`session:${token}`,
      JSON.stringify({ userId: id, username, role: "user" }),
      { expirationTtl: SESSION_TTL });
    return json({ ok: true, user: { username, role: "user" } },
      200, { "Set-Cookie": sessionCookie(token) });
  }

  /* --- 登录 --- */
  if (path === "/api/login" && method === "POST") {
    const b = await req.json().catch(() => ({}));
    const username = (b.username || "").trim();
    const password = b.password || "";
    let user = null;
    if (username.toLowerCase() === "admin") {
      const adminPw = env.ADMIN_PASSWORD;
      if (!adminPw) {
        return json({ ok: false, error: "管理员密码尚未设置，请联系系统部署人员" }, 503);
      }
      const ok = (await hashPassword(password, "admin-salt")) === (await hashPassword(adminPw, "admin-salt"));
      if (!ok) return json({ ok: false, error: "用户名或密码错误" }, 401);
      user = { userId: "admin", username: "admin", role: "admin" };
    } else {
      const stored = await env.KV.get(`user:${username}`, "json");
      if (!stored) return json({ ok: false, error: "用户名或密码错误" }, 401);
      const ok = (await hashPassword(password, stored.salt)) === stored.passHash;
      if (!ok) return json({ ok: false, error: "用户名或密码错误" }, 401);
      user = { userId: stored.id, username: stored.username, role: stored.role };
    }
    const token = randHex(32);
    await env.KV.put(`session:${token}`, JSON.stringify(user), { expirationTtl: SESSION_TTL });
    return json({ ok: true, user: { username: user.username, role: user.role } },
      200, { "Set-Cookie": sessionCookie(token) });
  }

  /* --- 退出 --- */
  if (path === "/api/logout" && method === "POST") {
    const { session } = getCookies(req);
    if (session) await env.KV.delete(`session:${session}`);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  /* --- 当前用户 --- */
  if (path === "/api/me" && method === "GET") {
    const s = await getSession(env, req);
    if (!s) return json({ ok: false, error: "未登录" }, 401);
    return json({ ok: true, user: { username: s.username, role: s.role } });
  }

  /* --- 学籍列表 --- */
  if (path === "/api/students" && method === "GET") {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const prefix = r.user.role === "admin" ? "student:" : `student:${r.user.userId}:`;
    const list = await env.KV.list({ prefix });
    const recs = [];
    for (const k of list.keys) {
      const rec = await env.KV.get(k.name, "json");
      if (rec) recs.push(rec);
    }
    recs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return json({ ok: true, students: recs });
  }

  /* --- 新增学籍 --- */
  if (path === "/api/students" && method === "POST") {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const b = await req.json().catch(() => ({}));
    const { errs, name, idNumber } = validateStudent(b);
    if (errs.length) return json({ ok: false, error: errs[0] }, 400);
    // 管理员可代指定用户建档
    let ownerId = r.user.userId, ownerUsername = r.user.username;
    if (r.user.role === "admin" && b.ownerUsername) {
      const target = await env.KV.get(`user:${b.ownerUsername}`, "json");
      if (!target) return json({ ok: false, error: "指定的归属用户不存在" }, 400);
      ownerId = target.id; ownerUsername = target.username;
    }
    const sid = randHex(12);
    const now = new Date().toISOString();
    const rec = {
      sid, ownerId, ownerUsername, createdAt: now, updatedAt: now,
      ...sanitizeStudent(b, idNumber, name),
    };
    await env.KV.put(`student:${ownerId}:${sid}`, JSON.stringify(rec));
    return json({ ok: true, student: rec });
  }

  /* --- 学籍详情 / 修改 / 删除 --- */
  const m = path.match(/^\/api\/students\/([0-9a-f]{24})$/);
  if (m) {
    const sid = m[1];
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const prefix = r.user.role === "admin" ? "student:" : `student:${r.user.userId}:`;
    const list = await env.KV.list({ prefix });
    const key = list.keys.find((k) => k.name.endsWith(`:${sid}`));
    if (!key) return json({ ok: false, error: "记录不存在" }, 404);

    if (method === "GET") {
      const rec = await env.KV.get(key.name, "json");
      return json({ ok: true, student: rec });
    }
    if (method === "PUT") {
      const old = await env.KV.get(key.name, "json");
      const b = await req.json().catch(() => ({}));
      const merged = { ...old, ...b }; // 局部更新：未提交字段保留旧值
      const { errs, name, idNumber } = validateStudent(merged);
      if (errs.length) return json({ ok: false, error: errs[0] }, 400);
      const rec = { ...old, ...sanitizeStudent(merged, idNumber, name), updatedAt: new Date().toISOString() };
      await env.KV.put(key.name, JSON.stringify(rec));
      return json({ ok: true, student: rec });
    }
    if (method === "DELETE") {
      await env.KV.delete(key.name);
      return json({ ok: true });
    }
  }

  /* --- 用户管理（管理员） --- */
  if (path === "/api/users" && method === "GET") {
    const r = await requireAdmin(env, req);
    if (r.err) return r.err;
    const list = await env.KV.list({ prefix: "user:" });
    const users = [];
    for (const k of list.keys) {
      const u = await env.KV.get(k.name, "json");
      if (!u) continue;
      const sl = await env.KV.list({ prefix: `student:${u.id}:` });
      users.push({ id: u.id, username: u.username, createdAt: u.createdAt, studentCount: sl.keys.length });
    }
    users.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    return json({ ok: true, users });
  }

  const um = path.match(/^\/api\/users\/([0-9a-f]{16})$/);
  if (um && method === "DELETE") {
    const r = await requireAdmin(env, req);
    if (r.err) return r.err;
    const uid = um[1];
    const list = await env.KV.list({ prefix: "user:" });
    let targetKey = null, target = null;
    for (const k of list.keys) {
      const u = await env.KV.get(k.name, "json");
      if (u && u.id === uid) { targetKey = k.name; target = u; break; }
    }
    if (!target) return json({ ok: false, error: "用户不存在" }, 404);
    // 删除该用户及其全部学籍
    const sl = await env.KV.list({ prefix: `student:${uid}:` });
    for (const k of sl.keys) await env.KV.delete(k.name);
    await env.KV.delete(targetKey);
    return json({ ok: true });
  }

  /* --- 公开学籍查询 --- */
  if (path === "/api/query" && method === "POST") {
    // 验证码校验
    const { cid } = getCookies(req);
    const b = await req.json().catch(() => ({}));
    const stored = cid ? await env.KV.get(`captcha:${cid}`, "json") : null;
    if (cid) await env.KV.delete(`captcha:${cid}`); // 一次性
    if (!stored || (b.captcha || "").trim().toUpperCase() !== stored.code) {
      return json({ ok: false, error: "验证码错误，请重新输入" }, 400);
    }
    // 限流
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const rk = `rl:${ip}`;
    const n = parseInt((await env.KV.get(rk)) || "0", 10);
    if (n >= QUERY_LIMIT_PER_MIN) {
      return json({ ok: false, error: "查询过于频繁，请稍后再试" }, 429);
    }
    await env.KV.put(rk, String(n + 1), { expirationTtl: 60 });

    const name = (b.name || "").trim();
    const idNumber = (b.idNumber || "").trim().replace(/\s+/g, "");
    if (!name || !idNumber) {
      return json({ ok: false, error: "请输入姓名和证件号码" }, 400);
    }
    const list = await env.KV.list({ prefix: "student:" });
    const found = [];
    for (const k of list.keys) {
      const rec = await env.KV.get(k.name, "json");
      if (rec && rec.published && rec.name === name && rec.idNumber === idNumber) {
        found.push({
          name: rec.name, gender: rec.gender, ethnicity: rec.ethnicity,
          birthdate: rec.birthdate, idType: rec.idType,
          idNumber: maskIdNumber(rec.idNumber),
          studentNo: rec.studentNo, institution: rec.institution,
          level: rec.level, major: rec.major, duration: rec.duration,
          enrollDate: rec.enrollDate, gradDate: rec.gradDate,
          status: rec.status, photo: rec.photo, updatedAt: rec.updatedAt,
        });
      }
    }
    return json({ ok: true, found: found.length > 0, records: found });
  }

  return json({ ok: false, error: "接口不存在" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(env, req, url);
      } catch (e) {
        return json({ ok: false, error: "服务器内部错误" }, 500);
      }
    }
    // 非 /api/* 请求：优先内联静态资源（部署包），其次 404；
    // 本地 dev 时 public/* 由 wrangler [assets] 直接 serving
    return serveAsset(url.pathname) || new Response("Not Found", { status: 404 });
  },
};
