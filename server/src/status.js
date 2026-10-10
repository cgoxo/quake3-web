// Quake 3 connectionless "getstatus" query, used to count humans vs bots.
import dgram from 'node:dgram';

const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);

export function parseStatus(buf) {
  if (!buf.subarray(0, 4).equals(OOB)) return null;
  const lines = buf.subarray(4).toString('latin1').split('\n');
  if (lines[0] !== 'statusResponse') return null;

  const info = {};
  const kv = (lines[1] ?? '').split('\\').slice(1);
  for (let i = 0; i + 1 < kv.length; i += 2) info[kv[i]] = kv[i + 1];

  const players = [];
  for (const line of lines.slice(2)) {
    const m = line.match(/^(-?\d+) (\d+) "(.*)"$/);
    if (m) players.push({ score: Number(m[1]), ping: Number(m[2]), name: m[3].replace(/\^./g, '') });
  }
  // Bots always report ping 0; humans report their real ping (999 while connecting).
  const humans = players.filter(p => p.ping > 0);
  return { info, players, humans: humans.length, bots: players.length - humans.length };
}

export function queryStatus(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const done = result => {
      clearTimeout(timer);
      sock.close();
      resolve(result);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.on('message', msg => done(parseStatus(msg)));
    sock.on('error', () => done(null));
    sock.send(Buffer.concat([OOB, Buffer.from('getstatus\n')]), port, host);
  });
}
