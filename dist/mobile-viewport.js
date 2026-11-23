const TEXT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);
const VARS = ['--vv-height', '--vv-top', '--vv-bottom-inset'];
const GAP_MIN = 120;
const SCALE_EPSILON = 0.025;
const WIDTH_TOLERANCE = 24;
const FOCUS_MARGIN = 12;

const positive = value => Number.isFinite(value) && value > 0;
const offset = value => Number.isFinite(value) ? Math.max(0, value) : 0;

export function isTextEditable(el) {
  if (!el || el.disabled || el.readOnly || el.getAttribute?.('inputmode') === 'none') return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input') return TEXT_TYPES.has(el.type || 'text');
  if (tag === 'textarea') return true;
  return el.isContentEditable === true;
}

/**
 * Coordinates are CSS pixels relative to the layout viewport. A pre-focus
 * baseline also detects keyboards that resize both layout and visual viewport.
 * The bottom inset is relative to the *current* layout viewport (not baseline).
 */
export function keyboardViewportGeometry({
  visualHeight, visualTop = 0, visualScale = 1, layoutHeight, baselineHeight = 0, focused = false,
} = {}) {
  if (!focused || !positive(visualHeight) || !positive(layoutHeight) ||
      !positive(visualScale) || Math.abs(1 - visualScale) > SCALE_EPSILON) return null;
  const height = Math.round(visualHeight);
  const fullHeight = Math.max(layoutHeight, positive(baselineHeight) ? baselineHeight : 0);
  if (fullHeight - visualHeight < Math.max(GAP_MIN, Math.round(fullHeight * 0.14))) return null;
  const top = Math.round(offset(visualTop));
  return {height, top, bottomInset: Math.max(0, Math.round(layoutHeight) - top - height)};
}

export function focusScrollDelta(rect, geometry, margin = FOCUS_MARGIN) {
  if (!geometry || !rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return 0;
  const top = geometry.top + margin;
  const bottom = geometry.top + geometry.height - margin;
  if (bottom <= top) return 0;
  const tall = rect.bottom - rect.top > bottom - top;
  // A tall editor need only overlap the visible area; avoid losing its caret.
  if (tall && rect.bottom >= top && rect.top <= bottom) return 0;
  if (tall) return rect.bottom < top ? Math.floor(rect.bottom - top) : Math.ceil(rect.top - bottom);
  if (rect.top < top) return Math.floor(rect.top - top);
  if (rect.bottom > bottom) return Math.ceil(rect.bottom - bottom);
  return 0;
}

export function focusOutsideViewport(rect, geometry, margin = FOCUS_MARGIN) {
  return focusScrollDelta(rect, geometry, margin) !== 0;
}

function scrollFocusedElement(el, delta, win, doc) {
  let rest = delta;
  for (let node = el.parentElement; node && node !== doc.documentElement && node !== doc.scrollingElement; node = node.parentElement) {
    const overflow = win.getComputedStyle?.(node)?.overflowY;
    if (!/^(auto|scroll|overlay)$/.test(overflow ?? '')) continue;
    const max = node.scrollHeight - node.clientHeight;
    const start = node.scrollTop;
    if (!positive(max) || !Number.isFinite(start)) continue;
    const end = Math.min(max, Math.max(0, start + rest));
    const movement = end - start;
    if (!movement) continue;
    if (typeof node.scrollBy === 'function') node.scrollBy({top: movement, behavior: 'instant'});
    else node.scrollTop = end;
    rest -= movement;
    if (Math.abs(rest) < 1) return;
  }
  if (typeof win.scrollBy === 'function') win.scrollBy({top: rest, behavior: 'instant'});
  else el.scrollIntoView?.({block: 'nearest', inline: 'nearest', behavior: 'instant'});
}

/**
 * Applies document-root variables only while an editable is focused and the
 * visual viewport indicates a keyboard. Does not intercept gestures.
 */
export function bootMobileViewport({
  win = globalThis.window,
  doc = globalThis.document,
  viewport = win?.visualViewport,
} = {}) {
  const root = doc?.documentElement;
  if (!viewport || !root || !win?.requestAnimationFrame) return () => {};

  let frame = null, baselineHeight = 0, baselineWidth = 0;
  let active = false, disposed = false, valueKey = '';
  let focusCheck = false, lastScrolled = null, lastScrollKey = '';
  const listeners = [];

  function clear() {
    if (!active) return;
    for (const key of VARS) root.style.removeProperty(key);
    root.removeAttribute('data-vv-keyboard');
    active = false;
    valueKey = '';
  }

  function read() {
    frame = null;
    if (disposed) return;
    const check = focusCheck;
    focusCheck = false;
    const el = doc.activeElement;
    const focused = isTextEditable(el);
    const layoutHeight = positive(root.clientHeight) ? root.clientHeight : win.innerHeight;
    const width = positive(root.clientWidth) ? root.clientWidth : win.innerWidth;
    const scale = viewport.scale ?? 1;
    if (!positive(scale) || Math.abs(scale - 1) > SCALE_EPSILON) {
      clear();
      lastScrolled = null;
      return;
    }
    if (positive(width) && (!baselineWidth || Math.abs(width - baselineWidth) > WIDTH_TOLERANCE)) {
      baselineWidth = width;
      baselineHeight = 0;
      lastScrolled = null;
    }
    if (!focused) {
      clear();
      lastScrolled = null;
      // During keyboard dismissal the blur can precede the expansion. Preserve
      // the unobscured baseline, then accept the larger size on the resize.
      if (positive(viewport.height)) baselineHeight = Math.max(baselineHeight, viewport.height);
      return;
    }
    const geometry = keyboardViewportGeometry({
      visualHeight: viewport.height, visualTop: viewport.offsetTop, visualScale: scale,
      layoutHeight, baselineHeight, focused,
    });
    if (!geometry) {
      clear();
      lastScrolled = null;
      return;
    }
    const {height, top, bottomInset} = geometry;
    const key = [height, top, bottomInset].join(':');
    if (key !== valueKey) {
      for (const [i, n] of [height, top, bottomInset].entries()) root.style.setProperty(VARS[i], n + 'px');
      valueKey = key;
    }
    if (!active) {
      root.setAttribute('data-vv-keyboard', '');
      active = true;
    }
    // Check only at focus or resize, not each viewport scroll; the reader may
    // intentionally pan or scroll while the keyboard is open.
    const scrollKey = [height, top].join(':');
    if (check && (el !== lastScrolled || scrollKey !== lastScrollKey)) {
      const delta = focusScrollDelta(el.getBoundingClientRect?.(), geometry);
      if (delta) {
        lastScrolled = el;
        lastScrollKey = scrollKey;
        scrollFocusedElement(el, delta, win, doc);
      }
    }
  }

  function schedule(check = false) {
    if (disposed) return;
    focusCheck ||= check;
    if (frame === null) frame = win.requestAnimationFrame(read);
  }

  function on(target, type, fn) {
    target?.addEventListener?.(type, fn, {passive: true});
    listeners.push(() => target?.removeEventListener?.(type, fn));
  }

  const changed = () => schedule(true);
  const focusChanged = () => { lastScrolled = null; schedule(true); };
  on(doc, 'focusin', focusChanged);
  on(doc, 'focusout', focusChanged);
  on(win, 'resize', changed);
  on(viewport, 'resize', changed);
  on(viewport, 'scroll', () => schedule());
  schedule(true);

  return () => {
    disposed = true;
    if (frame !== null) win.cancelAnimationFrame?.(frame);
    frame = null;
    for (const remove of listeners) remove();
    clear();
  };
}
