const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n');
lines.forEach((x, i) => {
  if (x.includes("'read_file'") || x.includes('"read_file"') || x.includes('read_file:')) {
    console.log((i + 1) + ': ' + x.trim());
  }
});
