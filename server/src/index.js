// Lobby API + room manager + WebSocket gateway, in one process.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { config } from './config.js';
import { attachGateway } from './gateway.js';
import { RoomManager, publicRoom, httpError } from './rooms.js';

const manifest = JSON.parse(fs.readFileSync(path.join(config.contentDir, 'manifest.json'), 'utf8'));
const maps = manifest.maps;
const rooms = new RoomManager(maps);

const clientIp = req => {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '';
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));

const asyncRoute = fn => (req, res, next) => fn(req, res).catch(next);

app.get('/api/health', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

app.get('/api/maps', (req, res) => {
  res.json(Object.entries(maps).map(([name, m]) => ({
    name, title: m.title, note: m.note, players: m.players, size: m.size,
    levelshot: m.levelshot ? `/content/${m.levelshot}` : null,
  })));
});

app.get('/api/manifest', (req, res) => res.json(manifest));

app.get('/api/rooms', (req, res) => {
  res.json([...rooms.rooms.values()].filter(r => r.ready).map(r => publicRoom(r, maps)));
});

app.get('/api/rooms/:id', (req, res) => {
  const r = rooms.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'room not found' });
  res.json(publicRoom(r, maps));
});

app.post('/api/rooms', asyncRoute(async (req, res) => {
  const { map, maxPlayers, bots, skill } = req.body ?? {};
  const r = await rooms.create({ map, maxPlayers, bots: bots !== false, skill, ip: clientIp(req) });
  res.status(201).json({ ...publicRoom(r, maps), link: `/r/${r.id}` });
}));

// Join the busiest room with space, or start a bot room on a random map.
app.post('/api/quickplay', asyncRoute(async (req, res) => {
  let r = rooms.pickQuickPlay();
  if (!r) {
    const names = Object.keys(maps);
    const map = names[Math.floor(Math.random() * names.length)];
    r = await rooms.create({ map, maxPlayers: 8, bots: true, skill: 2, ip: clientIp(req) });
  }
  res.json({ ...publicRoom(r, maps), link: `/r/${r.id}` });
}));

app.post('/api/rooms/:id/voice-token', asyncRoute(async (req, res) => {
  const { apiKey, apiSecret, publicUrl } = config.livekit;
  if (!apiKey || !publicUrl) throw httpError(501, 'voice chat is not configured');
  if (!rooms.get(req.params.id)) throw httpError(404, 'room not found');
  const name = String(req.body?.name ?? 'player').replace(/[^\w .-]/g, '').slice(0, 24) || 'player';
  const at = new AccessToken(apiKey, apiSecret, {
    identity: `${name}#${Math.random().toString(36).slice(2, 6)}`,
    name,
    ttl: '2h',
  });
  at.addGrant({ roomJoin: true, room: `q3-${req.params.id}`, canPublish: true, canSubscribe: true, canPublishData: false });
  res.json({ url: publicUrl, token: await at.toJwt() });
}));

// Content: manifest-listed pk3s are immutable per hash, so cache hard.
app.use('/content', express.static(config.contentDir, { immutable: true, maxAge: '30d', fallthrough: false }));

if (config.webDir) {
  app.use(express.static(config.webDir, { extensions: ['html'] }));
  app.get('/r/:id', (req, res) => res.sendFile(path.join(config.webDir, 'play.html')));
}

app.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status >= 500 && status !== 501) console.error(err);
  res.status(status).json({ error: err.message });
});

const server = http.createServer(app);
attachGateway(server, rooms, clientIp);
server.listen(config.port, () => console.log(`lobby listening on :${config.port}, ${Object.keys(maps).length} maps`));

const stop = () => {
  rooms.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
