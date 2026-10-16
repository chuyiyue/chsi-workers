/** students 路由：列表（cursor 分页）/ 新增 / 详情 / 修改 / 删除 */
import { KV, ERROR_CODES, REC_TYPE, STATUS } from "@chsi/shared";
import { ok, err } from "../core/http.js";
import { validateStudentFields, asObject, str } from "../core/validator.js";
import { randHex } from "../core/password.js";
import { requireUser } from "../core/session.js";
import { listAll, getJSON, putJSON } from "../core/kv.js";
import { parsePhotoInput, savePhoto, deletePhoto } from "../core/photoStore.js";

/** 记录类型推导：status==已结业→xueli，degreeName 非空→degree，否则 xueji */
function deriveType(rec) {
  if (rec.type) return rec.type;
  if (rec.degreeName) return REC_TYPE.DEGREE;
  if (rec.status === STATUS.GRADUATED) return REC_TYPE.XUELI;
  return REC_TYPE.XUEJI;
}

/** 列表摘要：不含照片二进制，photoKeys 换成展示指示 */
function summary(rec) {
  const { photo, photo2, ...rest } = rec;
  return {
    ...rest,
    type: deriveType(rec),
    hasPhoto: !!photo, hasPhoto2: !!photo2,
  };
}

export function registerStudentRoutes(router) {
  router.add("GET", "/api/students", async ({ req, env }) => {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const isAdm = r.user.role === "admin";
    const prefix = isAdm ? "student:" : KV.studentPrefixFor(r.user.uid);
    const keys = await listAll(env.KV, prefix);
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10)));
    let cursor = parseInt(url.searchParams.get("cursor") || "0", 10) || 0;
    let recs = [];
    let total = 0;
    for (const k of keys) {
      const rec = await getJSON(env.KV, k.name);
      if (!rec) continue;
      if (isAdm && url.searchParams.get("ownerId") && rec.ownerId !== url.searchParams.get("ownerId")) continue;
      recs.push(rec);
      total++;
    }
    recs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const page = recs.slice(cursor, cursor + limit).map(summary);
    const nextCursor = cursor + limit < total ? cursor + limit : null;
    return ok({ students: page, total, cursor, nextCursor });
  });

  router.add("POST", "/api/students", async ({ req, env }) => {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const b = asObject(await safeJson(req));
    const { errs, out } = validateStudentFields(b);
    if (errs.length) return err(400, ERROR_CODES.VALIDATION, errs[0]);
    let ownerId = r.user.uid, ownerUsername = r.user.username;
    if (r.user.role === "admin" && typeof b.ownerUsername === "string" && b.ownerUsername.trim()) {
      const target = await getJSON(env.KV, KV.user(b.ownerUsername.trim()));
      if (!target) return err(400, ERROR_CODES.VALIDATION, "指定的归属用户不存在");
      ownerId = target.id; ownerUsername = target.username;
    }
    const sid = randHex(12);
    const now = new Date().toISOString();
    const rec = {
      sid, ownerId, ownerUsername, orgId: "demo",
      type: REC_TYPE.XUEJI, createdAt: now, updatedAt: now,
      ...out,
      photo: b.photo, photo2: b.photo2, // 先原样带上，save 拆离过程处理
    };
    // 照片：拆离存储，记录里只存 kind+key/url
    for (const n of ["photo", "photo2"]) {
      const parsed = parsePhotoInput(rec[n]);
      if (parsed.kind === "too_large") return err(413, ERROR_CODES.PAYLOAD_TOO_LARGE, "照片超过 3MB 上限");
      const saved = await savePhoto(env, sid, n, parsed);
      delete rec[n];
      rec.photoKeys = rec.photoKeys || {};
      if (saved.kind === "url") rec.photoKeys[n] = { kind: "url", url: saved.url };
      else if (saved.kind === "r2" || saved.kind === "kv") rec.photoKeys[n] = { kind: "stored", key: saved.key };
    }
    await putJSON(env.KV, KV.student(ownerId, sid), rec);
    return ok({ student: summary(rec) });
  });

  const SID = "/api/students/:sid";
  router.add("GET", SID, async ({ req, env, params }) => {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const rec = await findStudent(env, r.user, params.sid);
    if (!rec) return err(404, ERROR_CODES.NOT_FOUND, "记录不存在");
    return ok({ student: summary(rec) });
  });

  router.add("PUT", SID, async ({ req, env, params }) => {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const old = await findStudent(env, r.user, params.sid);
    if (!old) return err(404, ERROR_CODES.NOT_FOUND, "记录不存在");
    const b = asObject(await safeJson(req));
    // 局部更新：以 old 为基底
    const merged = { ...old, ...pickUpdatable(b) };
    const { errs, out } = validateStudentFields(merged);
    if (errs.length) return err(400, ERROR_CODES.VALIDATION, errs[0]);
    const rec = { ...old, ...out, updatedAt: new Date().toISOString() };
    // 照片更新：二选一（传新值覆盖，不传保留）
    for (const n of ["photo", "photo2"]) {
      const incoming = b[n];
      const parsed = parsePhotoInput(incoming ?? null);
      if (parsed.kind === "too_large") return err(413, ERROR_CODES.PAYLOAD_TOO_LARGE, "照片超过 3MB 上限");
      if (incoming === null) {
        // 显式 null 清除
        if (old.photoKeys?.[n]?.key) { await deletePhoto(env, old.photoKeys[n].key); }
        rec.photoKeys = { ...(rec.photoKeys || {}) };
        delete rec.photoKeys[n];
      } else if (incoming !== undefined) {
        const saved = await savePhoto(env, old.sid, n, parsed);
        rec.photoKeys = { ...(rec.photoKeys || {}) };
        if (saved.kind === "url") rec.photoKeys[n] = { kind: "url", url: saved.url };
        else if (saved.kind === "r2" || saved.kind === "kv") {
          if (old.photoKeys?.[n]?.key) { await deletePhoto(env, old.photoKeys[n].key); }
          rec.photoKeys[n] = { kind: "stored", key: saved.key };
        }
      }
    }
    delete rec.photo; delete rec.photo2;
    await putJSON(env.KV, KV.student(old.ownerId, old.sid), rec);
    return ok({ student: summary(rec) });
  });

  router.add("DELETE", SID, async ({ req, env, params }) => {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    const rec = await findStudent(env, r.user, params.sid);
    if (!rec) return err(404, ERROR_CODES.NOT_FOUND, "记录不存在");
    if (rec.photoKeys) {
      for (const n of ["photo", "photo2"]) {
        if (rec.photoKeys[n]?.key) { await deletePhoto(env, rec.photoKeys[n].key); }
      }
    }
    await env.KV.delete(KV.student(rec.ownerId, rec.sid));
    return ok();
  });
}

/** 用户/管理员可见性查找；含 1000+ 全量循环（listAll 已兜底） */
async function findStudent(env, user, sid) {
  if (!/^[0-9a-f]{24}$/.test(sid)) return null;
  const prefix = user.role === "admin" ? "student:" : KV.studentPrefixFor(user.uid);
  if (user.role !== "admin") {
    // O(1)：先猜 uid 前缀
    return getJSON(env.KV, KV.student(user.uid, sid));
  }
  const keys = await listAll(env.KV, prefix);
  for (const k of keys) {
    if (k.name.endsWith(`:${sid}`)) return getJSON(env.KV, k.name);
  }
  return null;
}

function pickUpdatable(b) {
  // 仅这些字段可被局部更新（owner、sid、createdAt 不可改）
  const pick = ["name", "gender", "ethnicity", "birthdate", "idType", "idNumber", "studentNo",
    "level", "major", "duration", "studyMode", "eduCategory", "branch", "dept", "className",
    "enrollDate", "gradDate", "gradType", "presidentName", "certNo", "status",
    "degreeName", "degreeUnit", "institution", "remark", "photo", "photo2"];
  const out = {};
  for (const k of pick) if (k in b) out[k] = b[k];
  return out;
}

async function safeJson(req) {
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return {};
  try { return await req.json(); } catch { return {}; }
}
