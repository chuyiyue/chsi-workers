import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    // wrangler.test.jsonc：不带 r2_buckets —— vitest-pool-workers 的 R2
    // isolated storage 有缺陷（AssertionError: Expected .sqlite, got ...sqlite-shm）。
    // 照片用例走 KV 降级路径同样覆盖拆键逻辑。
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          url: "http://example.com",
          bindings: { ADMIN_PASSWORD: "test-admin-pw" },
          kvNamespaces: ["KV"],
        },
      },
    },
  },
});
