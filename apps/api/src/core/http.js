/** HTTP 助手：统一响应结构 / 错误码 / 安全响应头 */

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export function ok(data = {}, extraHeaders = {}) {
  return json({ ok: true, ...data }, 200, extraHeaders);
}

/** 统一错误：{ok:false, code, error, traceId} */
export function err(status, code, error, extra = {}) {
  const traceId = extra.traceId || crypto.randomUUID().slice(0, 8);
  const headers = extra.headers || {};
  delete extra.traceId; delete extra.headers;
  return json({ ok: false, code, error, traceId, ...extra }, status, headers);
}

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { Location: location, ...SECURITY_HEADERS } });
}

/** HTML 响应（静态代理用）：安全头 + CSP */
export function html(body, status = 200, extraHeaders = {}) {
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": csp,
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

/** 静态资产响应 */
export function asset(body, mime) {
  return new Response(body, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
