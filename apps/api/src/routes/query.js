/** 公开查询：索引键 O(1) 命中，Turnstile + 强限流 */
import { KV, ERROR_CODES, maskIdNumber } from "@chsi/shared";
import { ok, err } from "../core/http.js";
import { trimStr } from "../core/validator.js";
import { getJSON } from "../core/kv.js";
import { verifyTurnstile } from "../middleware/turnstile.js";
import { clientIp, rateLimit } from "../middleware/rateLimit.js";
import { QUERY_RL_LIMIT, STATUS, REC_TYPE } from "@chsi/shared";

export function registerQueryRoutes(router) {
  router.add("POST", "/api/v1/query", async ({ req, env }) => {
    const ip = clientIp(req);
    if (!(await rateLimit(env, "query", ip, QUERY_RL_LIMIT))) {
      return err(429, ERROR_CODES.RATE_LIMITED, "查询过于频繁，请稍后再试");
    }
    const b = await safeJson(req);
    if (!(await verifyTurnstile(env, b.turnstileToken, ip))) {
      return err(403, ERROR_CODES.CAPTCHA_FAILED, "人机验证未通过");
    }
    const name = trimStr(b.name, 40);
    const idn = trimStr(b.idNumber, 40).replace(/\s+/g, "");
    if (!name || !idn) return err(400, ERROR_CODES.VALIDATION, "请输入姓名和证件号码");
    const digest = await queryDigest(name, idn);
    const hit = await getJSON(env.KV, KV.idx(digest));
    if (!hit || !Array.isArray(hit.sids) || hit.sids.length === 0) {
      return ok({ found: false, records: [] });
    }
    // 索引指向的是该索引写入时的记录 keys；published 过滤在读取时做
    const records = [];
    const seen = new Set();
    for (const { key } of hit.sids) {
      if (seen.has(key)) continue;
      seen.add(key);
      const rec = await getJSON(env.KV, key);
      if (!rec || !rec.published) continue;
      // 记录被修改后如果 (name,idNumber) 变了，会被去索引机制在 PUT 里清理；读时兜底再校验
      if (rec.name !== name || rec.idNumber !== idn) continue;
      records.push(publicView(rec));
    }
    return ok({ found: records.length > 0, records });
  });
}

export async function queryDigest(name, idn) {
  const enc = new TextEncoder();
  const d = await crypto.subtle.digest("SHA-256", enc.encode(`${name}|${idn.toLowerCase()}`));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

/** 公开返回视图：脱敏 + 不带照片二进制；photoKeys 保留 URL 型外链引用 */
function publicView(rec) {
  return {
    name: rec.name, gender: rec.gender, ethnicity: rec.ethnicity,
    birthdate: rec.birthdate, idType: rec.idType,
    idNumber: maskIdNumber(rec.idNumber),
    studentNo: rec.studentNo, institution: rec.institution,
    level: rec.level, major: rec.major, duration: rec.duration,
    studyMode: rec.studyMode, eduCategory: rec.eduCategory,
    enrollDate: rec.enrollDate, gradDate: rec.gradDate,
    status: rec.status, type: rec.type || REC_TYPE.XUEJI,
    photoUrls: rec.photoKeys?.photo?.url ? { photo: rec.photoKeys.photo.url } : {},
    updatedAt: rec.updatedAt,
  };
}

async function safeJson(req) {
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return {};
  try { return await req.json(); } catch { return {}; }
}
