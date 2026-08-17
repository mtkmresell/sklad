// Čtečka skladu (nastroje/sklad.js) — rozbalování odpovědí z Firestore,
// skládání položek z hlavního dokumentu a archivů, úprava výstupu.
//
// Běží bez prohlížeče a bez sítě: testuje se ta část, která data přebírá
// a přerovnává, ne to, jak se stahují.

const path = require('path');
const N = require(path.resolve(__dirname, '..', 'nastroje', 'sklad.js'));

let selhalo = 0, proslo = 0;
function ok(popis, podminka) {
  if (podminka) { proslo++; }
  else { selhalo++; console.log('FAIL: ' + popis); }
}
function shoda(popis, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { proslo++; }
  else { selhalo++; console.log('FAIL: ' + popis + '\n  čekáno: ' + sb + '\n  dostal: ' + sa); }
}

/* ── Rozbalení typů, které Firestore posílá ─────────────────────────── */
shoda('řetězec', N.rozbal({ stringValue: 'Nike' }), 'Nike');
shoda('celé číslo', N.rozbal({ integerValue: '1200' }), 1200);
shoda('desetinné číslo', N.rozbal({ doubleValue: 24.9 }), 24.9);
shoda('pravda/nepravda', N.rozbal({ booleanValue: true }), true);
shoda('prázdná hodnota', N.rozbal({ nullValue: null }), null);
shoda('pole', N.rozbal({ arrayValue: { values: [{ stringValue: 'a' }, { integerValue: '2' }] } }), ['a', 2]);
shoda('prázdné pole', N.rozbal({ arrayValue: {} }), []);
shoda('vnořená mapa',
  N.rozbal({ mapValue: { fields: { name: { stringValue: 'Jordan' }, qty: { integerValue: '3' } } } }),
  { name: 'Jordan', qty: 3 });
shoda('mapa v poli',
  N.rozbal({ arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'x1' } } } }] } }),
  [{ id: 'x1' }]);

// Celý dokument najednou
shoda('rozbalení dokumentu',
  N.rozbalPole({ savedAt: { stringValue: '2026-01-05T10:00:00Z' }, archiveYears: { arrayValue: { values: [{ stringValue: '2025' }] } } }),
  { savedAt: '2026-01-05T10:00:00Z', archiveYears: ['2025'] });

/* ── Skládání položek z hlavního dokumentu a archivů ────────────────── */
const naSklade = { id: 's1', name: 'Dunk Low', saleState: 'stock' };
const prodano25 = { id: 'p1', name: 'Jordan 1', saleState: 'paid', payoutDate: '2025-06-01' };
const prodano26 = { id: 'p2', name: 'Yeezy', saleState: 'paid', payoutDate: '2026-02-11' };

const rozdelene = { itemsStock: [naSklade], archiveYears: ['2025', '2026'], items: [] };
const archivy = { '2025': [prodano25], '2026': [prodano26] };

shoda('sklad + oba archivy dohromady',
  N.slozPolozky(rozdelene, archivy).map(function (i) { return i.id; }),
  ['s1', 'p1', 'p2']);

shoda('archiv, který ještě nedorazil, se přeskočí',
  N.slozPolozky(rozdelene, { '2025': [prodano25] }).map(function (i) { return i.id; }),
  ['s1', 'p1']);

// Dokumenty ze starší verze aplikace mají všechno v poli items
shoda('starý formát s kompletním seznamem',
  N.slozPolozky({ items: [naSklade, prodano25] }, {}).map(function (i) { return i.id; }),
  ['s1', 'p1']);

shoda('prázdný dokument nespadne', N.slozPolozky(null, {}), []);
shoda('dokument bez položek', N.slozPolozky({}, {}), []);

/* ── Profily ────────────────────────────────────────────────────────── */
const smes = [
  { id: 'a', personal: true },
  { id: 'b', personal: false },
  { id: 'c' },                      // bez pole = podnikání, kvůli starším datům
];
shoda('osobní profil', N.uprav(smes, { profil: 'osobni' }).map(function (i) { return i.id; }), ['a']);
shoda('profil podnikání', N.uprav(smes, { profil: 'podnikani' }).map(function (i) { return i.id; }), ['b', 'c']);
shoda('všechno', N.uprav(smes, { profil: 'vse' }).map(function (i) { return i.id; }), ['a', 'b', 'c']);
ok('položka bez pole personal není osobní', N.jeOsobni({ id: 'c' }) === false);

/* ── Fotky se do výstupu netahají ───────────────────────────────────── */
const sFotkou = { id: 'f1', name: 'Bota', imgUrl: 'data:image/jpeg;base64,AAAABBBB' };
const vysledek = N.bezFotek(sFotkou);
ok('base64 fotka se vyhodí', vysledek.imgUrl === undefined);
ok('zůstane značka, že fotka existuje', vysledek.maFotku === 1);

const sOdkazem = { id: 'f2', imgUrl: 'https://images.stockx.com/bota.jpg' };
ok('odkazovaný obrázek zůstane', N.bezFotek(sOdkazem).imgUrl === 'https://images.stockx.com/bota.jpg');
ok('u odkazu se značka nepřidává', N.bezFotek(sOdkazem).maFotku === undefined);

ok('značka hasPhoto z cloudu se převede', N.bezFotek({ id: 'f3', hasPhoto: 1 }).maFotku === 1);
ok('pomocná pole aplikace se vyhodí', N.bezFotek({ id: 'f4', _tmp: 'x' })._tmp === undefined);

/* ── Výběr sloupců a limit ──────────────────────────────────────────── */
const trojice = [{ id: '1', name: 'A', buyPrice: 100 }, { id: '2', name: 'B', buyPrice: 200 }, { id: '3', name: 'C' }];
shoda('jen vyjmenované sloupce',
  N.uprav(trojice, { profil: 'vse', pole: ['name', 'buyPrice'] }),
  [{ name: 'A', buyPrice: 100 }, { name: 'B', buyPrice: 200 }, { name: 'C' }]);
shoda('limit ořízne seznam',
  N.uprav(trojice, { profil: 'vse', limit: 2 }).map(function (i) { return i.id; }),
  ['1', '2']);

/* ── Nastavení ──────────────────────────────────────────────────────── */
const nast = N.nastaveniZDat({ savedAt: 'x', retailers: ['a'], items: [1, 2], itemsStock: [3] });
ok('seznamy položek do nastavení nepatří', nast.items === undefined && nast.itemsStock === undefined);
ok('ostatní nastavení zůstane', nast.retailers[0] === 'a' && nast.savedAt === 'x');

/* ── Souhrn ─────────────────────────────────────────────────────────── */
const text = N.vypisSouhrn(
  [naSklade, prodano25, prodano26, { id: 'w1', saleState: 'waiting' }],
  { customers: [{ id: 'c1' }], partners: [] },
  { savedAt: '2026-01-05T10:00:00Z' }
);
ok('souhrn spočítá sklad', /na skladě\s+1/.test(text));
ok('souhrn spočítá čekající', /čeká na payout\s+1/.test(text));
ok('souhrn spočítá prodané', /prodáno\s+2/.test(text));
ok('souhrn rozepíše roky', /2025\s+1/.test(text) && /2026\s+1/.test(text));
ok('souhrn uvede zákazníky', /zákazníci\s+1/.test(text));

/* ── Skript nesmí umět zapisovat ────────────────────────────────────── */
const zdroj = require('fs').readFileSync(path.resolve(__dirname, '..', 'nastroje', 'sklad.js'), 'utf8');
// Kód, který by uměl měnit data v cloudu — nesmí tu být ani omylem
ok('žádný zápisový commit', !/documents:commit/.test(zdroj));
ok('žádné mazání dokumentů', !/method:\s*['"]DELETE/.test(zdroj));
ok('žádný PATCH', !/method:\s*['"]PATCH/.test(zdroj));
// Jediný POST, který tu smí být, je přihlášení a hromadné čtení
const posty = (zdroj.match(/method:\s*'POST'/g) || []).length;
ok('nejvýš dvě POST volání (přihlášení + batchGet)', posty <= 2);

console.log(selhalo ? selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo' : 'OK (' + proslo + ' kontrol)');
process.exit(selhalo ? 1 : 0);
