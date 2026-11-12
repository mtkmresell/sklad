// Test: nastroje/section_kontrola.py — kontrola Section na PC.
//
// Pravidla ze skillu „section-kontrola" (zůstává jako záloha): jen sneakers
// a oblečení, poškozené se neřeší, Prodej Shopify v tabulce je historie,
// duplicitní řádek = Smazat, dvě interní věci se nehlásí, fajfka = řádek
// v tabulce, payout = cena × 0,75, „jediný na e-shopu" = všechny dostupné
// velikosti produktu jsou Gabrovy. Tabulka i e-shop se podstrčí ve
// skutečném tvaru (CSV exportu a products.json, ověřeno 12. 11. 2026).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

let selhalo = 0, proslo = 0;
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail === undefined ? '' : '\n  ' + detail)); }
}
function sekce(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length))); }

const NASTROJE = path.resolve(__dirname, '..', 'nastroje', 'section');   // vlastní složka, sklad_firestore.py je o patro výš
const MISTA = { platforms: ['StockX'], eshopy: ['Section'], local: [] };
const s = (id, name, size, extra) => Object.assign({ id, name, size, category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [], condition: 'DS' }, extra || {});
const SKLAD = [
  s('g1', 'Nike Air Foamposite One Galaxy (2025)', '42', { platforms: ['Section'] }),
  s('g2', 'Nike Air Foamposite One Galaxy (2025)', '42.5'),
  s('t', 'Corteiz V.A.A. Tee White', 'S', { category: 'obleceni', sku: 'CRTZVAATEEWHT' }),
  s('m', 'Nike Mind 001 Slide Triple Black', '41', { platforms: ['Section'] }),        // v tabulce není → odškrtnout
  s('p', 'Pikachu Promo', '', { category: 'pokemon' }),
  s('x', 'Jordan 4 Bred', '42', { condition: 'poskozene' }),
  s('wc', 'Jordan 4 Retro White Cement (2025)', '42'),                                 // nehlásit
  s('d', 'Dunk Low Panda', '42', { saleState: 'paid', payoutDate: '2026-11-01' }),
];
const TAB = [
  'Produkt,Size,EAN,Cena,Prodej,Poznámka,Online nahozeno?,Smazat?',
  'Old Sold,42,X1,5000,1.10,,Prodej Shopify,FALSE',
  'Nike Air Foamposite One Galaxy (2025),42,196975810086,5900,,,NAHOZENO,FALSE',
  'Nike Air Foamposite One Galaxy (2025),"42,5",196975808298,6100,,,NAHOZENO,FALSE',
  'Nike Air Foamposite One Galaxy (2025),42,196975810086,5900,,,NAHOZENO,FALSE',
  'Corteiz V.A.A. Tee White,S,CRTZVAATEEWHT-S,2700,,,NAHOZENO,FALSE',
  'Dunk Low Panda,42,DD1391-100-42,3000,,,NAHOZENO,FALSE',
  'Neznámé Boty,44,ZZ-44,3000,,,NAHOZENO,FALSE',
  ',,,,,,,FALSE',
].join('\r\n');
const v = (title, sku, available, price) => ({ title, option1: title, sku, available, price: String(price) });
const ESHOP = [
  { id: 1, title: 'Nike Air Foamposite One Galaxy', handle: 'foam', images: [{ src: 'https://cdn.shopify.com/f.jpg' }],
    variants: [v('42', '196975810086', true, 5900), v('42.5', '196975808298', true, 5900), v('43', '99999', false, 99999)] },
  { id: 2, title: 'Corteiz V.A.A. Virgil Abloh Tee White', handle: 'tee', images: [],
    variants: [v('SMALL', 'CRTZVAATEEWHT-S', true, 2700), v('MEDIUM', 'CRTZVAATEEWHT-M', true, 2700)] },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'section-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import section_kontrola as K
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
K.VYSTUP = sys.argv[3] + '/vysledek.json'
zapisy = []
K.S.prihlas = lambda *a: 'token'
K.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
K.S._zapis_dokument = zapis
K.nacti_tabulku = lambda gid=0: vstup['tab']
K.nacti_eshop = lambda: vstup['eshop']
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
K.main(vstup['argv'])
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': json.load(open(K.VYSTUP, encoding='utf-8'))}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(argv, odpoved) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify({ mista: MISTA, sklad: SKLAD, tab: TAB, eshop: ESHOP, argv, odpoved: odpoved || '' }));
  return new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000 },
    (err, so, se) => {
      const out = String(so) + String(se);
      const i = out.lastIndexOf('###');
      let j = null; try { j = i >= 0 ? JSON.parse(out.slice(i + 3).split('\n')[0]) : null; } catch (e) {}
      res({ kod: err ? err.code : 0, out, j });
    }));
}

(async () => {
  sekce('1) Tabulka × sklad');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j, r.out);
  const v1 = r.j ? r.j.vysledek : {};
  ok('Prodej Shopify a prázdné řádky se nepočítají', v1.radku === 6, v1.radku);
  const sm = (v1.smazat || []).map(x => x.nazev + '|' + x.duvod.split(' (')[0]).sort();
  ok('Smazat: duplicitní řádek, prodaný kus a co ve skladu není', JSON.stringify(sm) === JSON.stringify([
    'Dunk Low Panda|Prodáno ve SKLADu', 'Neznámé Boty|Ve SKLADu skladem není', 'Nike Air Foamposite One Galaxy (2025)|Duplicitní řádek']), JSON.stringify(sm));
  const pr = (v1.pridat || []).map(x => x.nazev).sort();
  ok('Přidat: jen Mind — Pokémon, poškozené a interní White Cement se nehlásí', JSON.stringify(pr) === '["Nike Mind 001 Slide Triple Black"]', JSON.stringify(pr));
  const f = (v1.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: Galaxy 42.5 a triko zaškrtnout, Mind bez řádku odškrtnout (a jde do Přidat)', f === 'g2+,m-,t+', f);

  sekce('2) E-shop');
  const pl = (v1.platby || []);
  const g = pl.find(x => x.velikost === '42' && /Galaxy/.test(x.nazev)) || {};
  ok('„42,5" z tabulky = „42.5" na e-shopu, SMALL = S', pl.filter(x => x.eshop === 'A').length === 3, JSON.stringify(pl.map(x => x.nazev + x.eshop)));
  ok('jediný na e-shopu: Galaxy (43 je vyprodaná), triko ne (M má někdo jiný)', g.jediny === true
    && !(pl.find(x => /Corteiz/.test(x.nazev)) || {}).jediny, JSON.stringify(pl));
  ok('cena e-shop ≠ tabulka: jen Galaxy 42,5', (v1.cena_jinak || []).length === 1 && v1.cena_jinak[0].ecena === 5900, JSON.stringify(v1.cena_jinak));

  sekce('3) Odeslání');
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[1].jmeno === 'pozadavek_report_section' && z[2].obsah.kontrola, z.map(x => x.jmeno).join());
  const k = z[2] ? z[2].obsah.kontrola : {};
  ok('kontrola: smazat jen prodaný kus, neznámý řádek jako Není ve SKLADu, web = tabulka',
    JSON.stringify(k.smazat) === '["d"]' && k.neniVeSkladu.length === 1 && /docs\.google\.com/.test(k.web), JSON.stringify(k));
  ok('poznámka s payouty', /Jediný na e-shopu u 2 z 3, payout celkem 11 025 Kč/.test(k.poznamka || ''), k.poznamka);
  const rep = z[1] ? z[1].obsah : { sekce: [] };
  const payo = rep.sekce.find(x => x.nazev === 'Payouty') || { radky: [] };
  ok('report: Payouty s cenou, payoutem a stavem e-shopu', payo.radky.length === 3
    && payo.radky.some(x => x.udaje.some(u => u.hodnota === '4 425 Kč')) && payo.hromadne === true, JSON.stringify(payo));

  sekce('4) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'section_kontrola.py'), 'utf8');
  ok('tabulku ani e-shop nemění (žádný POST/PATCH)', !/PATCH|DELETE|"POST"|data=/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
