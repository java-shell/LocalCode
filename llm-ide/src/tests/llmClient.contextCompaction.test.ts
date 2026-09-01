import test from 'node:test';
import assert from 'node:assert/strict';
import { compactMessagesForContext, estimateMessagesTokens } from '../backend/llmClient';
import type { ChatMessage } from '../shared/types';

/**
 * Regression test for the "compaction never triggers" bug.
 *
 * The character-based estimator (chars / 4) undercounts real tokens for most
 * tokenizers (~12% low for English/code). When a conversation sits just over the
 * model's real context window, the estimate can still be below the safe limit, so the
 * non-forced compaction path returns the messages unchanged (a no-op) and the overflow
 * error is re-thrown to the user.
 *
 * The fix: when the provider has already reported an overflow, compaction is forced
 * (bypassing the "already fits" shortcut) and targets a tighter budget so the compacted
 * context actually fits the real window.
 */

const WINDOW = 65536;
const MARGIN = 1024;
const NON_FORCE_SAFE_LIMIT = WINDOW - MARGIN; // 64512
const FORCE_SAFE_LIMIT = WINDOW - Math.max(MARGIN, Math.round(WINDOW * 0.3)); // 45875

function buildConversation(messageCount: number, charsPerMessage: number): ChatMessage[] {
  const filler = 'lorem ipsum dolor sit amet '.repeat(Math.ceil(charsPerMessage / 27));
  return Array.from({ length: messageCount }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${index}: ${filler.slice(0, charsPerMessage)}`
  }));
}

test('non-forced compaction is a no-op when the estimate fits but the real count overflows', () => {
  // 10 messages x 20000 chars -> estimate ~50k tokens: below the non-forced safe limit
  // (64512) but above the forced safe limit (45875). This is exactly the boundary where
  // the estimator's underestimate hides a real overflow.
  const messages = buildConversation(10, 20000);
  const estimate = estimateMessagesTokens(messages);

  // Pin the scenario: the estimate says "fits" (so non-forced compaction would skip),
  // yet it is large enough that forcing must actually compact.
  assert.ok(estimate < NON_FORCE_SAFE_LIMIT, `estimate ${estimate} should be below non-forced safe limit ${NON_FORCE_SAFE_LIMIT}`);
  assert.ok(estimate > FORCE_SAFE_LIMIT, `estimate ${estimate} should be above forced safe limit ${FORCE_SAFE_LIMIT}`);

  const nonForced = compactMessagesForContext(messages, WINDOW, MARGIN);
  assert.equal(nonForced, messages, 'non-forced compaction must be a no-op when the estimate fits');
});

test('forced compaction reduces the context when the estimate fits but the real count overflows', () => {
  const messages = buildConversation(10, 20000);
  const estimate = estimateMessagesTokens(messages);
  assert.ok(estimate < NON_FORCE_SAFE_LIMIT, 'precondition: estimate below non-forced safe limit');

  const forced = compactMessagesForContext(messages, WINDOW, MARGIN, true);

  assert.notEqual(forced, messages, 'forced compaction must not return the original array');
  assert.ok(forced.length < messages.length, `forced compaction should reduce message count (${forced.length} < ${messages.length})`);
  assert.ok(
    estimateMessagesTokens(forced) <= FORCE_SAFE_LIMIT,
    `forced compaction should target the tighter budget (estimate ${estimateMessagesTokens(forced)} <= ${FORCE_SAFE_LIMIT})`
  );
});

test('forced compaction is a no-op only when there is no context window configured', () => {
  const messages = buildConversation(10, 20000);
  const forced = compactMessagesForContext(messages, 0, MARGIN, true);
  assert.equal(forced, messages, 'with no context window, compaction cannot do anything');
});
