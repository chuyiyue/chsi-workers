/**
 * 通用资源存储（KV）。
 *
 *   <res>:<id>                      记录 JSON；metadata 放列表需要的短字段
 *   u:<res>:<field>:<value>  -> id  唯一索引（先写索引、后写记录）
 *   audit:<反向时间戳>:<rand>        审计日志（90 天 TTL）
 *
 * id 以「反向时间戳」开头，所以 KV.list 的字典序 = 新建时间倒序，列表不需要排序。
 */
import { HttpError } from "./http.js";
import { randHex, makePassword, encryptText, decryptText, maskId } from "./crypto.js";
import { resources } from "../schema.js";

const META_BUDGET = 900; // KV metadata 上限 1024 字节，留出余量
const PAGE_SCAN = 200;
const MAX_PAGES_PER_REQUEST = 10;
const AUDIT_TTL = 90 * 24 * 3600;

const revTs = () => (9999999999999 - Date.now()).toString(36).padStart(9, "0");
export const newId = () => revTs() + randHex(4);
export const isId = (s) => /^[0-9a-z]{12,24}$/.test(s);

const metaFields = (res) =>
  res.fields.filter(
    (f) => f.type !== "secret" && f.type !== "password" &&
      (f.list || f.type === "ref" || f.filter || f.key === res.labelField || f.key === res.breakdown),
  );

export function toMeta(res, rec) {
  const m = {};
  for (const f of metaFields(res)) {
    const v = rec[f.key];
    if (v === undefined || v === "") continue;
    m[f.key] = typeof v === "string" ? v.slice(0, 60) : v;
  }
  m.createdAt = rec.createdAt;
  const keep = new Set(["createdAt", res.labelField]);
  while (JSON.stringify(m).length > META_BUDGET) {
    const victim = Object.keys(m).filter((k) => !keep.has(k)).sort((a, b) => String(m[b]).length - String(m[a]).length)[0];
    if (!victim) break;
    delete m[victim];
  }
  return m;
}

const recKey = (res, id) => `${res.key}:${id}`;
const uniqKey = (res, f, v) => `u:${res.key}:${f.key}:${String(v).toLowerCase()}`;

export const getRecord = (env, res, id) => env.KV.get(recKey(res, id), "json");

/* ---------------- 列表 ---------------- */

export async function listRecords(env, res, { cursor, q, filters = {}, limit = 50 }) {
  const needle = (q || "").trim().toLowerCase();
  const searchKeys = res.fields.filter((f) => f.search).map((f) => f.key);
  const filtering = needle || Object.keys(filters).length > 0;
  const prefix = `${res.key}:`;
  const rows = [];
  let next = cursor || undefined;
  let complete = false;

  for (let page = 0; page < (filtering ? MAX_PAGES_PER_REQUEST : 1); page++) {
    const r = await env.KV.list({ prefix, cursor: next, limit: filtering ? PAGE_SCAN : limit });
    for (const k of r.keys) {
      const meta = k.metadata || {};
      if (!Object.entries(filters).every(([key, val]) => String(meta[key] ?? "") === val)) continue;
      if (needle && !searchKeys.some((key) => String(meta[key] ?? "").toLowerCase().includes(needle))) continue;
      rows.push({ id: k.name.slice(prefix.length), ...meta });
    }
    complete = r.list_complete;
    next = r.list_complete ? undefined : r.cursor;
    if (complete || rows.length >= limit) break;
  }
  return { rows, cursor: complete ? null : next };
}

/** 选项（ref 下拉用）：id + 显示名。只取第一页 1000 条。 */
export async function listOptions(env, res) {
  const r = await env.KV.list({ prefix: `${res.key}:`, limit: 1000 });
  return {
    options: r.keys.map((k) => ({ id: k.name.slice(res.key.length + 1), label: (k.metadata || {})[res.labelField] || "（未命名）" })),
    more: !r.list_complete,
  };
}

/* ---------------- 校验 ---------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function validate(env, res, body, existing) {
  const errors = {};
  const out = {};
  const creating = !existing;

  for (const f of res.fields) {
    if (f.immutable && !creating) continue;
    const has = Object.prototype.hasOwnProperty.call(body, f.key);
    if (!has && !creating) continue;
    let v = body[f.key];
    const empty = v === undefined || v === null || v === "";
    const need = f.required || (creating && f.requiredOnCreate);

    if (f.type === "boolean") {
      out[f.key] = v === true || v === "true" || v === 1 || v === "1";
      continue;
    }
    if (empty) {
      if (f.type === "secret" || f.type === "password") {
        if (need && creating) errors[f.key] = `请填写${f.label}`;
        continue; // 留空 = 不修改
      }
      if (need) errors[f.key] = `请填写${f.label}`;
      else out[f.key] = "";
      continue;
    }
    if (typeof v !== "string") { errors[f.key] = `${f.label}格式不正确`; continue; }
    v = v.trim();

    const max = f.max || (f.type === "textarea" ? 500 : 60);
    if (v.length > max) { errors[f.key] = `${f.label}最多 ${max} 个字符`; continue; }
    if (f.min && v.length < f.min) { errors[f.key] = `${f.label}至少 ${f.min} 个字符`; continue; }
    if (f.pattern && !new RegExp(f.pattern).test(v)) { errors[f.key] = f.hint || `${f.label}格式不正确`; continue; }

    switch (f.type) {
      case "select":
        if (!f.options.includes(v)) errors[f.key] = `${f.label}不在可选范围内`;
        else out[f.key] = v;
        break;
      case "date":
        if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) errors[f.key] = `${f.label}需要是 YYYY-MM-DD`;
        else out[f.key] = v;
        break;
      case "ref": {
        const target = resources.find((r) => r.key === f.to);
        if (!target || !isId(v) || !(await env.KV.get(recKey(target, v)))) errors[f.key] = `所选${target ? target.label : f.label}不存在`;
        else out[f.key] = v;
        break;
      }
      case "secret":
        out[f.key] = await encryptText(env, v);
        break;
      case "password":
        out[f.key] = await makePassword(v);
        break;
      default:
        out[f.key] = v;
    }
  }
  return { errors, out };
}

/* ---------------- 写入 ---------------- */

async function checkUnique(env, res, out, selfId) {
  const errors = {};
  for (const f of res.fields.filter((f) => f.unique && out[f.key])) {
    const owner = await env.KV.get(uniqKey(res, f, out[f.key]));
    if (owner && owner !== selfId) errors[f.key] = `${f.label}已被使用`;
  }
  return errors;
}

export async function createRecord(env, res, body) {
  const { errors, out } = await validate(env, res, body, null);
  Object.assign(errors, await checkUnique(env, res, out, null));
  if (Object.keys(errors).length) throw new HttpError(400, "请检查表单中标红的字段", errors);

  const id = newId();
  const now = new Date().toISOString();
  const rec = { id, ...out, createdAt: now, updatedAt: now };
  for (const f of res.fields.filter((f) => f.unique && rec[f.key])) await env.KV.put(uniqKey(res, f, rec[f.key]), id);
  await env.KV.put(recKey(res, id), JSON.stringify(rec), { metadata: toMeta(res, rec) });
  return rec;
}

export async function updateRecord(env, res, id, body) {
  const old = await getRecord(env, res, id);
  if (!old) throw new HttpError(404, "记录不存在或已被删除");
  const { errors, out } = await validate(env, res, body, old);
  Object.assign(errors, await checkUnique(env, res, out, id));
  if (Object.keys(errors).length) throw new HttpError(400, "请检查表单中标红的字段", errors);

  const rec = { ...old, ...out, updatedAt: new Date().toISOString() };
  const moved = [];
  for (const f of res.fields.filter((f) => f.unique)) {
    if (rec[f.key] && rec[f.key] !== old[f.key]) {
      await env.KV.put(uniqKey(res, f, rec[f.key]), id);
      if (old[f.key]) moved.push(uniqKey(res, f, old[f.key]));
    }
  }
  await env.KV.put(recKey(res, id), JSON.stringify(rec), { metadata: toMeta(res, rec) });
  for (const k of moved) await env.KV.delete(k);
  return rec;
}

export async function deleteRecord(env, res, id) {
  const old = await getRecord(env, res, id);
  if (!old) throw new HttpError(404, "记录不存在或已被删除");

  // 引用保护：有其他资源还指向它时不允许删除
  for (const other of resources) {
    for (const f of other.fields.filter((f) => f.type === "ref" && f.to === res.key)) {
      let cursor;
      do {
        const r = await env.KV.list({ prefix: `${other.key}:`, cursor, limit: 1000 });
        if (r.keys.some((k) => (k.metadata || {})[f.key] === id)) {
          throw new HttpError(409, `还有${other.label}在使用这条${res.label}，请先处理那些${other.label}`);
        }
        cursor = r.list_complete ? undefined : r.cursor;
      } while (cursor);
    }
  }
  for (const f of res.fields.filter((f) => f.unique && old[f.key])) await env.KV.delete(uniqKey(res, f, old[f.key]));
  await env.KV.delete(recKey(res, id));
  return old;
}

/** 返回给前端的记录：密码不出库；密文换成脱敏值放进 _masks */
export async function present(env, res, rec) {
  const out = { ...rec };
  const masks = {};
  for (const f of res.fields) {
    if (f.type === "password") delete out[f.key];
    if (f.type === "secret") {
      if (out[f.key]) {
        try { masks[f.key] = maskId(await decryptText(env, out[f.key])); } catch { masks[f.key] = "已设置"; }
      }
      delete out[f.key];
    }
  }
  if (Object.keys(masks).length) out._masks = masks;
  return out;
}

/* ---------------- 统计与审计 ---------------- */

export async function stats(env) {
  const counts = {};
  const breakdown = {};
  for (const res of resources) {
    const r = await env.KV.list({ prefix: `${res.key}:`, limit: 1000 });
    counts[res.key] = { n: r.keys.length, more: !r.list_complete };
    if (res.breakdown) {
      const dist = {};
      for (const k of r.keys) {
        const v = (k.metadata || {})[res.breakdown] || "未设置";
        dist[v] = (dist[v] || 0) + 1;
      }
      breakdown[res.key] = dist;
    }
  }
  return { counts, breakdown };
}

export async function writeAudit(env, { action, target, ip }) {
  await env.KV.put(`audit:${revTs()}:${randHex(3)}`, "1", {
    expirationTtl: AUDIT_TTL,
    metadata: { action, target: String(target).slice(0, 80), at: new Date().toISOString(), ip: ip || "" },
  });
}

export async function listAudit(env, { cursor, limit = 50 }) {
  const r = await env.KV.list({ prefix: "audit:", cursor: cursor || undefined, limit });
  return { rows: r.keys.map((k) => ({ id: k.name, ...(k.metadata || {}) })), cursor: r.list_complete ? null : r.cursor };
}
