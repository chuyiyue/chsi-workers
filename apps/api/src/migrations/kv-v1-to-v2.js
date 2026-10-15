/**
 * 一次性迁移：v1（旧 KV 结构）→ v2（新模型）
 *
 * 迁移内容：
 *   user:<username>          → 保留（补 orgId / tokenVersion / salt 格式不变）
 *   student:<ownerId>:<sid>  → 照片 data URL 拆出到 photo 键或 R2；记录回写 photoKeys
 *   site:settings            → 保留
 *   会话 / 验证码           → 不迁（TTL 自然过期，用户重新登录）
 *
 * 用法（在能访问旧 KV 的环境执行，例如 wrangler dev 或 R-console）：
 *   npx wrangler kv key list --binding KV ...  或直接在 Worker 内导入本模块调用 runMigration(env, log)
 */
import { R2 } from "@chsi/shared";

export async function runMigration(env, log = console.log) {
  const stats = { users: 0, students: 0, photos: 0, skipped: 0, errors: 0 };
  // ---- users：补 orgId / tokenVersion ----
  let cursor = undefined;
  for (;;) {
    const page = await env.KV.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const u = await env.KV.get(k.name, "json").then?.((x) => x) ?? null;
      const uu = typeof u === "string" ? JSON.parse(u) : u;
      if (!uu) continue;
      let changed = false;
      if (uu.orgId !== "demo") { uu.orgId = "demo"; changed = true; }
      if (uu.tokenVersion == null) { uu.tokenVersion = 0; changed = true; }
      // 旧结构缺失 salt 的（早期 bug）跳过并提示手动处理
      if (!uu.salt) { stats.errors++; log(`!!! user 无 salt：${k.name}`); continue; }
      if (changed) { await env.KV.put(k.name, JSON.stringify(uu)); stats.users++; }
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  // ---- students：照片拆离 ----
  cursor = undefined;
  for (;;) {
    const page = await env.KV.list({ prefix: "student:", cursor });
    for (const k of page.keys) {
      try {
        const raw = await env.KV.get(k.name);
        const rec = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!rec || typeof rec !== "object") continue;
        if (rec.photoKeys) { stats.skipped++; continue; } // 已是新格式
        const photoKeys = {};
        for (const n of ["photo", "photo2"]) {
          const v = rec[n];
          if (v == null || v === "") continue;
          if (/^https?:\/\//i.test(v)) {
            photoKeys[n] = { kind: "url", url: String(v).slice(0, 2000) };
          } else if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(v)) {
            const [, mime, b64] = v.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i) || [];
            if (!b64) continue;
            const bytes = base64ToBytes(b64);
            const key = R2.photo(rec.sid, n);
            if (env.R2) {
              await env.R2.put(key, bytes, { httpMetadata: { contentType: mime } });
              photoKeys[n] = { kind: "stored", key };
            } else {
              await env.KV.put(`photo:${key}`, bytesToBase64(bytes), { httpMetadata: { contentType: mime } });
              photoKeys[n] = { kind: "stored", key };
            }
            stats.photos++;
          } else {
            continue; // 未知格式丢弃
          }
          delete rec[n];
        }
        rec.photoKeys = photoKeys; // 字段已删，即使没有照片也要写入标记表示已迁移
        rec.orgId = rec.orgId || "demo";
        rec.type = rec.type || (rec.degreeName ? "degree" : rec.status === "已结业" ? "xueli" : "xueji");
        await env.KV.put(k.name, JSON.stringify(rec));
        stats.students++;
      } catch (e) {
        stats.errors++;
        log(`!!! ${k.name}: ${e.message}`);
      }
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  log(`迁移完成: ${JSON.stringify(stats)}`);
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
