// One place that maps the phone/browser Back button to "close the top thing"
// (full player, artist page, playlist page...). Each pushEntry adds a history entry.
const entries = [];
let bound = false;

function bind() {
  if (bound) return;
  bound = true;
  window.addEventListener("popstate", () => {
    const fn = entries.pop();
    if (fn) fn();
  });
}

export function pushEntry(onPop) {
  bind();
  entries.push(onPop);
  history.pushState({ hm: entries.length }, "");
}

export function goBack() {
  if (entries.length) history.back();
}

// close everything at once (e.g. when a bottom-nav tab is tapped)
export function popAll() {
  const n = entries.length;
  if (!n) return;
  const fns = entries.splice(0, n).reverse();
  history.go(-n);
  fns.forEach((f) => f());
}
