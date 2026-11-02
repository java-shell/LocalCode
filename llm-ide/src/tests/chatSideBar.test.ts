import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { ChatSideBar } from '../backend/chatSideBar';
import type { ChatSideBarState } from '../shared/types';

/** Controllable async result; tests advance lifecycle boundaries without timers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('Side-Bar waits for a safe boundary and retains serial exchanges across pauses', async () => {
  const states: ChatSideBarState[] = [];
  const gate = new ChatSideBar('session', state => states.push(state));
  assert.equal((await gate.message('early')).reason, 'not_paused');
  assert.equal(gate.start().accepted, true);
  assert.equal(gate.state.mode, 'pending');
  const abort = new AbortController();
  const waiting = gate.atBoundary(async text => `Reply: ${text}`, abort.signal);
  assert.equal(gate.state.mode, 'paused');
  assert.equal(getEventListeners(abort.signal, 'abort').length, 1);
  assert.equal((await gate.message('   ')).reason, 'invalid_content');
  assert.equal((await gate.message('x'.repeat(100001))).reason, 'invalid_content');
  assert.equal((await gate.message('Status?')).text, 'Reply: Status?');
  assert.equal((await gate.message('Change direction')).accepted, true);
  assert.deepEqual(gate.transcript.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
  assert.ok(gate.transcript.every(message => message.sideBar));
  assert.equal(gate.resume().accepted, true);
  await waiting;
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  gate.start();
  gate.resume();
  await gate.atBoundary(async () => { throw new Error('must not pause'); });
  assert.equal(gate.state.mode, 'running');
  assert.ok(states.some(state => state.busy));
});

test('Side-Bar rejects overlapping sends/resume and remains paused after provider errors', async () => {
  const gate = new ChatSideBar('session', () => {});
  const answer = deferred<string>();
  gate.start();
  const waiting = gate.atBoundary(() => answer.promise);
  const first = gate.message('one');
  assert.equal((await gate.message('two')).reason, 'reply_in_progress');
  assert.equal(gate.resume().reason, 'reply_in_progress');
  answer.resolve('answer');
  await first;
  gate.resume();
  await waiting;

  gate.start();
  const secondWait = gate.atBoundary(async () => { throw new Error('provider failed'); });
  await assert.rejects(gate.message('retryable'), /provider failed/);
  assert.equal(gate.state.mode, 'paused');
  assert.equal(gate.state.busy, false);
  assert.equal(gate.transcript.length, 2);
  gate.close();
  await secondWait;
  assert.equal(gate.start().reason, 'run_closed');
  assert.equal(gate.resume().reason, 'run_closed');
});

test('abort and close release pause waiters without leaking listeners or late exchanges', async () => {
  for (const action of ['abort', 'close'] as const) {
    const gate = new ChatSideBar('session', () => {});
    const abort = new AbortController();
    gate.start();
    const waiting = gate.atBoundary(async () => 'unused', abort.signal);
    if (action === 'abort') abort.abort();
    else gate.close();
    await waiting;
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  }
  const gate = new ChatSideBar('session', () => {});
  const answer = deferred<string>();
  gate.start();
  const waiting = gate.atBoundary(() => answer.promise);
  const response = gate.message('late');
  gate.close();
  answer.resolve('must not persist');
  await assert.rejects(response, /canceled/);
  await waiting;
  assert.equal(gate.transcript.length, 0);
});