/**
 * 迁移：v1/v2 旧 KV → v3 自助端模型
 *
 * 变更点：
 *   1. student:* 去掉 published（公开查询已下线），type 按状态/学位重算
 *   2. 照片仍走 photoKeys（R2 优先、KV 降级）；未拆离的 data URL 拆离
 *   3. user:* 补 orgId / tokenVersion；缺 salt 的记录报错不静默
 *   4. 旧的公开查询索引 idx:* 清掉
 *   5. 会话 session:* / sidx:* 不动（TTL 自然过期，重新登录即可）
 *
 * 用法（在能访问线上 KV 的环境执行）：
 *   npx wrangler kv key list --binding KV ...  或
 *   在 Worker 内 import 本模块调用 runMigration(env, log, { dryRun: true }) 先看统计
 */
import { R2, REC_TYPE, STATUS } from "@chsi/shared";

export async function runMigration(env, log = console.log, opts = {}) {
  const dryRun = opts.dryRun === true;
  const stats = { users: 0, students: 0, photos: 0, idxDeleted: 0, skipped: 0, errors: 0 };

  // ---- users：补 orgId / tokenVersion ----
  let cursor;
  for (;;) {
    const page = await env.KV.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      try {
        const raw = await env.KV.get(k.name);
        const uu = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!uu || typeof uu !== "object") { stats.skipped++; continue; }
        if (!uu.salt) { stats.errors++; log(`!!! user 无 salt（需人工处理）：${k.name}`); continue; }
        let changed = false;
        if (uu.orgId !== "demo") { uu.orgId = "demo"; changed = true; }
        if (uu.tokenVersion == null) { uu.tokenVersion = 0; changed = true; }
        if (changed) {
          if (!dryRun) await env.KV.put(k.name, JSON.stringify(uu));
          stats.users++;
        } else stats.skipped++;
      } catch (e) { stats.errors++; log(`!!! ${k.name}: ${e.message}`); }
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  // ---- students：去 published / 补字段 / 拆照片 ----
  cursor = undefined;
  for (;;) {
    const page = await env.KV.list({ prefix: "student:", cursor });
    for (const k of page.keys) {
      try {
        const raw = await env.KV.get(k.name);
        const rec = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!rec || typeof rec !== "object") { stats.skipped++; continue; }
        let changed = false;
        if ("published" in rec) { delete rec.published; changed = true; }
        if (rec.orgId !== "demo") { rec.orgId = "demo"; changed = true; }
        const wantType = rec.degreeName ? REC_TYPE.DEGREE
          : rec.status === STATUS.GRADUATED ? REC_TYPE.XUELI : REC_TYPE.XUEJI;
        if (rec.type !== wantType) { rec.type = wantType; changed = true; }

        if (!rec.photoKeys) {
          const photoKeys = {};
          for (const n of ["photo", "photo2"]) {
            const v = rec[n];
            if (v == null || v === "") continue;
            if (/^https?:\/\//i.test(v)) {
              photoKeys[n] = { kind: "url", url: String(v).slice(0, 2000) };
            } else {
              const m = String(v).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
              if (!m) continue;
              const bytes = base64ToBytes(m[2]);
              const key = R2.photo(rec.sid, n);
              if (!dryRun) {
                if (env.R2) await env.R2.put(key, bytes, { httpMetadata: { contentType: m[1] } });
                else await env.KV.put(`photo:${key}`, bytesToBase64(bytes), { httpMetadata: { contentType: m[1] } });
              }
              photoKeys[n] = { kind: "stored", key };
              stats.photos++;
            }
            delete rec[n];
            changed = true;
          }
          rec.photoKeys = photoKeys; // 即使没照片也写标记，表示已迁
          changed = true;
        }
        if (changed) {
          if (!dryRun) await env.KV.put(k.name, JSON.stringify(rec));
          stats.students++;
        } else stats.skipped++;
      } catch (e) { stats.errors++; log(`!!! ${k.name}: ${e.message}`); }
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  // ---- idx:*：公开查询索引已作废 ----
  cursor = undefined;
  for (;;) {
    const page = await env.KV.list({ prefix: "idx:", cursor });
    for (const k of page.keys) {
      if (!dryRun) await env.KV.delete(k.name);
      stats.idxDeleted++;
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  log(`迁移${dryRun ? "（dry-run）" : ""}完成: ${JSON.stringify(stats)}`);
  return stats;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(u8) {
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin);
}
