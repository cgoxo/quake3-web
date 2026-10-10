// Downloads pk3s with progress and keeps them in the Cache API, keyed by content hash,
// so a second visit starts instantly.
const CACHE = 'q3-content-v1';

async function openCache() {
  try {
    return await caches.open(CACHE);
  } catch {
    return null; // private mode or caches unavailable
  }
}

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${url} (${res.status})`);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// files: [{file, size, hash}] relative to /content/. Returns [{file, data}].
export async function loadAssets(files, onProgress) {
  const cache = await openCache();
  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  const tick = n => {
    done += n;
    onProgress(done, total);
  };

  // Drop stale versions of these files from the cache.
  if (cache) {
    const want = new Set(files.map(f => `/content/${f.file}?h=${f.hash}`));
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      if (files.some(f => u.pathname === `/content/${f.file}`) && !want.has(u.pathname + u.search)) cache.delete(req);
    }
  }

  return Promise.all(files.map(async f => {
    const url = `/content/${f.file}?h=${f.hash}`;
    const hit = cache && await cache.match(url);
    if (hit) {
      const data = new Uint8Array(await hit.arrayBuffer());
      tick(f.size);
      return { file: f.file, data };
    }
    const data = await fetchWithProgress(url, tick);
    if (cache) cache.put(url, new Response(data, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
    return { file: f.file, data };
  }));
}
