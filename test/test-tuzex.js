// Test: nastroje/tuzex/tuzex_kontrola.py — kontrola Tuzexu (ConsignR) na PC.
//
// Pravidla jsou ze skillu „tuzex-kontrola" (zůstává jako záloha): jen
// ACTIVE; tenisky SKU + velikost, oblečení podle názvu (podobný název
// jde do Ověřit ručně); adidas 39.5 = 39 1/3, Crocs 41 = 41-42; Přidat
// sneakers + oblečení + alternate; NOCTA tričko do Opravit; Nejsi
// nejlevnější proti tuzexstore.com s cenou končící 9 (359 → 349);
// payout = cena × 0,74 − 2 €. Kus čekající na schválení se znovu
// nepřidává. Síť se nestahuje — odpovědi API i e-shopu se podstrčí.

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

const NASTROJE = path.resolve(__dirname, '..', 'nastroje', 'tuzex');
const MISTA = { platforms: ['StockX'], eshopy: ['Tuzex'], local: [] };
const SKLAD = [
  { id: 'a', name: 'adidas Samba OG', sku: 'B75806', size: '39 1/3', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'c', name: 'Crocs Classic Clog Black', sku: '10001-001', size: '41-42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Tuzex'] },
  { id: 'h', name: 'Corteiz Alcatraz Hoodie Black', size: 'L', category: 'obleceni', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'k', name: 'Adventní kalendář 2026 Sephora', size: 'OS', category: 'alternate', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'j', name: 'Jordan 1 Chicago', sku: 'DZ5485-612', size: '44', category: 'sneakers', saleState: 'stock', location: 'Na cestě', platforms: ['Tuzex'] },
  { id: 'r', name: 'Čeká na schválení', sku: 'PP-1', size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'q', name: 'Pokémon box', size: '', category: 'pokemon', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 's1', name: 'Yeezy Slide Onyx', sku: 'HQ6448', size: '42', category: 'sneakers', saleState: 'paid', soldWhere: 'Tuzex', saleDate: '2026-10-20' },
  { id: 'n', name: 'Nike x NOCTA CS T-shirt Dark Grey', size: 'M', category: 'obleceni', saleState: 'paid', soldWhere: 'Section', saleDate: '2026-09-01' },
];
const it = (id, status, title, sku, size, price) => ({ id, status, price: String(price), payoutAmount: null, title,
  product: { title, sku, images: ['https://cdn.consignr.app/' + id + '.jpg'] }, optionNames: ['Size'], optionValues: [size] });
const INVENTAR = [
  it('t1', 'ACTIVE', 'adidas Samba OG', 'B75806', '39.5', 159),
  it('t2', 'ACTIVE', 'Crocs Classic Clog', '10001-001', '41', 69),
  it('t3', 'ACTIVE', 'Corteiz Alcatraz Hoodie Black', 'F77FB2FF', 'L', 199),
  it('t4', 'ACTIVE', 'Sephora Advent Calendar 2026 Adventný kalendár', 'FW26T25', 'OS', 89),
  it('t5', 'ACTIVE', 'Yeezy Slide Onyx', 'HQ6448', '42', 99),
  it('t6', 'ACTIVE', 'Nike x NOCTA CS T-shirt Dark Grey', 'NOC1', 'M', 79),
  it('t7', 'SOLD', 'Jordan 1 Chicago', 'DZ5485-612', '44', 400),
  it('t8', 'PENDING_REVIEW', 'Čeká na schválení', 'PP-1', '42', 100),
  it('t9', 'ACTIVE', 'Úplně cizí', 'ZZ-1', '40', 50),
];
// e-shop: Samba 39.5 levnější (149 < 159), Crocs dražší
const ESHOP = [{ products: [{ variants: [{ sku: 'B75806', option1: '39.5', price: '149.00' }, { sku: 'B75806', option1: '39.5', price: '155.00' },
  { sku: '10001-001', option1: '41', price: '79.00' }] }] }, { products: [] }];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuzex-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import tuzex_kontrola as R
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
R.VYSTUP = sys.argv[3] + '/vysledek.json'
zapisy, volano, ulozeno = [], [], []
R.S.prihlas = lambda *a: 'token'
R.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
R.S.prihlaseni_webu = lambda misto, zeptat=True: ('gabro@x.cz', 'tajne', True)
R.S.uloz_prihlaseni_webu = lambda misto, e, h: ulozeno.append(misto)
R.S.uloz_ladici = lambda *a: 'x'
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
R.S._zapis_dokument = zapis
def j(url, telo=None, token=None, hlavicky=None):
    volano.append({'url': url, 'token': token, 'telo': telo})
    if url.endswith('/auth/login'):
        return ({'user': {'id': 1}}, ['accessToken=tok123; Path=/; HttpOnly', 'refreshToken=r; Path=/'])
    if '/inventory?' in url:
        assert token == 'tok123'
        n = int(url.split('page=')[1])
        return (vstup['inventar'] if n == 1 else []), []
    if '/products.json' in url:
        n = int(url.split('page=')[1])
        return (vstup['eshop'][n - 1] if n <= len(vstup['eshop']) else {'products': []}), []
    raise AssertionError(url)
R._json = j
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
R.main(vstup['argv'])
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': json.load(open(R.VYSTUP, encoding='utf-8')), 'volano': volano, 'ulozeno': ulozeno}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(argv, odpoved) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify({ mista: MISTA, sklad: SKLAD, inventar: INVENTAR, eshop: ESHOP, argv, odpoved: odpoved || '' }));
  return new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000 },
    (err, so, se) => {
      const out = String(so) + String(se);
      const i = out.lastIndexOf('###');
      let jj = null; try { jj = i >= 0 ? JSON.parse(out.slice(i + 3).split('\n')[0]) : null; } catch (e) {}
      res({ kod: err ? err.code : 0, out, j: jj });
    }));
}
const naz = (a) => (a || []).map(x => x.nazev + '|' + x.velikost).sort().join(' ; ');

(async () => {
  sekce('1) Přihlášení a načtení');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j, r.out);
  const v = r.j ? r.j.vysledek : {};
  ok('token z cookie, Inventory po stránkách do prázdné', r.j && r.j.volano.filter(x => /inventory/.test(x.url)).length === 2, JSON.stringify(r.j && r.j.volano.map(x => x.url)));
  ok('9 kusů, aktivních 7', v.celkem === 9 && v.aktivnich === 7, JSON.stringify([v.celkem, v.aktivnich]));
  ok('náhled nic nezapíše', r.j && r.j.zapisy.length === 0);

  sekce('2) Pravidla ze skillu');
  ok('Smazat: prodaný Yeezy a cizí kus', naz(v.smazat) === 'Yeezy Slide Onyx|42 ; Úplně cizí|40', naz(v.smazat));
  ok('Opravit: NOCTA', naz(v.opravit) === 'Nike x NOCTA CS T-shirt Dark Grey|M', naz(v.opravit));
  ok('Samba 39.5 = 39 1/3, Crocs 41 = 41-42, mikina podle názvu', ['adidas Samba OG', 'Crocs Classic Clog', 'Corteiz Alcatraz Hoodie Black']
    .every(n => (v.platby || []).some(x => x.nazev === n)), naz(v.platby));
  ok('kalendář: podobný název → jen Ověřit ručně (nesmaže, nepřidá)', naz(v.overit) === 'Sephora Advent Calendar 2026 Adventný kalendár|OS', naz(v.overit));
  ok('Přidat: Jordan (prodaný na Tuzexu, doma další kus); čekající na schválení ani Pokémon ne', naz(v.pridat) === 'Jordan 1 Chicago|44', naz(v.pridat));
  const sa = (v.nejsi || [])[0] || {};
  ok('Nejsi nejlevnější: Samba 159 € vs. e-shop 149 € → nastav 139 €', (v.nejsi || []).length === 1 && sa.eshop === 149 && sa.doporucena === 139, JSON.stringify(v.nejsi));
  ok('payout 159 × 0,74 − 2 = 115,66 €', sa.payout === 115.66, sa.payout);
  const f = (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: Samba, mikina a čekající zaškrtnout, Jordan odškrtnout, Crocs i nejistý kalendář nechat', f === 'a+,h+,j-,r+', f);

  sekce('3) Odeslání');
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[1].jmeno === 'pozadavek_report_tuzex' && z[2].obsah.kontrola, z.map(x => x.jmeno).join() + r.out.slice(-300));
  const k = z[2] ? z[2].obsah.kontrola : {};
  ok('kontrola: smazat prodaný, chybí Jordan, není ve skladu, opravit, web', JSON.stringify(k.smazat) === '["s1"]' && JSON.stringify(k.chybi) === '["j"]'
    && (k.neniVeSkladu || []).length === 1 && (k.opravit || []).length === 1 && k.web === 'https://tuzex.consignr.store/seller/inventory', JSON.stringify(k));
  const rep = z[1] ? z[1].obsah : { sekce: [] };
  ok('report: první sekce Nejsi nejlevnější s „nastav 139 €"', rep.sekce[0] && rep.sekce[0].nazev === 'Nejsi nejlevnější'
    && /139 €/.test(JSON.stringify(rep.sekce[0])), JSON.stringify(rep.sekce[0]));
  ok('uložené přihlášení', JSON.stringify(r.j && r.j.ulozeno) === '["Tuzex"]');

  sekce('4) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'tuzex_kontrola.py'), 'utf8');
  ok('do cloudu jen přes sklad_firestore', !/"PATCH"|"DELETE"/.test(zdroj));
  ok('POST jen na přihlášení', (zdroj.match(/_json\([^)]*,\s*\{/g) || []).length === 1 && /auth\/login/.test(zdroj));
  ok('token se nikam neukládá', !/uloz_ladici\([^)]*token/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
