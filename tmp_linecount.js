const fs = require('fs');
const files = [
  'llm-ide/src/backend/llmClient.ts',
  'llm-ide/src/tests/llmClient.openaiStreaming.test.ts',
  'llm-ide/src/tests/llmClient.ollamaStreaming.test.ts',
  'llm-ide/src/tests/llmClient.thinkingSummary.test.ts',
];
for (const f of files) {
  try {
    const n = fs.readFileSync(f, 'utf8').split('\n').length;
    console.log(f, n);
  } catch (e) {
    console.log(f, 'ERR', e.message);
  }
}
