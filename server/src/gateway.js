// WebSocket <-> UDP gateway. Each binary WebSocket message is one Quake 3 datagram.
//
// The browser client uses Emscripten's socket emulation, which carries UDP
// over a WebSocket. When a bound UDP socket opens a connection it first sends
// a 10-byte "port header" (\xff\xff\xff\xff "port" + 2 bytes) so the peer can
// learn its port; we drop that, since every player gets its own UDP socket here.
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { config } from './config.js';

const PORT_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x70, 0x6f, 0x72, 0x74]); // ....port
const MAX_PACKET = 16 * 1024;
const MAX_PACKETS_PER_SEC = 250; // client sends ~60-125/s; leave headroom

export function attachGateway(server, rooms, clientIp) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PACKET,
    // Emscripten requests the "binary" subprotocol; echo it back or the browser aborts.
    handleProtocols: protocols => (protocols.has('binary') ? 'binary' : false),
  });
  const perIp = new Map();

  server.on('upgrade', (req, socket, head) => {
    const m = req.url?.match(/^\/ws\/([a-z0-9]{4,8})(?:[/?].*)?$/);
    const room = m && rooms.get(m[1]);
    const ip = clientIp(req);
    const origin = req.headers.origin ?? '';

    let reject = null;
    if (!room) reject = '404 Not Found';
    else if (config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) reject = '403 Forbidden';
    else if ((perIp.get(ip) ?? 0) >= config.maxWsPerIp) reject = '429 Too Many Requests';
    if (reject) {
      socket.end(`HTTP/1.1 ${reject}\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => bridge(ws, room, ip));
  });

  function bridge(ws, room, ip) {
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    room.connections++;
    const udp = dgram.createSocket('udp4');
    let budget = MAX_PACKETS_PER_SEC;
    const refill = setInterval(() => { budget = MAX_PACKETS_PER_SEC; }, 1000);
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(refill);
      room.proc.off('exit', cleanup);
      room.connections--;
      const n = (perIp.get(ip) ?? 1) - 1;
      n > 0 ? perIp.set(ip, n) : perIp.delete(ip);
      try { udp.close(); } catch { /* already closed */ }
      if (ws.readyState === ws.OPEN) ws.close();
    };

    udp.on('message', (msg, rinfo) => {
      // Only accept datagrams from this room's server.
      if (rinfo.port !== room.port || ws.readyState !== ws.OPEN) return;
      ws.send(msg, { binary: true });
    });
    udp.on('error', cleanup);

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data);
      if (buf.length === 10 && buf.subarray(0, 8).equals(PORT_HEADER)) return;
      if (--budget < 0) return;
      udp.send(buf, room.port, '127.0.0.1');
    });
    ws.on('close', cleanup);
    ws.on('error', cleanup);
    // If the room's process goes away, drop its players.
    room.proc.once('exit', cleanup);
  }

  return wss;
}
