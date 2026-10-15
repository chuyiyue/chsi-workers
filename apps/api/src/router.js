/** 极简路由：仅支持 method + 路径参数 (:name)，零依赖 */

export function createRouter() {
  const routes = [];
  return {
    /** add("GET", "/api/students/:sid", handler) */
    add(method, pattern, handler) {
      const names = [];
      const regex = new RegExp(
        "^" + pattern.replace(/\/:([A-Za-z]+)/g, (_, n) => { names.push(n); return "/([^/]+)"; }) + "$"
      );
      routes.push({ method, regex, names, handler });
    },
    async dispatch(req, env, ctx) {
      const url = new URL(req.url);
      const path = url.pathname;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = path.match(r.regex);
        if (!m) continue;
        const params = {};
        r.names.forEach((n, i) => { params[n] = m[i + 1]; });
        return r.handler({ req, env, ctx, params, url });
      }
      return null; // 未命中
    },
  };
}
