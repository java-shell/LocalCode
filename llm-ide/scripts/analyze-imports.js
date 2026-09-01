const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n');
// Print import lines
console.log('=== IMPORTS ===');
lines.slice(0, 10).forEach((x, i) => console.log((i + 1) + ': ' + x));

// Find estimateMessagesTokens definition or usage
console.log('\n=== estimateMessagesTokens ===');
lines.forEach((x, i) => {
  if (x.includes('estimateMessagesTokens')) console.log((i + 1) + ': ' + x.trim());
});
