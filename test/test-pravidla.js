// Test: firestore.rules — kdo smí co.
//
// Pravidla se nasazují ručně v konzoli, takže je nikdo nekontroluje. Tenhle
// test čte soubor v repozitáři a hlídá to, co se dá zkazit tiše: zbylé
// zástupné texty, zápis povolený někomu jinému než majiteli, a hlavně
// účetního u zákazníků. Rozdíl mezi „zamčené" a „schované" stojí právě
// na tom posledním.
//
// Kontroluje se text pravidel, ne živý Firestore. Že je v provozu totéž,
// co je tady, se ověřuje ručně — viz hlavička firestore.rules.

const fs = require('fs');
const path = require('path');

let selhalo = 0, proslo = 0;
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail ? '\n  ' + detail : '')); }
}

const SOUBOR = path.resolve(__dirname, '..', 'firestore.rules');
const zdroj = fs.readFileSync(SOUBOR, 'utf8');

// Kód bez komentářů — komentáře smí zmiňovat cokoli, pravidla ne
const kod = zdroj.split('\n').filter(r => !r.trim().startsWith('//')).join('\n');

/* ── Nic nevyplněného ───────────────────────────────────────────────── */
ok('žádné zbylé zástupné texty', !/SEM_UID|VLOZ_|TVUJ_|<[A-Z_]+>/.test(kod),
  (kod.match(/SEM_UID\w*|VLOZ_\w*|TVUJ_\w*/g) || []).join(', '));
ok('žádné prázdné porovnání s UID', !/uid\s*==\s*['"]['"]/.test(kod));

/* ── Role ───────────────────────────────────────────────────────────── */
for (const fn of ['jeMajitel', 'jeCtecka', 'jeUcetni']) {
  ok('funkce ' + fn + ' je definovaná', new RegExp('function\\s+' + fn + '\\s*\\(').test(kod));
}
// Každá volaná funkce musí existovat, jinak Firestore pravidla odmítne
const volane = new Set((kod.match(/\bje[A-Z]\w*(?=\s*\()/g) || []));
const definovane = new Set((kod.match(/function\s+(je\w+)/g) || []).map(s => s.replace(/function\s+/, '')));
for (const v of volane) ok('volaná funkce ' + v + ' je i definovaná', definovane.has(v));

// UID musí vypadat jako UID — 28 znaků, písmena a číslice
const uidy = (kod.match(/['"][A-Za-z0-9]{20,40}['"]/g) || []).map(s => s.slice(1, -1));
const ruzna = new Set(uidy);
// UID majitele je uvedené dvakrát — jednou v roli čtečky, jednou u účetního.
// Obě role totiž musí říct nejen kdo čte, ale i čí složku smí číst.
ok('v pravidlech jsou tři různá UID', ruzna.size === 3, [...ruzna].join(', '));
ok('a celkem čtyři výskyty', uidy.length === 4, 'výskytů: ' + uidy.length);
ok('všechna UID mají tvar Firebase UID', uidy.every(u => /^[A-Za-z0-9]{28}$/.test(u)), uidy.join(', '));

/* ── Bloky ──────────────────────────────────────────────────────────── */
function blok(cesta) {
  const i = kod.indexOf('match /users/{uid}/' + cesta);
  if (i === -1) return null;
  return kod.slice(i, kod.indexOf('}', kod.indexOf('allow write', i)));
}
const sklad = blok('sklad/');
const crm = blok('crm/');
ok('sklad má vlastní blok', !!sklad);
ok('CRM má vlastní blok', !!crm);
ok('nezůstal rekurzivní blok přes celého uživatele', !/match\s+\/users\/\{uid\}\/\{\w+=\*\*\}/.test(kod),
  'takový blok by pustil účetního i k zákazníkům');

/* ── Kdo smí číst ───────────────────────────────────────────────────── */
if (sklad) {
  const cteni = (sklad.match(/allow read:([^;]*)/) || [])[1] || '';
  ok('sklad čte majitel', /jeMajitel/.test(cteni));
  ok('sklad čte čtečka', /jeCtecka/.test(cteni));
  ok('sklad čte účetní', /jeUcetni/.test(cteni), cteni.trim());
}
if (crm) {
  const cteni = (crm.match(/allow read:([^;]*)/) || [])[1] || '';
  ok('CRM čte majitel', /jeMajitel/.test(cteni));
  ok('CRM čte čtečka', /jeCtecka/.test(cteni));
  // Tohle je celý rozdíl mezi „zákazníci jsou zamčení" a „jen schovaní"
  ok('CRM NEČTE účetní', !/jeUcetni/.test(cteni), cteni.trim());
}

/* ── Kdo smí zapisovat ──────────────────────────────────────────────── */
const zapisy = kod.match(/allow write:([^;]*)/g) || [];
ok('zápis je definovaný u obou bloků', zapisy.length === 2, 'nalezeno: ' + zapisy.length);
const zapisSklad = zapisy[0] || '', zapisCrm = zapisy[1] || '';

/* Do skladu píše majitel — a nově čtečka, ale **jen lísteček** pro
   aplikaci (v index.html POŽADAVKY Z KONEKTORU). Sklad samotný jí
   zůstává zapovězený: druhý zapisovatel by se pral se synchronizací
   aplikace a neodeslaná změna by zmizela.

   Vyjmenovává se kladně, ať nová role musí projít tudy. */
ok('do skladu píše majitel', /jeMajitel/.test(zapisSklad), zapisSklad.trim());
const terminy = zapisSklad.replace('allow write:', '').match(/je[A-Za-z]+/g) || [];
ok('a kromě něj nanejvýš lísteček od čtečky',
  terminy.every(function (t) { return t === 'jeMajitel' || t === 'jePozadavekCtecky'; }),
  JSON.stringify(terminy));

/* CRM nese jména a telefony zákazníků. Tam čtečka ani účetní nesmí
   vůbec nic, ani lísteček. */
ok('do CRM píše jedině majitel',
  /jeMajitel/.test(zapisCrm) && !/jeCtecka|jeUcetni|jePozadavek/.test(zapisCrm), zapisCrm.trim());

/* Celý ten lísteček drží jediná věc: jméno dokumentu. Vzorek se proto
   vytáhne z pravidel a vyzkouší na jménech, která doopravdy existují —
   kdyby pustil `data`, čtečka by mohla přepsat celý sklad. */
if (/jePozadavekCtecky/.test(zapisSklad)) {
  const telo = (kod.match(/function jePozadavekCtecky\([^)]*\)\s*\{([\s\S]*?)\n    \}/) || [])[1] || '';
  ok('lísteček je vázaný na čtečku', /jeCtecka\(uid\)/.test(telo), telo.trim());
  const vzorek = (telo.match(/matches\('([^']+)'\)/) || [])[1];
  ok('a na jméno dokumentu', !!vzorek, telo.trim());
  if (vzorek) {
    const re = new RegExp(vzorek);
    ok('vzorek nepustí čtečku na sklad',
      !re.test('data') && !re.test('cache') && !re.test('sold_2026') && !re.test('photo_abc'),
      vzorek);
    ok('ale lísteček projde', re.test('pozadavek_a1b2c3'), vzorek);
  }
}
ok('nikde není zápis bez podmínky', !/allow write:\s*if\s+true/.test(kod));
ok('nikde není čtení bez podmínky', !/allow read:\s*if\s+true/.test(kod));
ok('nikde není allow bez upřesnění operace', !/allow\s*:\s*if/.test(kod));

/* ── Verze ──────────────────────────────────────────────────────────── */
ok('rules_version je 2', /rules_version\s*=\s*['"]2['"]/.test(kod));

/* ── Shoda s dokumentací ────────────────────────────────────────────── */
const ucetniDoc = fs.readFileSync(path.resolve(__dirname, '..', 'nastroje', 'UCETNI.md'), 'utf8');
ok('UCETNI.md pořád tvrdí, že účetní na CRM nedosáhne', /crm/i.test(ucetniDoc) && /účetní/i.test(ucetniDoc));

console.log(selhalo ? selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo' : 'OK (' + proslo + ' kontrol)');
process.exit(selhalo ? 1 : 0);
