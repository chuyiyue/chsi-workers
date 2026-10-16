/** my 路由：学员自助端 —— 教育经历（学籍/学历）自有记录 + 个人资料 + 改密 */
import { KV, ERROR_CODES, REC_TYPE, STATUS_LIST } from "@chsi/shared";
import { ok, err } from "../core/http.js";
import { validateStudentFields, asObject, trimStr } from "../core/validator.js";
import { password as pwOf } from "../core/validator.js";
import { hashPassword, newSalt, verifyPassword, randHex } from "../core/password.js";
import { createSession, getSessionUser, invalidateUserSessions, sessionHeaders } from "../core/session.js";
import { getJSON, putJSON } from "../core/kv.js";
import { parsePhotoInput, savePhoto, deletePhoto } from "../core/photoStore.js";

/** 资料允许学员自改的字段 */
const PROFILE_EDITABLE = ["phone", "email", "displayName", "avatar"];

function pickProfile(u) {
  const out = { username: u.username, role: u.role };
  for (const k of PROFILE_EDITABLE) out[k] = u[k] || "";
  return out;
}

/** 归当前登录学员所有的记录（管理员也可走 /api/my/*，只看自己的） */
async function ownRecord(env, user, sid) {
  if (!/^[0-9a-f]{24}$/.test(sid)) return null;
  return getJSON(env.KV, KV.student(user.uid, sid));
}

/** 列表：只列本人记录；可按 kind=edu|status= 过滤 */
async function listMine(env, user) {
  const keys = [];
  let cursor;
  for (let i = 0; i < 1000; i++) {
    const page = await env.KV.list({ prefix: KV.studentPrefixFor(user.uid), cursor });
    keys.push(...page.keys);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  const out = [];
  for (const k of keys) {
    const rec = await getJSON(env.KV, k.name);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out;
}

/** 学员视图：不吐照片字节，photoKeys 换成可按需取的指示 */
function myView(rec) {
  const { photo, photo2, ...rest } = rec;
  return { ...rest, hasPhoto: !!rec.photoKeys?.photo, hasPhoto2: !!rec.photoKeys?.photo2 };
}

/** 判断记录类型：学历（已结业/学位）与学籍两类 */
function kindOf(rec) {
  if (rec.degreeName) return REC_TYPE.DEGREE;
  if (rec.status === "已结业") return REC_TYPE.XUELI;
  return REC_TYPE.XUEJI;
}

export function registerMyRoutes(router) {
  /* ---------- 教育经历列表 / 详情 ---------- */
  router.add("GET", "/api/my/enrollments", async ({ req, env }) => {
    const r = await requireSelf(env, req);
    if (r.err) return r.err;
    const url = new URL(req.url);
    const kind = trimStr(url.searchParams.get("kind"), 20); // edu=学历类 / xueji=学籍类
    const statusFilter = trimStr(url.searchParams.get("status"), 20);
    let recs = await listMine(env, r.user);
    if (kind === "edu") recs = recs.filter((x) => kindOf(x) !== REC_TYPE.XUEJI);
    if (kind === "xueji") recs = recs.filter((x) => kindOf(x) === REC_TYPE.XUEJI);
    if (statusFilter && STATUS_LIST.includes(statusFilter)) recs = recs.filter((x) => x.status === statusFilter);
    return ok({ enrollments: recs.map(myView), total: recs.length });
  });

  router.add("GET", "/api/my/enrollments/:sid", async ({ req, env, params }) => {
    const r = await requireSelf(env, req);
    if (r.err) return r.err;
    const rec = await ownRecord(env, r.user, params.sid);
    if (!rec) return err(404, ERROR_CODES.NOT_FOUND, "记录不存在");
    return ok({ enrollment: myView(rec) });
  });

  /* ---------- 教育经历：学员自助新增 / 编辑 / 删除 ---------- */
  router.add("POST", "/api/my/enrollments", async ({ req, env }) => {
    const r = await requireSelf(env, req);
    if (r.err) return r.err;
    const b = asObject(await safeJson(req));
    const { errs, out } = validateStudentFields(b);
    if (errs.length) return err(400, ERROR_CODES.VALIDATION, errs[0]);
    const sid = randHex(12);
    const now = new Date().toISOString();
    const rec = {
      sid, ownerId: r.user.uid, ownerUsername: r.user.username, orgId: r.user.orgId || "demo",
      createdAt: now, updatedAt: now,
      ...out,
    };
    const saved = await savePhotos(env, rec, b, sid, {});
    if (saved.err) return saved.err;
    rec.type = kindOf(rec);
    await putJSON(env.KV, KV.student(r.user.uid, sid), rec);
    return ok({ enrollment: myView(rec) });
  });

  router.add("PUT", "/api/my/enrollments/:sid", async ({ req, env, params }) => {
    const r = await requireSelf(env, req);
    if (r.err) return r.err;
    const old = await ownRecord(env, r.user, params.sid);
    if (!old) return err(404, ERROR_CODES.NOT_FOUND, "记录不存在");
    const b = asObject(await safeJson(req));
    const merged = { ...old, ...pickUpdatable(b) };
    const { errs, out } = validateStudentFields(merged);
    if (errs.length) return err(400, ERROR_CODES.VALIDATION, errs[0]);
    const rec = { ...old, ...out, updatedAt: new Date().toISOString() };
    const saved = await savePhotos(env, rec, b, old.sid, old.photoKeys || {});
    if (saved.err) return saved.err;
    delete rec.photo; delete rec.photo2;
    rec.type = kindOf(rec);
    await putJSON(env.KV, KV.student(r.user.uid, old.sid), rec);
    return ok({ enrollment: myView(rec) });
  });

  router.add("DELETE", "/api/my/enrollments/:sid", async ({ req, env, params }) => {
    const r = await requireSelf(env, req);
    if (r.err) return r.err;
    const rec = await ownRecord(env, r.user, params.sid);
    if (!rec) return err(404, ERROR_CODES.NOT_FOUND, "记录不存在");
    for (const n of ["photo", "photo2"]) {
      if (rec.photoKeys?.[n]?.key) await deletePhoto(env, rec.photoKeys[n].key);
    }
    await env.KV.delete(KV.student(r.user.uid, rec.sid));
    return ok();
  });

  /* ---------- 个人资料 ---------- */
  router.add("GET", "/api/my/profile", async ({ req, env }) => {
    const r = await requireSelf(env, req);
    if (r.err) return r.err;
    const stored = await getJSON(env.KV, KV.user(r.user.username));
    if (!stored) return ok({ profile: pickProfile({ username: r.user.username, role: r.user.role }) });
    return ok({ profile: pickProfile(stored) });
  });

  router.add("PUT", "/api/my/profile", async ({ req, env }) => {
    const r = await requireSelf(env, req);
    if (r.err) return r.err;
    if (r.user.role === "admin") {
      return err(400, ERROR_CODES.VALIDATION, "管理员账号资料不在此维护");
    }
    const stored = await getJSON(env.KV, KV.user(r.user.username));
    if (!stored) return err(404, ERROR_CODES.NOT_FOUND, "用户不存在");
    const b = asObject(await safeJson(req));
    // 只接受白名单字段；手机号做宽松校验
    if (b.phone !== undefined) {
      const p = trimStr(b.phone, 20).replace(/\s+/g, "");
      if (p && !/^\+?\d{6,20}$/.test(p)) return err(400, ERROR_CODES.VALIDATION, "手机号格式不正确");
      stored.phone = p;
    }
    for (const k of ["email", "displayName"]) {
      if (b[k] !== undefined) stored[k] = trimStr(b[k], 60);
    }
    if (b.avatar !== undefined) {
      const a = trimStr(b.avatar, 2000);
      if (a && !/^https?:\/\//i.test(a)) return err(400, ERROR_CODES.VALIDATION, "头像需为 http(s) 链接");
      stored.avatar = a;
    }
    stored.updatedAt = new Date().toISOString();
    await putJSON(env.KV, KV.user(stored.username), stored);
    return ok({ profile: pickProfile(stored) });
  });

  /* ---------- 改密码：URL 兼容方案里的 /api/my/change-password ---------- */
  const changePw = async ({ req, env }) => {
    const s = await getSessionUser(env, req);
    if (!s) return err(401, ERROR_CODES.UNAUTHORIZED, "未登录");
    if (s.role === "admin") return err(400, ERROR_CODES.VALIDATION, "管理员密码请通过部署密钥修改");
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
    await invalidateUserSessions(env, stored.id, stored.username);
    const token = await createSession(env, stored);
    return ok({}, sessionHeaders(token));
  };
  router.add("POST", "/api/my/change-password", changePw);
}

/** 与 /api/students 一致的照片处理：拆离存储，记录只留 photoKeys */
async function savePhotos(env, rec, body, sid, existingKeys) {
  const photoKeys = { ...existingKeys };
  for (const n of ["photo", "photo2"]) {
    const incoming = body[n];
    const parsed = parsePhotoInput(incoming ?? null);
    if (parsed.kind === "too_large") return { err: err(413, ERROR_CODES.PAYLOAD_TOO_LARGE, "照片超过 3MB 上限") };
    if (incoming === null) {
      if (existingKeys[n]?.key) await deletePhoto(env, existingKeys[n].key);
      delete photoKeys[n];
    } else if (incoming !== undefined) {
      const saved = await savePhoto(env, sid, n, parsed);
      if (saved.kind === "url") photoKeys[n] = { kind: "url", url: saved.url };
      else if (saved.kind === "r2" || saved.kind === "kv") {
        if (existingKeys[n]?.key) await deletePhoto(env, existingKeys[n].key);
        photoKeys[n] = { kind: "stored", key: saved.key };
      }
    }
  }
  rec.photoKeys = photoKeys;
  return { ok: true };
}

function pickUpdatable(b) {
  const pick = ["name", "gender", "ethnicity", "birthdate", "idType", "idNumber", "studentNo",
    "level", "major", "duration", "studyMode", "eduCategory", "branch", "dept", "className",
    "enrollDate", "gradDate", "gradType", "presidentName", "certNo", "status",
    "degreeName", "degreeUnit", "institution", "remark", "photo", "photo2"];
  const out = {};
  for (const k of pick) if (k in b) out[k] = b[k];
  return out;
}

async function requireSelf(env, req) {
  const s = await getSessionUser(env, req);
  if (!s) return { err: err(401, ERROR_CODES.UNAUTHORIZED, "未登录，请先登录") };
  return { user: s };
}

async function safeJson(req) {
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return {};
  try { return await req.json(); } catch { return {}; }
}
