const fs = require('fs');
const path = require('path');
const root = process.argv[2] || 'llm-ide';
const needle = process.argv[3] || 'MAX_TOOL_RESULT_MESSAGE_CHARS';

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!p.includes('node_modules') && !p.includes('.git') && !p.includes('.turbovec-venv')) {
        walk(p);
      }
    } else if (/\.(ts|js|mjs)$/.test(e.name)) {
      try {
        const t = fs.readFileSync(p, 'utf8');
        if (t.includes(needle)) {
          console.log('FILE: ' + p);
          t.split('\n').forEach((l, i) => {
            if (l.includes(needle)) console.log('  ' + (i + 1) + ': ' + l.trim());
          });
        }
      } catch (e) {}
    }
  }
}
walk(root);
console.log('DONE');
