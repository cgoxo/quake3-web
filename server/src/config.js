// All settings come from the environment so the same image runs locally and on the VM.
const env = process.env;

const int = (name, fallback) => {
  const v = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
};

export const config = {
  port: int('PORT', 3000),
  // Behind Caddy we trust X-Forwarded-For for the real client IP.
  trustProxy: env.TRUST_PROXY === '1',
  // Comma-separated list of origins allowed to open game WebSockets. Empty = any.
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),

  ioq3ded: env.IOQ3DED ?? 'ioq3ded',
  // Directory that contains baseoa/ with the stock OpenArena pk3s (server side).
  dataDir: env.DATA_DIR ?? '/data',
  // Trimmed browser content (manifest.json + baseoa/*.pk3) and the static site.
  contentDir: env.CONTENT_DIR ?? '/content',
  webDir: env.WEB_DIR ?? '',
  homeDir: env.ROOM_HOME ?? '/tmp/q3rooms',

  portMin: int('ROOM_PORT_MIN', 27960),
  portMax: int('ROOM_PORT_MAX', 27999),
  maxRooms: int('MAX_ROOMS', 4),
  roomsPerIpPer10Min: int('ROOMS_PER_IP', 3),
  maxWsPerIp: int('MAX_WS_PER_IP', 6),

  // A room with no humans is stopped after this long. New rooms get extra time
  // for the creator to download the map.
  idleMs: int('ROOM_IDLE_SECONDS', 120) * 1000,
  startGraceMs: int('ROOM_START_GRACE_SECONDS', 300) * 1000,
  statusIntervalMs: int('STATUS_INTERVAL_SECONDS', 10) * 1000,

  livekit: {
    apiKey: env.LK_API_KEY ?? '',
    apiSecret: env.LK_API_SECRET ?? '',
    // URL the browser uses to reach LiveKit, e.g. wss://voice.example.com
    publicUrl: env.LK_PUBLIC_URL ?? '',
  },
};
