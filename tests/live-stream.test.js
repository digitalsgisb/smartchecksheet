import test from 'node:test';
import assert from 'node:assert/strict';
import { createSseHub } from '../server/sseHub.js';
import { createLagCheck } from '../src/streamLag.js';

function screen() { return { frames: [], writableNeedDrain: false, ended: false, destroyed: false, write(text) { this.frames.push(JSON.parse(text.split('data: ')[1])); }, end() { this.ended = true; }, destroy() { this.destroyed = true; } }; }
function hub(options = {}) {
  let clock = 0, version = 0;
  const value = createSseHub({ snapshot: line => ({ line, version }), now: () => clock, ...options });
  return { hub: value, tick: ms => { clock += ms; }, bump: () => version++ };
}

test('each screen gets its current line state on connect, then only its own line', () => {
  const { hub: live, tick, bump } = hub(), abb7 = screen(), abb2 = screen();
  live.add(abb7, { line: 'ABB7' }); live.add(abb2, { line: 'ABB2' });
  assert.deepEqual([abb7.frames, abb2.frames], [[{ line: 'ABB7', version: 0 }], [{ line: 'ABB2', version: 0 }]]);
  tick(1000); bump(); live.mark('ABB7'); live.flush();
  assert.deepEqual(abb7.frames.at(-1), { line: 'ABB7', version: 1 });
  assert.equal(abb2.frames.length, 1);
  tick(1000); live.mark(null); live.flush();
  assert.equal(abb2.frames.length, 2, 'a change without a line reaches every screen');
});

test('several changes within a second send one frame, holding the latest for the next flush', () => {
  const { hub: live, tick, bump } = hub(), tv = screen();
  live.add(tv, { line: 'ABB7' });
  for (let i = 0; i < 5; i++) { tick(100); bump(); live.mark('ABB7'); live.flush(); }
  assert.equal(tv.frames.length, 1, 'nothing extra inside the first second');
  tick(500); live.flush();
  assert.equal(tv.frames.length, 2);
  assert.equal(tv.frames.at(-1).version, 5, 'the frame sent is the newest state, not a queued old one');
  tick(2000); live.flush();
  assert.equal(tv.frames.length, 2, 'nothing is sent when nothing changed');
});

test('a backed-up screen gets no backlog and is cut off when stuck, so it reconnects fresh', () => {
  const { hub: live, tick, bump } = hub({ stuckMs: 30000 }), tv = screen();
  live.add(tv, { line: 'ABB7' }); tv.writableNeedDrain = true;
  for (let i = 0; i < 20; i++) { tick(1000); bump(); live.mark('ABB7'); live.flush(); }
  assert.equal(tv.frames.length, 1, 'old states are not queued behind a slow link');
  tv.writableNeedDrain = false; tick(1000); live.flush();
  assert.equal(tv.frames.at(-1).version, 20, 'once drained it gets the newest state');
  tv.writableNeedDrain = true;
  for (let i = 0; i < 31; i++) { tick(1000); bump(); live.mark('ABB7'); live.flush(); }
  assert.equal(tv.destroyed, true);
  assert.equal(live.size, 0);
});

test('a screen whose account lost the line is closed instead of updated', () => {
  let allowed = true;
  const { hub: live, tick } = hub({ allowed: () => allowed }), tablet = screen();
  live.add(tablet, { line: 'ABB7' }); allowed = false; tick(1000); live.mark('ABB7'); live.flush();
  assert.equal(tablet.ended, true); assert.equal(tablet.frames.length, 1); assert.equal(live.size, 0);
});

test('lag check ignores clock differences and flags states that arrive late', () => {
  let clock = 5_000_000;
  const lagging = createLagCheck({ limitMs: 15000, now: () => clock });
  // The TV clock is 2 minutes ahead of the server: not lag.
  assert.equal(lagging(clock - 120000), false);
  clock += 1000; assert.equal(lagging(clock - 121000), false);
  clock += 1000; assert.equal(lagging(clock - 120000 - 16000), true, 'a state 16 s older than usual is old');
  assert.equal(lagging(undefined), false, 'older servers without serverTime never trigger reconnects');
});
