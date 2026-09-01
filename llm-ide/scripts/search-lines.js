const fs = require('fs');
const path = process.argv[2];
const patterns = process.argv.slice(3);
const lines = fs.readFileSync(path, 'utf8').split('\n');
lines.forEach((x, i) => {
  if (patterns.some(p => new RegExp(p).test(x))) {
    console.log((i + 1) + ': ' + x);
  }
});
