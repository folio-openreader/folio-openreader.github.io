// Foreground wall time, not a guess based on pages, taps, or time since last visit.
// The caller owns visibility/route/focus eligibility and supplies a regular heartbeat.
export const READING_TIME_KEY = 'folio-reading-time-v1';
export const READING_GOAL_KEY = 'folio-reading-goal-v1';
const KEEP_DAYS = 56, MAX_RANGES = 64, MAX_STORED = 160000;
const empty = () => ({before: 0, total: 0, ranges: []});
const stamp = n => Number.isSafeInteger(n) && n >= 0 && n < 8.64e15;
const validGoal = n => Number.isInteger(n) && n >= 1 && n <= 240;
const elapsed = v => v ? v.ranges.reduce((sum,[a,b]) => sum+b-a,v.total) : 0;
function dayOf(ms) {
  const d = new Date(ms), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nextMidnight(ms) { const d = new Date(ms); d.setHours(24, 0, 0, 0); return +d; }
function normalize(before, total, ranges) {
  const merged = [];
  for (const [a,b] of ranges.sort((x,y) => x[0]-y[0])) {
    const start = Math.max(a, before);
    if (b <= start) continue;
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([start,b]);
  }
  // Fold old sessions into an exact subtotal; keep a tail to deduplicate other tabs.
  for (const [a,b] of merged.splice(0, Math.max(0, merged.length-MAX_RANGES))) {
    total += b-a; before = b;
  }
  return {before, total, ranges: merged};
}
function join(x,y) {
  if (!x) return y;
  const newest = x.before === y.before ? (x.total >= y.total ? x : y) : (x.before > y.before ? x : y);
  return normalize(newest.before, newest.total, [...x.ranges, ...y.ranges]);
}
function decode(raw) {
  const out = new Map();
  if (!raw || raw.length > MAX_STORED) return out;
  try {
    const data = JSON.parse(raw);
    for (const key of Object.keys(data || {}).filter(s => /^\d{4}-\d\d-\d\d$/.test(s)).sort().slice(-KEEP_DAYS)) {
      const v = data[key];
      if (!v || !stamp(v.before) || !Number.isInteger(v.total) || v.total < 0 || v.total > 26*3600000 || !Array.isArray(v.ranges)) continue;
      const ranges = v.ranges.slice(0, MAX_RANGES).filter(p => Array.isArray(p) && p.length === 2 && p.every(stamp) && p[1] > p[0] && p[1]-p[0] <= 26*3600000);
      out.set(key, normalize(v.before, v.total, ranges));
    }
  } catch { /* A bad/old local record must not break the reader. */ }
  return out;
}
function defaultStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
export function createReadingTime({storage = defaultStorage(), now = Date.now, maxGapMs = 20000} = {}) {
  let active = false, previous = null, goal = 5, pendingGoal = false;
  let days = new Map(), cachedRaw, pendingTime = false;
  const read = key => { try { return storage?.getItem(key); } catch { return undefined; } };
  function write(key,value) { try { if (!storage) return false; storage.setItem(key,value); return true; } catch { return false; } }
  function sync() {
    const raw = read(READING_TIME_KEY);
    if (raw !== cachedRaw) {
      for (const [day,v] of decode(raw)) days.set(day, join(days.get(day),v));
      prune(days); cachedRaw = raw;
    }
    if (!pendingGoal) { const value = Number(read(READING_GOAL_KEY)); if (validGoal(value)) goal = value; }
  }
  function prune(map) {
    if (map.size > KEEP_DAYS) for (const k of [...map.keys()].sort().slice(0,-KEEP_DAYS)) map.delete(k);
  }
  function add(map,start,end) {
    while (start < end) {
      const key = dayOf(start), stop = Math.min(end,nextMidnight(start));
      const v = map.get(key) || empty();
      map.set(key, normalize(v.before, v.total, [...v.ranges, [start,stop]]));
      start = stop;
    }
    prune(map);
  }
  function sample(commit, history = false) {
    const t = Number(now());
    sync();
    let view = days;
    if (active && previous !== null && stamp(previous) && stamp(t) && t > previous && t-previous <= maxGapMs) {
      if (!commit) view = new Map(days);
      add(view,previous,t);
      if (commit) pendingTime = true;
    }
    if (commit) {
      if (pendingTime) {
        const raw = JSON.stringify(Object.fromEntries(days));
        if (raw === cachedRaw || write(READING_TIME_KEY,raw)) { cachedRaw = raw; pendingTime = false; }
      }
      previous = active && stamp(t) ? t : null;
      if (pendingGoal && write(READING_GOAL_KEY,String(goal))) pendingGoal = false;
    }
    const day = dayOf(t);
    if (history) return {day, entries: [...view].map(([day,v]) => ({day,elapsedMs:elapsed(v)})).filter(entry=>entry.elapsedMs>0).sort((a,b)=>a.day.localeCompare(b.day))};
    return {day, elapsedMs: elapsed(view.get(day)), goalMinutes: goal};
  }
  return {
    setActive(value) {
      // Start establishes a baseline; stop checkpoints the final partial heartbeat.
      if (!!value === active) return sample(false);
      if (value) { active = true; return sample(true); }
      const result = sample(true); active = false; previous = null; return result;
    },
    tick: () => sample(true), flush: () => sample(true), getToday: () => sample(false),
    getHistory: () => sample(false,true),
    get goalStored() { return !pendingGoal; },
    setGoal(value) {
      const n = typeof value === 'string' && value.trim() ? Number(value) : value;
      if (validGoal(n)) { goal = n; pendingGoal = !write(READING_GOAL_KEY,String(n)); }
      return sample(false);
    }
  };
}
