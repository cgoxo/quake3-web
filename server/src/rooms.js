// Room manager: one ioq3ded child process per room, bound to localhost.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { queryStatus } from './status.js';

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function newId() {
  const bytes = crypto.randomBytes(4);
  return Array.from(bytes, b => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

// Server config for a deathmatch room. Written to the room's homepath and exec'd.
function roomCfg({ map, maxPlayers, bots, skill, name, rcon }) {
  return [
    `set sv_hostname "${name}"`,
    `set sv_maxclients ${maxPlayers}`,
    'set g_gametype 0',             // free for all deathmatch only
    'set fraglimit 30',
    'set timelimit 15',
    'set sv_pure 0',                // browser ships trimmed pk3s
    'set sv_allowDownload 0',
    'set g_inactivity 0',
    'set g_doWarmup 0',
    `set bot_minplayers ${bots ? Math.min(4, maxPlayers) : 0}`,
    'set bot_nochat 1',
    `set g_spSkill ${skill}`,
    `set rconpassword "${rcon}"`,
    // Restart the same map when the match ends; there is no rotation.
    'set nextmap "map_restart 0"',
    `map ${map}`,
  ].join('\n') + '\n';
}

export class RoomManager {
  constructor(maps) {
    this.maps = maps;          // { name: meta } from the content manifest
    this.rooms = new Map();    // id -> room
    this.createdByIp = new Map();
    this.timer = setInterval(() => this.poll(), config.statusIntervalMs);
    this.timer.unref();
  }

  freePort() {
    const used = new Set([...this.rooms.values()].map(r => r.port));
    for (let p = config.portMin; p <= config.portMax; p++) if (!used.has(p)) return p;
    return null;
  }

  canCreate(ip) {
    const now = Date.now();
    const recent = (this.createdByIp.get(ip) ?? []).filter(t => now - t < 10 * 60_000);
    this.createdByIp.set(ip, recent);
    return recent.length < config.roomsPerIpPer10Min;
  }

  async create({ map, maxPlayers = 8, bots = true, skill = 2, ip = '' }) {
    if (!this.maps[map]) throw httpError(400, 'unknown map');
    if (this.rooms.size >= config.maxRooms) throw httpError(503, 'server is full, try again in a few minutes');
    if (!this.canCreate(ip)) throw httpError(429, 'too many rooms created, slow down');
    const port = this.freePort();
    if (port === null) throw httpError(503, 'no free ports');

    maxPlayers = clamp(Number(maxPlayers) || 8, 2, 12);
    skill = clamp(Number(skill) || 2, 1, 5);

    let id;
    do id = newId(); while (this.rooms.has(id));

    const home = path.join(config.homeDir, id);
    fs.mkdirSync(path.join(home, 'baseoa'), { recursive: true });
    const rcon = crypto.randomBytes(12).toString('hex');
    const title = this.maps[map].title ?? map;
    fs.writeFileSync(path.join(home, 'baseoa', 'room.cfg'),
      roomCfg({ map, maxPlayers, bots: !!bots, skill, name: `${title} [${id}]`, rcon }));

    const proc = spawn(config.ioq3ded, [
      '+set', 'dedicated', '1',
      '+set', 'net_enabled', '1',      // IPv4 only
      '+set', 'net_ip', '127.0.0.1',   // only the gateway can reach it
      '+set', 'net_port', String(port),
      '+set', 'com_basegame', 'baseoa',
      '+set', 'fs_basepath', config.dataDir,
      '+set', 'fs_homepath', home,
      '+set', 'com_hunkmegs', '64',
      '+exec', 'room.cfg',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const room = {
      id, port, map, maxPlayers, bots: !!bots, skill, proc, home,
      createdAt: Date.now(), lastHumanAt: Date.now(),
      status: { humans: 0, bots: 0, players: [] }, ready: false, connections: 0,
    };
    this.rooms.set(id, room);
    this.createdByIp.get(ip).push(Date.now());

    const log = chunk => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) console.log(`[room ${id}] ${line}`);
    };
    proc.stdout.on('data', log);
    proc.stderr.on('data', log);
    proc.on('exit', code => {
      console.log(`[room ${id}] exited with code ${code}`);
      this.remove(id, false);
    });

    // Wait until the server answers status queries so clients can connect at once.
    for (let i = 0; i < 40 && this.rooms.has(id); i++) {
      const st = await queryStatus(port, '127.0.0.1', 250);
      if (st) {
        room.ready = true;
        room.status = st;
        break;
      }
    }
    if (!room.ready) {
      this.remove(id);
      throw httpError(500, 'game server failed to start');
    }
    console.log(`[room ${id}] ready on 127.0.0.1:${port} map=${map}`);
    return room;
  }

  get(id) {
    return this.rooms.get(id);
  }

  remove(id, kill = true) {
    const room = this.rooms.get(id);
    if (!room) return;
    this.rooms.delete(id);
    if (kill && room.proc.exitCode === null) room.proc.kill('SIGTERM');
    fs.rm(room.home, { recursive: true, force: true }, () => {});
  }

  async poll() {
    const now = Date.now();
    await Promise.all([...this.rooms.values()].map(async room => {
      const st = await queryStatus(room.port);
      if (!st) {
        room.misses = (room.misses ?? 0) + 1;
        if (room.misses >= 3) {
          console.log(`[room ${room.id}] not answering, stopping`);
          this.remove(room.id);
        }
        return;
      }
      room.misses = 0;
      room.status = st;
      // Open gateway connections count as humans too (players still loading).
      if (st.humans > 0 || room.connections > 0) room.lastHumanAt = now;
      const deadline = Math.max(room.lastHumanAt + config.idleMs, room.createdAt + config.startGraceMs);
      if (now > deadline) {
        console.log(`[room ${room.id}] idle, stopping`);
        this.remove(room.id);
      }
    }));
  }

  // Busiest room that still has a free human slot.
  pickQuickPlay() {
    let best = null;
    for (const r of this.rooms.values()) {
      if (r.status.humans >= r.maxPlayers) continue;
      if (!best || r.status.humans > best.status.humans) best = r;
    }
    return best;
  }

  shutdown() {
    clearInterval(this.timer);
    for (const id of [...this.rooms.keys()]) this.remove(id);
  }
}

export function publicRoom(r, maps) {
  return {
    id: r.id,
    map: r.map,
    mapTitle: maps[r.map]?.title ?? r.map,
    maxPlayers: r.maxPlayers,
    humans: r.status.humans,
    bots: r.status.bots,
    botsEnabled: r.bots,
    skill: r.skill,
    players: r.status.players.map(p => ({ name: p.name, score: p.score, bot: p.ping === 0 })),
    createdAt: r.createdAt,
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
