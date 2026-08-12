// Vytáhne všechny <script> bloky z index.html a ověří jejich syntaxi (node --check)
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const FILE = require('path').resolve(__dirname, '..', 'index.html');
const TMP = path.join(__dirname, '_syncchk');
fs.mkdirSync(TMP, { recursive: true });

const html = fs.readFileSync(FILE, 'utf8');
const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html)) !== null) {
  i++;
  const attrs = m[1] || '';
  const code = m[2];
  if (/\bsrc\s*=/.test(attrs)) { console.log(`#${i}: external (skip)`); continue; }
  const line = html.slice(0, m.index).split('\n').length;
  const isModule = /type\s*=\s*["']module["']/.test(attrs);
  const f = path.join(TMP, `blk${i}.${isModule ? 'mjs' : 'js'}`);
  fs.writeFileSync(f, code);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log(`#${i} (html line ~${line}, ${code.split('\n').length} lines, ${isModule ? 'module' : 'script'}): OK`);
  } catch (e) {
    bad++;
    console.log(`#${i} (html line ~${line}): SYNTAX ERROR\n${(e.stderr || '').toString().slice(0, 800)}`);
  }
}
console.log(bad ? `${bad} BLOKŮ S CHYBOU` : 'ALL OK');
process.exit(bad ? 1 : 0);
