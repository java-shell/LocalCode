const fs = require('fs');
const c = fs.readFileSync('llmClient.ts', 'utf8');
console.log(c.split('\n').length);
