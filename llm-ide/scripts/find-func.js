const fs = require('fs');
const path = process.argv[2];
const funcName = process.argv[3];
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
let startIdx = -1;
for (let i = 0; i < lines.length; i += 1) {
  if (lines[i].includes(funcName)) {
    startIdx = i;
    break;
  }
}
if (startIdx === -1) {
  console.log('NOT FOUND');
  return;
}
console.log('FOUND at line ' + (startIdx + 1));
console.log(lines.slice(startIdx, startIdx + 60).join('\n'));
