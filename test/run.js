#!/usr/bin/env node
// Spustí kontrolu syntaxe a všechny testy. Bez argumentu jede všechno,
// jinak jen soubory, jejichž název obsahuje zadaný text:
//
//   node test/run.js              — vše
//   node test/run.js archive      — jen test-archive.js
//   node test/run.js cache listener
//
const { execFileSync, execFileSync: run } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const filtry = process.argv.slice(2);

// Playwright a chromium bývají mimo projekt — doplň cesty, pokud existují
const env = Object.assign({}, process.env);
if (!env.NODE_PATH && fs.existsSync('/opt/node22/lib/node_modules')) {
  env.NODE_PATH = '/opt/node22/lib/node_modules';
}

function zkusZjistitChromium() {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  const kandidati = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return kandidati.find(p => fs.existsSync(p)) || null;
}

const soubory = fs.readdirSync(DIR)
  .filter(f => /^test-.*\.js$/.test(f))
  .filter(f => !filtry.length || filtry.some(q => f.includes(q)))
  .sort();

if (!soubory.length) {
  console.error(filtry.length ? 'Žádný test neodpovídá: ' + filtry.join(', ') : 'Žádné testy nenalezeny.');
  process.exit(1);
}

// ── 1) Syntaxe ──────────────────────────────────────────────
console.log('\x1b[1m── Kontrola syntaxe ─────────────────────────────────\x1b[0m');
try {
  const out = execFileSync(process.execPath, [path.join(DIR, 'synccheck.js')], { env, encoding: 'utf8' });
  const posledni = out.trim().split('\n').pop();
  console.log(posledni);
  if (!/ALL OK/.test(posledni)) process.exit(1);
} catch (e) {
  console.error((e.stdout || '') + (e.stderr || ''));
  process.exit(1);
}

// ── 2) Testy ────────────────────────────────────────────────
const chromium = zkusZjistitChromium();
if (!chromium) {
  console.error('\nNenašel jsem Chromium. Nastav CHROMIUM_PATH na cestu k prohlížeči.');
  process.exit(1);
}
env.CHROMIUM_PATH = chromium;

console.log('\n\x1b[1m── Testy (' + soubory.length + ') ──────────────────────────────────\x1b[0m');
let selhalo = [];
for (const f of soubory) {
  const zacatek = Date.now();
  let vysledek, kod = 0;
  try {
    vysledek = execFileSync(process.execPath, [path.join(DIR, f)], { env, encoding: 'utf8', timeout: 600000 });
  } catch (e) {
    kod = e.status === undefined ? 1 : e.status;
    vysledek = (e.stdout || '') + (e.stderr || '');
  }
  const sekundy = ((Date.now() - zacatek) / 1000).toFixed(0);
  const shrnuti = vysledek.trim().split('\n').filter(Boolean).pop() || '(bez výstupu)';
  const znak = kod === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(znak + ' ' + f.padEnd(24) + shrnuti.padEnd(24) + sekundy + ' s');
  if (kod !== 0) {
    selhalo.push(f);
    vysledek.split('\n').filter(r => /^FAIL|ERROR/.test(r)).slice(0, 8).forEach(r => console.log('    ' + r));
  }
}

console.log();
if (selhalo.length) {
  console.log('\x1b[31m' + selhalo.length + ' z ' + soubory.length + ' souborů selhalo: ' + selhalo.join(', ') + '\x1b[0m');
  process.exit(1);
}
console.log('\x1b[32mVšech ' + soubory.length + ' souborů prošlo.\x1b[0m');
