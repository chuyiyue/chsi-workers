/** KV 封装：所有 list 都跑 cursor 循环，杜绝 1000 截断 */
import { KV } from "@chsi/shared";

/** list 全量 cursor 循环（含循环上限保护） */
export async function listAll(kv, prefix) {
  const out = [];
  let cursor = undefined;
  for (let i = 0; i < 1000; i++) {
    const page = await kv.list({ prefix, cursor });
    out.push(...page.keys);
    if (page.list_complete || !page.cursor) return out;
    cursor = page.cursor;
  }
  throw new Error("KV list loop exceeded safety bound");
}

export async function getJSON(kv, key, fallback = null) {
  const v = await kv.get(key);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

export async function putJSON(kv, key, obj, opts = {}) {
  await kv.put(key, JSON.stringify(obj), opts);
}

export async function listJSON(kv, prefix) {
  const keys = await listAll(kv, prefix);
  const out = [];
  for (const k of keys) {
    const rec = await getJSON(kv, k.name);
    if (rec) out.push(rec);
  }
  return out;
}

export { KV };
