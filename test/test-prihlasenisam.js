// Test: samostatné přihlášení v prohlížeči kontrol (nastroje/prohlizec.py,
// prihlas_sam) — se SKUTEČNÝM prohlížečem proti zkušebním formulářům.
//
// Podvrh by tu nepomohl: první verze na skutečném Chromiu neodeslala
// formulář bez tlačítka (Enter v poli hesla ho neodešle, když má formulář
// víc polí). Zkouší se: bez tlačítka, s tlačítkem, dvoukrokový (heslo až
// na druhé obrazovce), špatné uložené heslo (zapomene a zeptá se znovu)
// a už přihlášený (neptá se vůbec).
//
// Potřebuje Python Playwright (u Gabra na PC ho nainstaluje
// PRIHLASIT_WEBY.bat). Bez něj se test přeskočí a řekne to.
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');

const py = process.env.PROHLIZEC_PYTHON || 'python3';
const mam = spawnSync(py, ['-c', 'import playwright'], { encoding: 'utf8' }).status === 0;
if (!mam) {
  console.log('OK (přeskočeno — chybí Python Playwright; nastav PROHLIZEC_PYTHON na Python s Playwrightem)');
  process.exit(0);
}
let chromium = process.env.PROHLIZEC_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');
const out = execFileSync(py, [path.join(__dirname, 'prihlaseni_prohlizec.py')],
  { encoding: 'utf8', timeout: 180000, env: Object.assign({}, process.env, chromium ? { PROHLIZEC_CHROMIUM: chromium } : {}) });
const v = JSON.parse(out.slice(out.indexOf('{')));
let selhalo = 0;
const ok = (p, c, d) => { if (!c) { selhalo++; console.log('FAIL: ' + p + '\n  ' + (d || '')); } };
for (const k of ['jednokrok', 'dvoukrok', 's_tlacitkem'])
  ok(k + ': přihlásí se a uloží heslo', v[k].ok === true && v[k].prihlasen && v[k].ulozeno.includes(k), JSON.stringify(v[k]));
ok('špatné uložené heslo: zapomene, zeptá se znovu a uloží nové', v.spatne_heslo.ok === true && JSON.stringify(v.spatne_heslo.zapomenuto) === '["spatne"]'
  && JSON.stringify(v.spatne_heslo.ulozeno) === '["spatne"]', JSON.stringify(v.spatne_heslo));
ok('už přihlášený: na heslo se neptá', v.uz_prihlasen === true);
console.log(selhalo ? 'SELHALO ' + selhalo : 'OK (5 kontrol)');
process.exit(selhalo ? 1 : 0);
