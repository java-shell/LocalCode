const fs = require('fs');
const file = process.argv[2];
const pattern = new RegExp(process.argv[3]);
const lines = fs.readFileSync(file, 'utf8').split('\n');
lines.forEach((x, i) => {
  if (pattern.test(x)) console.log((i + 1) + ': ' + x);
});
