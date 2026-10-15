/** 限流：KV 计数（尽力而为），key 含 route 维度 */
import { KV, RL_WINDOW } from "@chsi/shared";

/** @returns {Promise<boolean>} true=放行 false=超限 */
export async function rateLimit(env, route, ip, limit) {
  const key = KV.rl(route, ip || "unknown");
  const cur = await env.KV.get(key);
  const n = parseInt(cur || "0", 10);
  if (n >= limit) return false;
  await env.KV.put(key, String(n + 1), { expirationTtl: RL_WINDOW });
  return true;
}

export function clientIp(req) {
  return req.headers.get("CF-Connecting-IP") || "unknown";
}
