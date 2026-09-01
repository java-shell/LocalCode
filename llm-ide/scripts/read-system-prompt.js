const fs = require('fs');
const file = process.argv[2] || 'llm-ide/src/main.ts';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split(/\r?\n/);
console.log('Total lines:', lines.length);
console.log('Has CRLF:', content.includes('\r\n'));
console.log('--- Lines 740-800 ---');
lines.slice(739, 800).forEach((line, i) => {
  console.log(`${740 + i}: ${line}`);
});
