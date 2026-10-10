import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus } from '../src/status.js';

const oob = s => Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from(s, 'latin1')]);

test('counts humans by ping and bots as ping 0', () => {
  const st = parseStatus(oob('statusResponse\n\\mapname\\oa_dm1\\sv_maxclients\\8\n3 0 "^1Sarge"\n7 48 "Alpha"\n0 999 "Bravo"\n'));
  assert.equal(st.info.mapname, 'oa_dm1');
  assert.equal(st.humans, 2);
  assert.equal(st.bots, 1);
  assert.deepEqual(st.players[0], { score: 3, ping: 0, name: 'Sarge' });
});

test('rejects non-status packets', () => {
  assert.equal(parseStatus(Buffer.from('hello')), null);
  assert.equal(parseStatus(oob('infoResponse\n')), null);
});
