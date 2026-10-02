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

test('extreme fallback preserves the latest user request rather than older context', () => {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'System policy: preserve the latest user intent and respond accordingly.'
    },
    {
      role: 'user',
      content: `Earlier request ${'alpha '.repeat(3000)}`
    },
    {
      role: 'assistant',
      content: `Prior analysis ${'beta '.repeat(3000)}`
    },
    {
      role: 'user',
      content: `LATEST_USER_MARKER ${'gamma '.repeat(6000)}`
    }
  ];

  const compacted = compactMessagesForContext(messages, 512, 256, true);
  const latestUser = compacted.filter(message => message.role === 'user').at(-1);

  assert.ok(latestUser, 'compacted output should still include a user message');
  assert.match(String(latestUser?.content ?? ''), /LATEST_USER_MARKER/, 'latest user request should survive compaction fallback');
});

test('compaction keeps at least one system policy message when one existed originally', () => {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'System policy: do not lose safety instructions during compaction.'
    },
    ...buildConversation(8, 18000)
  ];

  const compacted = compactMessagesForContext(messages, WINDOW, MARGIN, true);
  const hasSystem = compacted.some(
    message => message.role === 'system' && String(message.content ?? '').trim().length > 0
  );

  assert.equal(hasSystem, true, 'at least one system message should be preserved');
});

test('compaction removes orphan tool results and orphan assistant tool calls', () => {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'Keep tool call chains coherent.'
    },
    {
      role: 'user',
      content: `Investigate repository layout ${'delta '.repeat(1500)}`
    },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call-a',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"README.md","startLine":1,"endLine":120}'
          }
        },
        {
          id: 'call-b',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"package.json","startLine":1,"endLine":80}'
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'call-a',
      content: `README content ${'epsilon '.repeat(2000)}`
    },
    {
      role: 'tool',
      tool_call_id: 'ghost-call',
      content: `orphaned tool output ${'zeta '.repeat(2000)}`
    },
    {
      role: 'user',
      content: `LATEST_USER_MARKER Please summarize findings ${'eta '.repeat(2500)}`
    }
  ];

  const compacted = compactMessagesForContext(messages, 24000, 1024, true);

  const assistantCallIds = new Set(
    compacted
      .filter(message => message.role === 'assistant')
      .flatMap(message => (message.tool_calls ?? []).map(call => String(call.id ?? '').trim()).filter(Boolean))
  );
  const toolResultIds = compacted
    .filter(message => message.role === 'tool')
    .map(message => String(message.tool_call_id ?? '').trim())
    .filter(Boolean);

  assert.equal(
    toolResultIds.every(id => assistantCallIds.has(id)),
    true,
    'every tool result should reference an assistant tool call in compacted context'
  );

  const toolResultSet = new Set(toolResultIds);
  const orphanAssistantCall = compacted
    .filter(message => message.role === 'assistant')
    .flatMap(message => (message.tool_calls ?? []).map(call => String(call.id ?? '').trim()).filter(Boolean))
    .find(id => !toolResultSet.has(id));

  assert.equal(Boolean(orphanAssistantCall), false, 'assistant tool calls without retained tool results should be removed');
});

test('compaction v2 soft policy is less aggressive than legacy forced policy for borderline contexts', () => {
  const messages = buildConversation(8, 4500);
  const estimated = estimateMessagesTokens(messages);
  const contextWindow = Math.max(estimated + 256, 4096);

  const legacy = compactMessagesForContext(messages, contextWindow, 1024, true, {
    stage: 'soft',
    estimatedTokens: estimated,
    confidence: 'configured',
    overflowCount: 0
  });

  const previousFlag = process.env.LOCALCODE_CONTEXT_COMPACTION_V2;
  process.env.LOCALCODE_CONTEXT_COMPACTION_V2 = '1';
  try {
    const v2 = compactMessagesForContext(messages, contextWindow, 1024, true, {
      stage: 'soft',
      estimatedTokens: estimated,
      confidence: 'configured',
      overflowCount: 0
    });
    assert.ok(
      estimateMessagesTokens(v2) >= estimateMessagesTokens(legacy),
      'v2 soft policy should preserve at least as much context as legacy forced compaction'
    );
  } finally {
    if (previousFlag === undefined) {
      delete process.env.LOCALCODE_CONTEXT_COMPACTION_V2;
    } else {
      process.env.LOCALCODE_CONTEXT_COMPACTION_V2 = previousFlag;
    }
  }
});

test('compaction v2 hard policy increases aggressiveness on repeated overflow with reported window', () => {
  const messages = buildConversation(10, 12000);
  const contextWindow = 12288;

  const previousFlag = process.env.LOCALCODE_CONTEXT_COMPACTION_V2;
  process.env.LOCALCODE_CONTEXT_COMPACTION_V2 = '1';
  try {
    const firstOverflow = compactMessagesForContext(messages, contextWindow, 1024, true, {
      stage: 'hard',
      estimatedTokens: estimateMessagesTokens(messages),
      confidence: 'reported',
      overflowCount: 1
    });
    const repeatedOverflow = compactMessagesForContext(messages, contextWindow, 1024, true, {
      stage: 'hard',
      estimatedTokens: estimateMessagesTokens(messages),
      confidence: 'reported',
      overflowCount: 3
    });

    assert.ok(
      estimateMessagesTokens(repeatedOverflow) <= estimateMessagesTokens(firstOverflow),
      'repeated reported overflows should compact at least as aggressively as first overflow'
    );
  } finally {
    if (previousFlag === undefined) {
      delete process.env.LOCALCODE_CONTEXT_COMPACTION_V2;
    } else {
      process.env.LOCALCODE_CONTEXT_COMPACTION_V2 = previousFlag;
    }
  }
});

test('aggressive compaction injects a system-role continuity digest rather than synthetic user summary', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'System policy: keep continuity.' },
    ...buildConversation(12, 16000),
    { role: 'user', content: 'LATEST_USER_MARKER continue implementation with prior constraints' }
  ];

  const compacted = compactMessagesForContext(messages, 8192, 1024, true);

  const digestSystemMessage = compacted.find(
    message => message.role === 'system' && /Conversation continuity digest/i.test(String(message.content ?? ''))
  );
  const legacyUserSummary = compacted.find(
    message => message.role === 'user' && /Earlier context summary|Compressed earlier context|omitted to fit/i.test(String(message.content ?? ''))
  );

  assert.ok(digestSystemMessage, 'compaction should include a structured system continuity digest');
  assert.equal(Boolean(legacyUserSummary), false, 'compaction should not inject legacy synthetic user summary text');
});

test('aggressive compaction shrinks oversized tool payloads with structured truncation metadata', () => {
  const oversizedToolPayload = JSON.stringify({
    ok: true,
    summary: 'Large tool output',
    result: 'A'.repeat(6000),
    stdout: 'B'.repeat(6000),
    stderr: 'C'.repeat(2000)
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: 'System policy: keep tool evidence concise.' },
    { role: 'user', content: 'Gather evidence and summarize.' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'tool-large',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"big.log","startLine":1,"endLine":2000}'
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'tool-large',
      content: oversizedToolPayload
    },
    { role: 'user', content: `LATEST_USER_MARKER ${'next '.repeat(1200)}` }
  ];

  const compacted = compactMessagesForContext(messages, 4096, 1024, true);
  const toolMessage = compacted.find(message => message.role === 'tool' && message.tool_call_id === 'tool-large');

  assert.ok(toolMessage, 'tool message should remain available in compacted context');
  const toolContent = String(toolMessage?.content ?? '');
  assert.ok(toolContent.length < oversizedToolPayload.length, 'tool payload should be compacted');
  assert.match(toolContent, /truncated|compacted/i, 'compacted tool payload should annotate truncation');
});
