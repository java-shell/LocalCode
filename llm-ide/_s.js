const fs = require("fs");
const s = fs.readFileSync("src/main.ts", "utf8");
const lines = s.split("\n");
for (let i = 810; i <= 925; i++) {
  if (lines[i] !== undefined) console.log(i + 1, JSON.stringify(lines[i].slice(0, 120)));
}

 
