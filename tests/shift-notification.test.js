import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedShift, setupNotice } from '../src/shiftNotification.js';

test('Shift finished notification follows confirmed endings and automatic rollover', () => {
  const day = { id: 'day', status: 'active', shift: 'Day' };
  const ended = { ...day, status: 'ended' };
  const night = { id: 'night', status: 'active', shift: 'Night' };
  assert.equal(finishedShift(null, day), null);
  assert.equal(finishedShift(day, { ...day }), null);
  assert.deepEqual(finishedShift(day, ended), ended);
  assert.deepEqual(finishedShift(null, ended), ended);
  assert.deepEqual(finishedShift(day, night), day);
  assert.equal(finishedShift(day, null), null);
  assert.equal(finishedShift(ended, night), null);
});

test('TV announces a started shift and a confirmed or changed setup, never the first state it sees', () => {
  const day = { id: 'day', status: 'active', shift: 'Day', leader: 'Aina', workingTime: '08:00 – 16:15' };
  const setup = { model: '681W FC', lot: 'L1', plan: 18 };
  assert.equal(setupNotice(null, { shift: day, setup }), null, 'TV just opened');
  const started = setupNotice({ shift: null, setup: null }, { shift: day, setup: null });
  assert.equal(started.kind, 'shift'); assert.equal(started.title, 'Day shift started'); assert.equal(started.text, 'Waiting for model setup'); assert.equal(started.detail, 'Leader Aina · 08:00 – 16:15');
  const confirmed = setupNotice({ shift: day, setup: null }, { shift: day, setup });
  assert.deepEqual([confirmed.kind, confirmed.title, confirmed.text, confirmed.detail], ['setup', 'Setup confirmed', '681W FC · Lot L1', 'Target 18 pcs/hr']);
  assert.equal(setupNotice({ shift: day, setup }, { shift: day, setup: { ...setup } }), null, 'same setup again');
  assert.equal(setupNotice({ shift: day, setup }, { shift: day, setup: { ...setup, model: 'KA4' } }).title, 'Model changed');
  assert.equal(setupNotice({ shift: day, setup }, { shift: day, setup: { ...setup, lot: 'L2' } }).title, 'Setup confirmed');
  assert.equal(setupNotice({ shift: day, setup }, { shift: { ...day, status: 'ended' }, setup }), null, 'an ended shift is not announced here');
  assert.equal(setupNotice({ shift: { ...day, status: 'ended' }, setup }, { shift: { ...day, id: 'night', shift: 'Night' }, setup }).text, '681W FC · Lot L1');
});
