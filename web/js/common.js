export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

const NAME_KEY = 'q3.name';

export function getName() {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch { /* storage blocked */ }
  return `Player${Math.floor(100 + Math.random() * 900)}`;
}

export function setName(name) {
  const clean = cleanName(name);
  try { localStorage.setItem(NAME_KEY, clean); } catch { /* storage blocked */ }
  return clean;
}

// Quake 3 names: no quotes, backslashes or semicolons (they break the userinfo string).
export function cleanName(name) {
  return String(name ?? '').replace(/["\\;%]/g, '').trim().slice(0, 20) || getName();
}

// ?touch=1 forces the touch overlay (handy for testing on desktop).
export const isTouch = new URLSearchParams(location.search).has('touch')
  || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
