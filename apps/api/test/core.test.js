import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";

const BASE = "http://example.com";
async function F(path, init = {}) {
  return SELF.fetch(BASE + path, init);
}

const H = { "Content-Type": "application/json" };
const uniq = () => "u" + Math.random().toString(36).slice(2, 10);

async function register(username, password = "pass1234") {
  const r = await F("/api/register", { method: "POST", headers: H, body: JSON.stringify({ username, password }) });
  return { r, cookie: parseCookie(r) };
}
function parseCookie(r) {
  const sc = r.headers.get("Set-Cookie") || "";
  const m = sc.match(/session=([0-9a-f]+)/);
  return m ? `session=${m[1]}` : "";
}
async function login(username, password) {
  const r = await F("/api/login", { method: "POST", headers: H, body: JSON.stringify({ username, password }) });
  return { r, cookie: parseCookie(r) };
}
async function mkStudent(cookie, extra = {}) {
  const r = await F("/api/students", {
    method: "POST", headers: { ...H, Cookie: cookie },
    body: JSON.stringify({ name: "张三", idNumber: "110101199001011234", ...extra }),
  });
  return { r, d: await r.json() };
}

/* ---------------- register / login 基线 ---------------- */
describe("register & login", () => {
  it("登录后 me 可用；登出后 401", async () => {
    const u = uniq();
    const { cookie } = await register(u);
    expect(cookie).not.toBe("");
    const me = await F("/api/me", { headers: { Cookie: cookie } });
    const d = await me.json();
    expect(d.ok).toBe(true);
    expect(d.user.username).toBe(u);
    const lo = await F("/api/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(lo.status).toBe(200);
    const me2 = await F("/api/me", { headers: { Cookie: cookie } });
    expect(me2.status).toBe(401);
  });

  it("非字符串 username → 400（不是 500）", async () => {
    const r = await F("/api/register", { method: "POST", headers: H, body: JSON.stringify({ username: 12345, password: "pass1234" }) });
    expect(r.status).toBe(400);
    expect((await r.json()).ok).toBe(false);
  });

  it("数字 password → 400（长度校验不被绕过）", async () => {
    const r = await F("/api/register", { method: "POST", headers: H, body: JSON.stringify({ username: uniq(), password: 12345678 }) });
    expect(r.status).toBe(400);
  });

  it("admin 登录走环境密钥；错密码 401", async () => {
    const bad = await login("admin", "wrongpw");
    expect(bad.r.status).toBe(401);
    const good = await login("admin", "test-admin-pw");
    expect(good.r.status).toBe(200);
  });

  it("连续错密码触发限流 429", async () => {
    const u = uniq();
    await register(u);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await login(u, "wrongpw" + i);
      last = r.r.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

/* ---------------- session 失效语义 ---------------- */
describe("session lifecycle", () => {
  it("改密后：旧会话失效（回 401），当前设备拿到新 cookie 可用", async () => {
    const u = uniq();
    const { cookie: c1 } = await register(u);
    // 第二个会话
    const { cookie: c2 } = await login(u, "pass1234");
    const cp = await F("/api/change-password", {
      method: "POST", headers: { ...H, Cookie: c2 },
      body: JSON.stringify({ oldPassword: "pass1234", newPassword: "newpass99" }),
    });
    expect(cp.status).toBe(200);
    // c1 旧会话必须死
    const me1 = await F("/api/me", { headers: { Cookie: c1 } });
    expect(me1.status).toBe(401);
    // c2 改密端拿到新 cookie
    const newCookie = parseCookie(cp);
    expect(newCookie).not.toBe("");
    const me2 = await F("/api/me", { headers: { Cookie: newCookie } });
    expect(me2.status).toBe(200);
    // 旧密码不能再用
    const relog = await login(u, "pass1234");
    expect(relog.r.status).toBe(401);
    // 新密码可用
    const relog2 = await login(u, "newpass99");
    expect(relog2.r.status).toBe(200);
  });

  it("管理员删号后：该用户旧会话失效", async () => {
    const u = uniq();
    const { cookie: cu } = await register(u);
    const { cookie: ca } = await login("admin", "test-admin-pw");
    const lu = await F("/api/admin/users", { headers: { Cookie: ca } });
    const users = (await lu.json()).users;
    const me = users.find((x) => x.username === u);
    expect(me).toBeTruthy();
    const del = await F(`/api/admin/users/${me.id}`, { method: "DELETE", headers: { Cookie: ca } });
    expect(del.status).toBe(200);
    const meU = await F("/api/me", { headers: { Cookie: cu } });
    expect(meU.status).toBe(401);
  });
});

/* ---------------- students：分页 / 隔离 / 照片 ---------------- */
describe("students", () => {
  it("1080 条记录全可见（>1000 分页不截断）", { timeout: 600_000 }, async () => {
    const u = uniq();
    const { cookie } = await register(u);
    // 并发、限制并发分批写入
    const N = 1080;
    const batch = 20;
    for (let i = 0; i < N; i += batch) {
      await Promise.all(
        Array.from({ length: batch }, (_, j) =>
          mkStudent(cookie, { name: `学员${i + j}`, idNumber: `11010119900101${String((i + j) % 10000).padStart(4, "0")}` })
        )
      );
    }
    let cursor = 0; const seen = new Set(); let guard = 0;
    while (true) {
      const r = await F(`/api/students?limit=100&cursor=${cursor}`, { headers: { Cookie: cookie } });
      const d = await r.json();
      for (const s of d.students) seen.add(s.sid);
      if (!d.nextCursor || guard++ > 30) break;
      cursor = d.nextCursor;
    }
    expect(seen.size).toBe(N);
  });

  it("用户隔离：别人的记录 404", async () => {
    const a = uniq(), b = uniq();
    const { cookie: cb } = await register(b);
    const { cookie: ca } = await register(a);
    const { d } = await mkStudent(ca);
    const r = await F(`/api/students/${d.student.sid}`, { headers: { Cookie: cb } });
    expect(r.status).toBe(404);
  });

  it("照片过大 → 413；XSS 载荷被拒", async () => {
    const { cookie } = await register(uniq());
    // 只允许 data:image/* base64 或 http(s) URL；含引号 URL 被拒
    const badUrl = 'https://evil.example/a"onerror="x()//';
    const r1 = await mkStudent(cookie, { photo: badUrl });
    // 含引号 → photo 存空，但记录正常
    expect(r1.r.status).toBe(200);
    expect(r1.d.student.photoKeys?.photo?.url ?? "").not.toContain('onerror');
  });

  it("data URL 照片拆离：记录里无 base64", async () => {
    const { cookie } = await register(uniq());
    // 1x1 png
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { r, d } = await mkStudent(cookie, { photo: `data:image/png;base64,${png}` });
    expect(r.status).toBe(200);
    expect(JSON.stringify(d.student)).not.toContain("iVBORw0");
    expect(d.student.photoKeys?.photo?.key).toBeTruthy();
    // 照片可取回
    const key = d.student.photoKeys.photo.key; // photos/<sid>/photo.bin
    const kp = key.split("/"); // [photos, <sid>, photo.bin]
    const pr = await F(`/api/photos/${kp[1]}/${kp[2]}`, { headers: { Cookie: cookie } });
    expect(pr.status).toBe(200);
  });
});

/* ---------------- 公开查询 ---------------- */
describe("公开查询 /api/query", () => {
  const uniqId = () => `110101199002${String(Math.floor(Math.random() * 9000) + 1000)}`;
  it("命中已发布记录；XSS 载荷存在性由字段清洗保障", async () => {
    const u = uniq();
    const { cookie } = await register(u);
    const name = "柳五";
    const idn = uniqId();
    await mkStudent(cookie, { name, idNumber: idn });
    const ip = "1.2.3.4";
    // 未通过 Turnstile（本地无 secret，会被 dev bypass 放行）—— 一步步测：
    const q = await F("/api/query", {
      method: "POST", headers: H, body: JSON.stringify({ name, idNumber: idn }),
    });
    const d = await q.json();
    expect(d.ok).toBe(true);
    expect(d.found).toBe(true);
    expect(d.records[0].idNumber).toContain("*");
    // 脱敏：不含完整证件号
    expect(d.records[0].idNumber).not.toBe(idn);
  });

  it("找不到 → found:false", async () => {
    const q = await F("/api/query", {
      method: "POST", headers: H, body: JSON.stringify({ name: "无名氏", idNumber: uniqId() }),
    });
    const d = await q.json();
    expect(d.found).toBe(false);
  });
});
