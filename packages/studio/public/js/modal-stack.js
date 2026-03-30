// InkOS Studio — Unified Modal Stack
// ESC always closes the topmost closable layer.

const stack = [];

export function pushModal(id, closeFn) {
  // Remove if already in stack (re-push to top)
  const idx = stack.findIndex(m => m.id === id);
  if (idx >= 0) stack.splice(idx, 1);
  stack.push({ id, closeFn });
}

export function popModal(id) {
  const idx = stack.findIndex(m => m.id === id);
  if (idx >= 0) stack.splice(idx, 1);
}

export function closeTopModal() {
  if (stack.length === 0) return false;
  const top = stack[stack.length - 1];
  top.closeFn();
  // closeFn should call popModal internally, but ensure cleanup
  const idx = stack.findIndex(m => m.id === top.id);
  if (idx >= 0) stack.splice(idx, 1);
  return true;
}

export function initModalStack() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (closeTopModal()) {
        e.stopPropagation();
        e.preventDefault();
      }
    }
  });
}
