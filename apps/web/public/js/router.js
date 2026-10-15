/* hash 路由：#login #register #query #help #me */
const routes = new Map();
let fallback = "#query";

export function route(path, view) {
  routes.set(path, view);
}

export function setFallback(path) {
  fallback = path;
}

export function navigate(path) {
  location.hash = path;
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  if (!location.hash) location.replace("#" + fallback.replace(/^#/, ""));
  render();
}

async function render() {
  const raw = location.hash || fallback;
  const [path, ...rest] = raw.replace(/^#/, "").split("/");
  const view = routes.get("#" + path) || routes.get(fallback);
  const container = document.getElementById("view");
  if (!view || !container) return;
  container.innerHTML = "";
  try {
    await view(container, rest.join("/"));
  } catch (e) {
    console.error(e);
    container.innerHTML = `<p class="error-box">页面加载出错：${e.message}</p>`;
  }
}
