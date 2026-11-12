// Test: nastroje/stuffsell/stuffsell_kontrola.py — kontrola Stuffsellu (ConsignR) na PC.
//
// Stuffsell je stejná platforma jako Tuzex (test-tuzex.js), pravidla jsou
// ze skillu „stuffsell-kontrola" (zůstává jako záloha): ceny v Kč, payout
// = cena × 0,775 − 30 Kč, doporučená cena končí 90 pod nejnižší dostupnou
// na stuffsell.cz; SKU „A / B"; čepice S = S/M; Labubu OS = prázdná
// velikost; alternate jen pro párování; kus u jiného komisního prodejce
// (Sellect, Section…) se nehlásí nikam; u Přidat info z e-shopu.

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

const NASTROJE = path.resolve(__dirname, '..', 'nastroje', 'stuffsell');
const MISTA = { platforms: ['StockX'], eshopy: ['Stuffsell'], local: [] };
const SKLAD = [
  { id: 'a', name: 'adidas Samba OG', sku: 'B75806', size: '39 1/3', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'u', name: 'UGG Tasman Chestnut', sku: '5950-CHE', size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Stuffsell'] },
  { id: 'c', name: 'Supreme Box Logo Cap', size: 'S/M', category: 'obleceni', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'l', name: 'Labubu Big Into Energy', size: '', category: 'alternate', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'v', name: 'Corteiz V.A.A. Tee White', size: 'S', category: 'obleceni', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'j', name: 'Jordan 1 Chicago', sku: 'DZ5485-612', size: '44', category: 'sneakers', saleState: 'stock', location: 'Na cestě', platforms: ['Stuffsell'] },
  { id: 'x', name: 'Jordan 4 Bred', sku: 'FV5029-006', size: '43', category: 'sneakers', saleState: 'stock', location: 'Sellect', platforms: ['Stuffsell'] },
  { id: 'n', name: 'New Balance 9060', sku: 'U9060ZGB', size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'q', name: 'Labubu Zimomriavky', size: '', category: 'alternate', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 's1', name: 'Yeezy Slide Onyx', sku: 'HQ6448', size: '42', category: 'sneakers', saleState: 'paid', soldWhere: 'Vinted', saleDate: '2026-10-20' },
];
const it = (id, status, title, sku, size, price) => ({ id, status, price: String(price), title,
  product: { title, sku, images: ['https://cdn.consignr.app/' + id + '.jpg'] }, optionNames: ['Size'], optionValues: [size] });
const INVENTAR = [
  it('t1', 'ACTIVE', 'adidas Samba OG', 'B75806', '39.5', 3490),
  it('t2', 'ACTIVE', 'UGG Tasman', '5950-CHE / 5950-CHES', '42', 3990),
  it('t3', 'ACTIVE', 'Supreme Box Logo Cap', 'F77FB2FF', 'S', 1490),
  it('t4', 'ACTIVE', 'Labubu Big Into Energy', 'AB12CD34', 'OS', 1290),
  it('t5', 'ACTIVE', 'Corteiz x V.A.A. Virgil Abloh Tee White', 'C0RT3IZ1', 'S', 1990),
  it('t6', 'ACTIVE', 'Yeezy Slide Onyx', 'HQ6448', '42', 2490),
  it('t7', 'SOLD', 'Jordan 1 Chicago', 'DZ5485-612', '44', 6000),
];
// e-shop: Samba 39.5 levnější (3 290 < 3 490), nedostupná levnější varianta UGG se nepočítá; Jordan 1 v jiné velikosti
const ESHOP = [{ products: [{ variants: [{ sku: 'B75806', option1: '39.5', price: '3290.00', available: true },
  { sku: '5950-CHE', option1: '42', price: '2990.00', available: false }, { sku: '5950-CHE', option1: '42', price: '3990.00', available: true },
  { sku: 'DZ5485-612', option1: '42', price: '5990.00', available: true }] }] }, { products: [] }];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stuffsell-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import stuffsell_kontrola as R
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
      let jj = null; try { jj = i >= 0 ? JSON.parse(out.slice(i + 3)) : null; } catch (e) {}
      res({ kod: err ? err.code : 0, out, j: jj });
    }));
}
const naz = (a) => (a || []).map(x => x.nazev + '|' + x.velikost).sort().join(' ; ');

(async () => {
  sekce('1) Načtení');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j, r.out);
  const v = r.j ? r.j.vysledek : {};
  const inv = r.j ? r.j.volano.find(x => /inventory/.test(x.url)) : null;
  ok('6 aktivních ze 7', v.celkem === 7 && v.aktivnich === 6, JSON.stringify([v.celkem, v.aktivnich]));
  ok('náhled nic nezapíše', r.j && r.j.zapisy.length === 0);

  sekce('2) Pravidla ze skillu');
  const pl = (re) => (v.platby || []).find(x => re.test(x.nazev)) || {};
  ok('spárováno: Samba 39.5, UGG (SKU A / B), čepice S = S/M, Labubu OS = prázdná, Corteiz alias',
    ['Samba', 'UGG', 'Cap', 'Labubu', 'Corteiz'].every(n => pl(new RegExp(n)).ids), naz(v.platby));
  ok('Smazat: prodaný Yeezy', naz(v.smazat) === 'Yeezy Slide Onyx|42' && JSON.stringify(v.smazat[0].ids) === '["s1"]', naz(v.smazat));
  const sa = pl(/Samba/);
  ok('Samba: e-shop 3 290 → nastav 3 190 Kč', sa.eshop === 3290 && sa.doporucena === 3190, JSON.stringify(sa));
  ok('payout 3 490 × 0,775 − 30 = 2 675 Kč', sa.payout === 2675, sa.payout);
  ok('UGG: nedostupná levnější varianta se nepočítá', pl(/UGG/).eshop === 3990 && pl(/UGG/).doporucena == null, JSON.stringify(pl(/UGG/)));
  ok('Přidat: Jordan 1 (na cestě, jiná velikost na e-shopu) a NB (není na e-shopu); Jordan 4 u Sellectu a Labubu ne',
    naz(v.pridat) === 'Jordan 1 Chicago|44 ; New Balance 9060|42', naz(v.pridat));
  const p = (re) => ((v.pridat || []).find(x => re.test(x.nazev)) || {}).duvod || '';
  ok('info z e-shopu u Přidat', /na cestě/.test(p(/Jordan 1/)) && /velikost není na e-shopu \(jiné velikosti od 5 990 Kč\)/.test(p(/Jordan 1/))
    && /není na e-shopu \(nový produkt/.test(p(/New Balance/)), p(/Jordan 1/) + ' | ' + p(/New Balance/));
  const f = (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: Samba, čepice, Labubu, Corteiz zaškrtnout, Jordan 1 odškrtnout; kus u Sellectu a UGG nechat', f === 'a+,c+,j-,l+,v+', f);

  sekce('3) Odeslání');
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[1].jmeno === 'pozadavek_report_stuffsell' && z[2].obsah.kontrola, z.map(x => x.jmeno).join() + r.out.slice(-300));
  const k = z[2] ? z[2].obsah.kontrola : {};
  ok('kontrola: smazat Yeezy, chybí 2, web', JSON.stringify(k.smazat) === '["s1"]' && (k.chybi || []).sort().join() === 'j,n'
    && k.web === 'https://4d7f5a.consignr.store/seller/inventory', JSON.stringify(k));
  ok('report v Kč', /3 190 Kč/.test(JSON.stringify(z[1] ? z[1].obsah : '')) && !/€/.test(JSON.stringify(z[1] ? z[1].obsah : '')));

  sekce('4) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'stuffsell_kontrola.py'), 'utf8');
  ok('do cloudu jen přes sklad_firestore', !/"PATCH"|"DELETE"/.test(zdroj));
  ok('POST jen na přihlášení, hlavička obchodu Stuffsell', (zdroj.match(/_json\([^)]*,\s*\{/g) || []).length === 1 && /HOST = "4d7f5a\.consignr\.store"/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
