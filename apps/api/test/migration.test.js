/** 迁移脚本单元测试（模拟 KV/R2） */
import { it, expect, vi } from "vitest";
import { runMigration } from "../src/migrations/kv-v1-to-v2.js";

function makeKV(data) {
  return {
    async get(key) { return data[key] ?? null; },
    async put(key, v) { data[key] = v; },
    async delete(key) { delete data[key]; },
    async list({ prefix, cursor }) {
      const keys = Object.keys(data).filter((k) => k.startsWith(prefix)).sort();
      const step = typeof cursor === "number" ? cursor : 0;
      const slice = keys.slice(step, step + 2); // 小分页模拟
      const next = step + 2 < keys.length ? step + 2 : undefined;
      return { keys: slice.map((name) => ({ name })), list_complete: step + 2 >= keys.length, cursor: next };
    },
  };
}

it("迁移：照片拆键 / 补 orgId/types / 已迁移跳过", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUg==";
  const data = {
    "user:old": JSON.stringify({ id: "a1", username: "old", salt: "s", passHash: "h", role: "user" }),
    "student:a1:s1": JSON.stringify({
      sid: "s1", ownerId: "a1", name: "张三", idNumber: "110101198801011234",
      status: "在读", published: true,
      photo: `data:image/png;base64,${png}`, photo2: "https://x.example/p.jpg",
    }),
    // 已迁移的（有 photoKeys）
    "student:a1:s2": JSON.stringify({ sid: "s2", ownerId: "a1", photoKeys: {}, name: "李四", idNumber: "1" }),
  };
  const r2objs = new Map();
  const env = {
    KV: makeKV(data),
    R2: {
      async put(k, v, opts) { r2objs.set(k, { v, opts }); },
    },
  };
  const stats = await runMigration(env, () => {});
  expect(stats.users).toBe(1);
  expect(stats.students).toBe(1);
  expect(stats.skipped).toBe(1);
  expect(stats.photos).toBe(1);
  // 记录回写 photoKeys，data URL 已移除
  const rec = JSON.parse(data["student:a1:s1"]);
  expect(rec.photo).toBeUndefined();
  expect(rec.photoKeys.photo.key).toBe("photos/s1/photo.bin");
  expect(rec.photoKeys.photo2.kind).toBe("url");
  expect(rec.type).toBe("xueji"); // 在读无学位
  // R2 收到了照片
  expect(r2objs.has("photos/s1/photo.bin")).toBe(true);
  // 已迁移记录未动
  const rec2 = JSON.parse(data["student:a1:s2"]);
  expect(rec2.photoKeys).toEqual({});
});
