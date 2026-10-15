/** 网站设置（管理员）：站点名称、演示标识显隐、自定义机构名 */
import { ERROR_CODES } from "@chsi/shared";
import { ok, err } from "../core/http.js";
import { requireAdmin } from "../core/session.js";
import { getJSON, putJSON } from "../core/kv.js";
import { asObject } from "../core/validator.js";

const SETTINGS_KEY = "site:settings";

/** 默认值：演示标识页脚常显；顶部右上角标记显示 */
export const DEFAULT_SETTINGS = {
  siteName: "学籍档案（演示）",
  institution: "某某职业技能培训学校",
  demoTagFooter: true,   // 页脚常显演示标识
  demoTagCorner: true,   // 右上角演示标记
};

export async function getSettings(env) {
  const saved = await getJSON(env.KV, SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export function registerSettingsRoutes(router) {
  router.add("GET", "/api/settings", async ({ env }) => {
    return ok({ settings: await getSettings(env) });
  });

  router.add("PUT", "/api/admin/settings", async ({ req, env }) => {
    const r = await requireAdmin(env, req);
    if (r.err) return r.err;
    const b = asObject(await safeJson(req));
    const cur = await getSettings(env);
    const next = { ...cur };
    if (typeof b.siteName === "string") next.siteName = b.siteName.slice(0, 60);
    if (typeof b.institution === "string") next.institution = b.institution.slice(0, 60);
    for (const k of ["demoTagFooter", "demoTagCorner"]) {
      if (typeof b[k] === "boolean") next[k] = b[k];
    }
    await putJSON(env.KV, SETTINGS_KEY, next);
    return ok({ settings: next });
  });
}

async function safeJson(req) {
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return {};
  try { return await req.json(); } catch { return {}; }
}
