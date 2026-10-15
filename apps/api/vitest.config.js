import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // 测试态：不绑 ASSETS；SELF.fetch 需要完整 URL 基址
          url: "http://example.com",
          // 存储放稳定目录（TMPDIR 会被会话间清理，isolated storage 断言会误报）
          storagePath: "../../.wrangler/test-state",
          bindings: {
            ADMIN_PASSWORD: "test-admin-pw",
          },
          kvNamespaces: ["KV"],
        },
      },
    },
  },
});
