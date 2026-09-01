const fs = require('fs');
const path = process.argv[2];
const start = parseInt(process.argv[3], 10);
const end = parseInt(process.argv[4], 10);
const lines = fs.readFileSync(path, 'utf8').split('\n');
console.log(lines.slice(start - 1, end).join('\n'));
