/** 口令哈希：加盐 SHA-256（v3 决策：演示系统，不升级 KDF；比较用恒时比较） */

/** hashPassword(password, saltHex) -> hex(sha256(salt::password)) */
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const d = await crypto.subtle.digest("SHA-256", enc.encode(`${saltHex}::${password}`));
  return bytesToHex(new Uint8Array(d));
}

export function newSalt() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** 随机 hex 串（默认 16 字节） */
export function randHex(nBytes = 16) {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** 恒时比较两个 hash 串 */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) {
    // 长度不同耗一点时间再 false，防止极短长度被跳过
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a));
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 校验口令（v3 格式：hex(sha256(salt::password))）；旧 pbkdf2 格式拒绝重设 */
export async function verifyPassword(password, stored, saltHex) {
  if (typeof stored !== "string" || stored.length !== 64) return false;
  const computed = await hashPassword(password, saltHex);
  return safeEqual(computed, stored);
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(u8) {
  return [...u8].map((x) => x.toString(16).padStart(2, "0")).join("");
}
