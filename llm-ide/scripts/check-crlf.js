const fs = require('fs');
const path = require('path');
const files = process.argv.slice(2);
for (const f of files) {
  const full = path.resolve(f);
  const b = fs.readFileSync(full);
  let cr = 0, lf = 0;
  for (const x of b) { if (x === 13) cr++; if (x === 10) lf++; }
  console.log(f, 'CR=' + cr, 'LF=' + lf);
}
