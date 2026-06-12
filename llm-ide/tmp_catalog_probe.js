const { listModelCatalog } = require('./out/backend/llmClient.js');
(async () => {
  const result = await listModelCatalog({ endpoint: 'http://192.168.0.224:11434/v1/chat/completions' });
  const sample = Object.fromEntries(Object.entries(result.contextWindows || {}).filter(([k]) => /granite41-augmented-q5-tools-toolcall-v[456]|qwen25-java-sme-v4/i.test(k)));
  console.log(JSON.stringify({ sample, count: Object.keys(result.contextWindows || {}).length }, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
