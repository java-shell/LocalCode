const { chatWithTools } = require('./out/backend/llmClient.js');
(async () => {
  const result = await chatWithTools(
    {
      provider: 'ollama',
      endpoint: 'http://192.168.0.224:11434/v1/chat/completions',
      model: 'granite41-augmented-q5-tools-toolcall-v6-ctx64k-plaintext:latest',
      temperature: 0.2,
      maxTokens: 0,
      contextWindowTokens: 12345
    },
    [{ role: 'user', content: 'Reply with exactly the word pong.' }],
    [],
    async () => ({ ok: true }),
    (event) => console.log('EVENT', event),
    5
  );
  console.log(JSON.stringify(result, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
