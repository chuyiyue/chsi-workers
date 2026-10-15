/* 前台共享 API client + 工具（先保持原生 JS，M6 视需要升级 Vite 构建） */

export const INSTITUTION_DEFAULT = "某某职业技能培训学校";

export async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) {
    const e = new Error(d.error || `请求失败（${r.status}）`);
    e.code = d.code;
    throw e;
  }
  return d;
}

export async function getSettings() {
  try {
    return (await api("/api/settings")).settings;
  } catch {
    return { siteName: INSTITUTION_DEFAULT, demoTagFooter: true, demoTagCorner: true };
  }
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function maskId(id) {
  id = String(id || "");
  if (/^\d{17}[\dXx]$/.test(id)) return id.slice(0, 6) + "********" + id.slice(-4);
  if (id.length > 8) return id.slice(0, 3) + "****" + id.slice(-4);
  return "****";
}

export async function currentUser() {
  try { return (await api("/api/me")).user; } catch { return null; }
}

export function showMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "form-msg " + (ok ? "ok" : "error");
}
