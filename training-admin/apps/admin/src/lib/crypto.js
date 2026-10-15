const enc = new TextEncoder();
const dec = new TextDecoder();
const PBKDF2_ITER = 100000; // Workers 允许的上限

export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function randHex(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 常量时间比较 */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** 比较两个字符串而不泄露长度与内容：各自 HMAC 成等长摘要后再比较 */
export async function secretEquals(a, b) {
  const key = await crypto.subtle.importKey(
    "raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  return safeEqual(new Uint8Array(x), new Uint8Array(y));
}

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}

export async function makePassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await pbkdf2(password, salt, PBKDF2_ITER)), iter: PBKDF2_ITER };
}

export async function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(rec.salt), rec.iter || PBKDF2_ITER));
  return safeEqual(got, unb64(rec.hash));
}

/* ---- 字段级加密（证件号等）：AES-GCM，密钥来自 secret ID_ENC_KEY ---- */

async function aesKey(env) {
  if (!env.ID_ENC_KEY) throw new Error("ID_ENC_KEY 未配置");
  const raw = unb64(env.ID_ENC_KEY);
  if (raw.length !== 32) throw new Error("ID_ENC_KEY 必须是 32 字节的 base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptText(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(text));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptText(env, packed) {
  const [ver, iv, ct] = String(packed).split(".");
  if (ver !== "v1") throw new Error("未知的密文版本");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return dec.decode(pt);
}

/** 证件号脱敏：18 位保留前 6 后 4，其余保留首 3 尾 4 */
export function maskId(s) {
  s = String(s || "");
  if (/^\d{17}[\dXx]$/.test(s)) return s.slice(0, 6) + "********" + s.slice(-4);
  if (s.length > 8) return s.slice(0, 3) + "****" + s.slice(-4);
  return "****";
}
