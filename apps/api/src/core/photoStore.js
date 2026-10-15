/** 照片存储：R2 优先；无 R2 binding 时降级 KV 拆键 */
import { R2 } from "@chsi/shared";

const MAX_PHOTO = 3 * 1024 * 1024; // 3MB

/** data:image/...;base64,XXX → Buffer 对象 + mime；http(s) URL → 直接存 URL */
export function parsePhotoInput(v) {
  if (typeof v !== "string") return { kind: "empty" };
  const s = v.trim();
  if (!s) return { kind: "empty" };
  if (/^https?:\/\//i.test(s)) {
    // 仅 http(s)，不放大引号或空格
    if (/["'\\\s]/.test(s)) return { kind: "empty" };
    return { kind: "url", url: s.slice(0, 2000) };
  }
  const m = s.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return { kind: "empty" };
  const mime = m[1].toLowerCase();
  const bytes = base64ToBytes(m[2]);
  if (bytes.length > MAX_PHOTO) return { kind: "too_large" };
  return { kind: "bytes", mime, bytes };
}

/** 存照片；返回 {kind, key?, url?} */
export async function savePhoto(env, sid, n, input) {
  if (input.kind === "empty") return { kind: "empty" };
  if (input.kind === "url") return { kind: "url", url: input.url };
  if (input.kind === "too_large") return { kind: "too_large" };
  const key = R2.photo(sid, n);
  if (env.R2) {
    await env.R2.put(key, input.bytes, {
      httpMetadata: { contentType: input.mime },
    });
    return { kind: "r2", key };
  }
  // 降级：KV 拆键（binary 存 base64）
  await env.KV.put(`photo:${key}`, bytesToBase64(input.bytes), {
    httpMetadata: { contentType: input.mime },
  });
  return { kind: "kv", key };
}

/** 读照片；用于展示路由 */
export async function loadPhoto(env, key) {
  if (env.R2) {
    const obj = await env.R2.get(key);
    if (!obj) return null;
    return { body: obj.body, mime: obj.httpMetadata?.contentType || "application/octet-stream" };
  }
  const v = await env.KV.get(`photo:${key}`);
  if (!v) return null;
  // mime 从 content-type 存在 httpMetadata 的会丢失，用扩展名兜底
  const mime = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { body: base64ToBytes(v), mime };
}

/** 删除照片（记录删除时调用） */
export async function deletePhoto(env, key) {
  if (!key) return;
  if (env.R2) { await env.R2.delete(key); return; }
  await env.KV.delete(`photo:${key}`);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToBase64(u8) {
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin);
}
