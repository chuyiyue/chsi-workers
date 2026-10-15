/** 照片读取路由：GET /api/photos/:sid/:n —— key 形如 photos/<sid>/<n>.bin */
import { err, SECURITY_HEADERS } from "../core/http.js";
import { loadPhoto } from "../core/photoStore.js";
import { requireUser } from "../core/session.js";
import { R2 } from "@chsi/shared";

export function registerPhotoRoutes(router) {
  router.add("GET", "/api/photos/:sid/:n", async ({ req, env, params }) => {
    const r = await requireUser(env, req);
    if (r.err) return r.err;
    if (!/^[0-9a-f]{24}$/.test(params.sid) || !/^photo2?\.bin$/.test(params.n)) {
      return err(403, "E_FORBIDDEN", "非法照片路径");
    }
    const key = R2.photo(params.sid, params.n.replace(/\.bin$/, ""));
    const obj = await loadPhoto(env, key);
    if (!obj) return err(404, "E_NOT_FOUND", "照片不存在");
    // 权限：记录本人或管理员；url 型照片不进该路由
    const ownerAllowed = await isOwnerOrAdmin(env, r.user, params.sid);
    if (!ownerAllowed) return err(403, "E_FORBIDDEN", "无权查看该照片");
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.mime,
        "Cache-Control": "private, max-age=3600",
        ...SECURITY_HEADERS,
      },
    });
  });
}

async function isOwnerOrAdmin(env, user, sid) {
  if (user.role === "admin") return true;
  // 用户的记录 student:<uid>:<sid>
  const rec = await env.KV.get(`student:${user.uid}:${sid}`);
  return !!rec;
}
