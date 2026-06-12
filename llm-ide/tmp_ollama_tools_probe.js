const { chatWithTools } = require('./out/backend/llmClient.js');
const { getAllowedToolDefinitions } = require('./out/backend/toolRuntime.js');
const toolNames = [
  'browser_fetch','web_search','list_repo_tree','list_dir','file_search','read_file','create_file','write_file','replace_in_file','insert_in_file','create_directory','move_path','grep_search','git_status','git_diff','git_add','run_terminal_command'
];
const toolDefs = getAllowedToolDefinitions(toolNames);
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
    toolDefs,
    async (name, args) => ({ tool: name, ok: true, args }),
    (event) => console.log('EVENT', event),
    5
  );
  console.log(JSON.stringify({ text: result.text, usage: result.usage, toolCount: toolDefs.length }, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
