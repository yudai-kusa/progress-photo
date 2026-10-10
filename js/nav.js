// ハッシュ + history.state.depth で「アプリ内で何画面進んだか」を管理し、
// 戻るボタンで履歴を正しく遡れるようにする
let router = () => {};

export function setRouter(fn) {
  router = fn;
}

function depth() {
  return history.state?.depth ?? 0;
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState({ depth: depth() }, '', hash);
  else history.pushState({ depth: depth() + 1 }, '', hash);
  router();
}

export function back(fallback = '#/') {
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function home() {
  const d = depth();
  if (d > 0) history.go(-d);
  else navigate('#/', { replace: true });
}
