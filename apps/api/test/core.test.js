import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

const BASE = "http://example.com";
// 限流按 IP 计数；默认 CF-Connecting-IP=unknown 会让所有用例共用同一个桶，
// 登录 10/min 会被跨用例打满 → 用例互相污染。每个请求发独立 IP；
// 需要验证限流的用例显式指定固定 IP。
let ipSeq = 0;
const nextIp = () => `10.${(++ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
async function F(path, init = {}) {
  const { ip, headers, ...rest } = init;
  return SELF.fetch(BASE + path, {
    ...rest,
    headers: { "CF-Connecting-IP": ip || nextIp(), ...(headers || {}) },
  });
}

const H = { "Content-Type": "application/json" };
const uniq = () => "u" + Math.random().toString(36).slice(2, 10);

function parseCookie(r) {
  const sc = r.headers.get("Set-Cookie") || "";
  const m = sc.match(/session=([0-9a-f]+)/);
  return m ? `session=${m[1]}` : "";
}
async function login(username, password, ip) {
  const r = await F("/api/login", { method: "POST", headers: H, ip, body: JSON.stringify({ username, password }) });
  return { r, cookie: parseCookie(r) };
}
async function adminCookie() {
  const { cookie } = await login("admin", "test-admin-pw");
  return cookie;
}
/** 学员账号由管理后台开通（自助注册已下线） */
async function createUser(admin, username, password = "pass1234") {
  const r = await F("/api/admin/users", {
    method: "POST", headers: { ...H, Cookie: admin }, body: JSON.stringify({ username, password }),
  });
  return r;
}
/** 建号 + 登录，返回该学员的 cookie */
async function newStudent(admin, password = "pass1234") {
  const u = uniq();
  const r = await createUser(admin, u, password);
  expect(r.status).toBe(200);
  const { cookie } = await login(u, password);
  return { username: u, cookie };
}
async function mkRecord(cookie, extra = {}) {
  const r = await F("/api/my/enrollments", {
    method: "POST", headers: { ...H, Cookie: cookie },
    body: JSON.stringify({ name: "张三", idNumber: "110101199001011234", ...extra }),
  });
  return { r, d: await r.json() };
}

/* ---------------- 登录基线 ---------------- */
describe("login", () => {
  it("登录后 me 可用；登出后 401", async () => {
    const admin = await adminCookie();
    const { username, cookie } = await newStudent(admin);
    expect(cookie).not.toBe("");
    const me = await F("/api/me", { headers: { Cookie: cookie } });
    const d = await me.json();
    expect(d.ok).toBe(true);
    expect(d.user.username).toBe(username);
    const lo = await F("/api/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(lo.status).toBe(200);
    const me2 = await F("/api/me", { headers: { Cookie: cookie } });
    expect(me2.status).toBe(401);
  });

  it("自助注册已下线：/api/register 与 /api/query 均 404", async () => {
    const r1 = await F("/api/register", { method: "POST", headers: H, body: JSON.stringify({ username: uniq(), password: "pass1234" }) });
    expect(r1.status).toBe(404);
    const r2 = await F("/api/query", { method: "POST", headers: H, body: JSON.stringify({ name: "张三", idNumber: "110101199001011234" }) });
    expect(r2.status).toBe(404);
  });

  it("非字符串 username → 400（不是 500）", async () => {
    const r = await F("/api/login", { method: "POST", headers: H, body: JSON.stringify({ username: 12345, password: "pass1234" }) });
    expect(r.status).toBe(400);
    expect((await r.json()).ok).toBe(false);
  });

  it("admin 登录走环境密钥；错密码 401", async () => {
    const bad = await login("admin", "wrongpw");
    expect(bad.r.status).toBe(401);
    const good = await login("admin", "test-admin-pw");
    expect(good.r.status).toBe(200);
  });

  it("连续错密码触发限流 429", async () => {
    const ip = "192.0.2.77"; // 固定 IP：需在同一桶里连打
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await login(uniq(), "wrongpw" + i, ip);
      last = r.r.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

/* ---------------- session 失效语义（走 /api/my/change-password） ---------------- */
describe("session lifecycle", () => {
  it("改密后：旧会话失效（回 401），当前设备拿到新 cookie 可用", async () => {
    const admin = await adminCookie();
    const { username, cookie: c1 } = await newStudent(admin);
    const { cookie: c2 } = await login(username, "pass1234");
    const cp = await F("/api/my/change-password", {
      method: "POST", headers: { ...H, Cookie: c2 },
      body: JSON.stringify({ oldPassword: "pass1234", newPassword: "newpass99" }),
    });
    expect(cp.status).toBe(200);
    // 旧会话必须死
    const me1 = await F("/api/me", { headers: { Cookie: c1 } });
    expect(me1.status).toBe(401);
    // 改密端拿到新 cookie 可用
    const newCookie = parseCookie(cp);
    expect(newCookie).not.toBe("");
    const me2 = await F("/api/me", { headers: { Cookie: newCookie } });
    expect(me2.status).toBe(200);
    // 旧密码不能再用，新密码可用
    expect((await login(username, "pass1234")).r.status).toBe(401);
    expect((await login(username, "newpass99")).r.status).toBe(200);
  });

  it("管理员删号后：该用户旧会话失效", async () => {
    const admin = await adminCookie();
    const { username, cookie: cu } = await newStudent(admin);
    const lu = await F("/api/admin/users", { headers: { Cookie: admin } });
    const users = (await lu.json()).users;
    const me = users.find((x) => x.username === username);
    expect(me).toBeTruthy();
    const del = await F(`/api/admin/users/${me.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(del.status).toBe(200);
    const meU = await F("/api/me", { headers: { Cookie: cu } });
    expect(meU.status).toBe(401);
  });
});

/* ---------------- /api/my/*：教育经历自助 ---------------- */
describe("/api/my/enrollments", () => {
  it("未登录一律 401", async () => {
    for (const [m, p] of [["GET", "/api/my/enrollments"], ["GET", "/api/my/profile"], ["POST", "/api/my/change-password"]]) {
      const r = await F(p, { method: m, headers: H, body: m === "GET" ? undefined : "{}" });
      expect(r.status).toBe(401);
    }
  });

  it("学员只能看到自己的记录（互相隔离，他人详情 404）", async () => {
    const admin = await adminCookie();
    const a = await newStudent(admin);
    const b = await newStudent(admin);
    const { d } = await mkRecord(a.cookie, { major: "计算机" });
    const sid = d.enrollment.sid;
    expect(sid).toBeTruthy();
    const mine = await (await F("/api/my/enrollments", { headers: { Cookie: a.cookie } })).json();
    expect(mine.total).toBe(1);
    const other = await (await F("/api/my/enrollments", { headers: { Cookie: b.cookie } })).json();
    expect(other.total).toBe(0);
    const peek = await F(`/api/my/enrollments/${sid}`, { headers: { Cookie: b.cookie } });
    expect(peek.status).toBe(404);
  });

  it("自助增删改 + 状态归入学历分类", async () => {
    const admin = await adminCookie();
    const { cookie } = await newStudent(admin);
    // 学籍类
    const { d: d1 } = await mkRecord(cookie, { major: "护理", status: "在读" });
    expect(d1.enrollment.type).toBe("xueji");
    // 已结业 → 学历类
    const { d: d2 } = await mkRecord(cookie, { major: "护理", status: "已结业", gradDate: "2026-06" });
    expect(d2.enrollment.type).toBe("xueli");
    // 有学位名称 → 学位类
    const { d: d3 } = await mkRecord(cookie, { major: "护理", status: "已结业", degreeName: "学士" });
    expect(d3.enrollment.type).toBe("degree");

    const eduOnly = await (await F("/api/my/enrollments?kind=edu", { headers: { Cookie: cookie } })).json();
    expect(eduOnly.total).toBe(2);
    const xuejiOnly = await (await F("/api/my/enrollments?kind=xueji", { headers: { Cookie: cookie } })).json();
    expect(xuejiOnly.total).toBe(1);

    // 编辑
    const up = await F(`/api/my/enrollments/${d1.enrollment.sid}`, {
      method: "PUT", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ className: "一班" }),
    });
    expect(up.status).toBe(200);
    expect((await up.json()).enrollment.className).toBe("一班");

    // 删除
    const del = await F(`/api/my/enrollments/${d1.enrollment.sid}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(200);
    const after = await (await F("/api/my/enrollments", { headers: { Cookie: cookie } })).json();
    expect(after.total).toBe(2);
  });

  it("照片：data URL 拆离不留 base64，且可鉴权取回", async () => {
    const admin = await adminCookie();
    const { cookie } = await newStudent(admin);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { r, d } = await mkRecord(cookie, { photo: `data:image/png;base64,${png}` });
    expect(r.status).toBe(200);
    expect(JSON.stringify(d.enrollment)).not.toContain("iVBORw0");
    const key = d.enrollment.photoKeys.photo.key; // photos/<sid>/photo.bin
    const [, sid, name] = key.split("/");
    const pr = await F(`/api/photos/${sid}/${name}`, { headers: { Cookie: cookie } });
    expect(pr.status).toBe(200);
    // 他人取不到（403 = 无权限；key 里带 sid，不属于自己）
    const other = await newStudent(admin);
    const pr2 = await F(`/api/photos/${sid}/${name}`, { headers: { Cookie: other.cookie } });
    expect(pr2.status).toBe(403);
  });

  it("XSS 载荷 URL 被拒（不入库）", async () => {
    const admin = await adminCookie();
    const { cookie } = await newStudent(admin);
    const { r, d } = await mkRecord(cookie, { photo: 'https://evil.example/a"onerror="x()//' });
    expect(r.status).toBe(200);
    expect(d.enrollment.photoKeys?.photo?.url ?? "").not.toContain("onerror");
  });
});

/* ---------------- /api/my/profile ---------------- */
describe("/api/my/profile", () => {
  it("只允许改联系方式；非法手机号 400；用户名不可改", async () => {
    const admin = await adminCookie();
    const { username, cookie } = await newStudent(admin);
    const before = await (await F("/api/my/profile", { headers: { Cookie: cookie } })).json();
    expect(before.profile.username).toBe(username);

    const badPhone = await F("/api/my/profile", {
      method: "PUT", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ phone: "abc" }),
    });
    expect(badPhone.status).toBe(400);

    const ok = await F("/api/my/profile", {
      method: "PUT", headers: { ...H, Cookie: cookie },
      body: JSON.stringify({ phone: "13800001111", displayName: "小明", username: "hacker" }),
    });
    expect(ok.status).toBe(200);
    const after = (await ok.json()).profile;
    expect(after.phone).toBe("13800001111");
    expect(after.displayName).toBe("小明");
    expect(after.username).toBe(username); // 改名被忽略
    expect(after.password).toBeUndefined();
    expect(after.passHash).toBeUndefined();
  });
});

/* ---------------- 管理员视角：分页不截断 ---------------- */
describe("admin students", () => {
  it("1010 条记录全可见（>1000 分页不截断）", { timeout: 600_000 }, async () => {
    const admin = await adminCookie();
    const { username } = await newStudent(admin);
    const N = 1010;
    const batch = 20;
    const created = new Set();
    for (let i = 0; i < N; i += batch) {
      const n = Math.min(batch, N - i); // 尾批截断
      const rs = await Promise.all(Array.from({ length: n }, (_, j) =>
        F("/api/students", {
          method: "POST", headers: { ...H, Cookie: admin },
          body: JSON.stringify({
            name: `学员${i + j}`, idNumber: `11010119900101${String((i + j) % 10000).padStart(4, "0")}`,
            ownerUsername: username,
          }),
        }).then(async (r) => ({ r, d: await r.json() }))
      ));
      for (const x of rs) {
        expect(x.r.status).toBe(200);
        created.add(x.d.student.sid);
      }
    }
    expect(created.size).toBe(N);
    let cursor = 0; const seen = new Set(); let guard = 0;
    while (true) {
      const r = await F(`/api/students?limit=100&cursor=${cursor}`, { headers: { Cookie: admin } });
      const d = await r.json();
      for (const s of d.students) seen.add(s.sid);
      if (!d.nextCursor || guard++ > 30) break;
      cursor = d.nextCursor;
    }
    // 关键断言：创建的每一条都能通过分页翻到（旧版 KV list 1000 截断会丢尾部）
    const missing = [...created].filter((sid) => !seen.has(sid));
    expect(missing, `分页丢失 ${missing.length} 条`).toEqual([]);
  });
});
