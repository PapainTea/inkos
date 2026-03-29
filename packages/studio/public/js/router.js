// InkOS Studio — Minimal Path-Based Router
// Exact-match path router for the SPA, no regex, no nested routes.

const routes = new Map();

/**
 * Register a route handler for an exact path.
 * @param {string} path  e.g. "/" or "/detection"
 * @param {() => void} handler
 */
export function onRoute(path, handler) {
  routes.set(path, handler);
}

/**
 * Resolve the current pathname against registered routes and invoke the
 * matching handler.  Falls back to "/" if no match is found.
 */
function resolve(path) {
  const handler = routes.get(path) || routes.get("/");
  if (handler) handler();
  document.dispatchEvent(
    new CustomEvent("inkos:routechange", { detail: { path } }),
  );
}

/**
 * Programmatic navigation — pushes state and triggers route matching.
 * @param {string} path
 */
export function navigate(path) {
  if (path !== location.pathname) {
    history.pushState(null, "", path);
  }
  resolve(path);
}

/**
 * Initialise the router: listen for popstate (back / forward) and match
 * the current URL on first load.
 */
export function initRouter() {
  window.addEventListener("popstate", () => {
    resolve(location.pathname);
  });
  resolve(location.pathname);
}
