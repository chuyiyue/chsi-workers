/** Turnstile 校验（服务端 siteverify），未配置时放行（本地 dev） */
export async function verifyTurnstile(env, token, ip) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return true; // dev bypass
  if (!token || typeof token !== "string") return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip || "" });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return false;
  const d = await res.json().catch(() => null);
  return !!(d && d.success);
}
