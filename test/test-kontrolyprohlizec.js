// Test: kontroly přes prohlížeč kontrol (nastroje/prohlizec.py) a WTB —
// Tnsky, Sneakerstore, Hypeboost, KLEKT, Released, Facebook a WTB Market.
//
// Weby jdou přihlásit jen rukou (Facebook, Cloudflare u Hypeboostu…),
// takže skripty otevřou skutečný Chrome s vlastním profilem a data čtou
// JavaScriptem ze stránky (stejným jako skilly). Tady se prohlížeč
// nahradí podvrhem: každý JS dostane odpověď ve tvaru, jaký vrací stránka,
// a kontroluje se, co z toho skript vyvodí a co pošle do SKLADu.
// Pravidla ze skillů: jeden kus na model + velikost, vyřazené kusy,
// důvody ke smazání, katalog, payouty, prodloužení vždy, bez ptaní.

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

const NASTROJE = path.resolve(__dirname, '..', 'nastroje');
const MISTA = { platforms: ['StockX'], eshopy: ['Tnsky', 'Sneakerstore', 'Hypeboost', 'Klekt', 'Released'], local: ['Facebook'] };
const VSE = ['Tnsky', 'Sneakerstore', 'Hypeboost', 'Klekt', 'Released', 'Facebook'];
const SKLAD = [
  { id: 'a', name: 'Jordan 4 Black Cat', sku: 'CU1110-010', size: '44', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'd', name: 'Nike Dunk Low Panda', sku: 'DD1391-100', size: '42', category: 'sneakers', saleState: 'stock', location: 'Na cestě', platforms: VSE },
  { id: 'c', name: 'Corteiz Alcatraz Hoodie', sku: '', size: 'M', category: 'obleceni', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'v', name: 'Vrácené boty', sku: 'VR-1', size: '41', category: 'sneakers', saleState: 'stock', location: 'Vráceno', platforms: VSE },
  { id: 'p', name: 'Pokémon Prismatic Evolutions Box', sku: '', size: '', category: 'pokemon', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 's1', name: 'Yeezy Slide Onyx', sku: 'HQ6448', size: '42', category: 'sneakers', saleState: 'paid', soldWhere: 'Vinted', saleDate: '2026-10-01', payoutDate: '2026-10-03' },
];
const ODPOVEDI = {
  tnsky: { 'Market Low': { radky: [['Jordan 4 Black Cat', 'CU1110-010', '44', '9 990', '9490', 'https://img/aj4.jpg'], ['Yeezy Slide Onyx', 'HQ6448', '42', '2000', '', '']], celkem: 2 } },
  sneakerstore: {
    'Turbo-Frame': { p1: { '44': 200, '45': 210 }, p2: { '43': 120 } },
    'inventories_variants': { live: [{ id: '11', pn: 'Jordan 4 Black Cat', size: '44', sku: 'CU1110-010', st: 'Active', price: 220 },
      { id: '12', pn: 'Yeezy Slide Onyx', size: '42', sku: 'HQ6448', st: 'Accepted', price: 100 }],
      cat: [{ id: 'p1', title: 'Jordan 4', skus: ['CU1110010'], img: '' }, { id: 'p2', title: 'Dunk', skus: ['DD1391100'], img: '' }] },
  },
  hypeboost: {
    'almost-expired': { found: 3, ok: 3, fail: 0 },
    'grid-row': { stran: 1, bad: 0, radky: [['Jordan 4 Black Cat', '44', 200, 190, ''], ['Yeezy Slide Onyx', '42', 100, 100, ''], ['Nike Mind 001', '40', 50, 50, '']] },
  },
  klekt: {
    'edit.data': { ok: 2, fail: [] },
    'catalog-bare': { 'CU1110 010': [{ id: 'L1', name: 'Jordan 4 Black Cat', price: 250, size: ['US10', 'EU44'], fs: 'US 10', type: 'brand_new' },
      { id: 'X1', name: 'Jordan 4 Black Cat', price: 240, size: ['US10', 'EU44'], fs: 'US 10', type: 'brand_new' }],
      'HQ6448': [{ id: 'L2', name: 'Yeezy Slide Onyx', price: 100, size: ['US9', 'EU42'], fs: 'US 9', type: 'brand_new' }],
      'DD1391-100': [{ id: 'X2', name: 'Nike Dunk Low Panda', price: 110, size: ['US9', 'EU42'], fs: 'US 9', type: 'brand_new' }] },
    'k-v3': { 'CU1110-010': [{ name: 'Jordan 4 Black Cat', sku: 'CU1110-010' }],
      'DD1391-100': [{ name: 'Nike Dunk Low Panda', sku: 'DD1391-100' }, { name: 'Nike Dunk Low Retro Panda', sku: 'DD1391-100' }], 'VR-1': [] },
    'seller-listings': [{ id: 'L1', name: 'Jordan 4 Black Cat', sku: 'CU1110 010', size: 'US 10', price: 250 },
      { id: 'L2', name: 'Yeezy Slide Onyx', sku: 'HQ6448', size: 'US 9', price: 100 },
      { id: 'L3', name: 'adidas Samba OG WMNS Black Wonder White', sku: 'IE5836', size: 'US W9', price: 80 }],
  },
  released: {
    'Zpátky na výběr': { 'Nike Dunk Low Panda': ['40', '41'], 'Corteiz Alcatraz Hoodie': null },
    'p-paginator-page': ['Jordan 4 Black Cat|CU1110-010|44~5990~200~', 'Yeezy Slide Onyx|HQ6448|42~2000~0~'],
  },
  facebook: {
    'XMLHttpRequest': 1,
    'marketplace_listing_sets': { inzeraty: [
      { id: '1', nazev: 'Air Jordan 4 Black Cat vel. 44', stav: 'AVAILABLE', koncept: false, prodano: false },
      { id: '2', nazev: 'Yeezy Slide Onyx', stav: 'AVAILABLE', koncept: false, prodano: false },
      { id: '3', nazev: 'Jordan 4 Black Cat', stav: 'AVAILABLE', koncept: false, prodano: false },
      { id: '4', nazev: 'Coretiz Alcatraz Hoodie', stav: 'DRAFT', koncept: true, prodano: false }] },
  },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kontrolyprohl-'));
const RIDIC = `
import sys, json, types
misto, nastroje, vstup_soubor, tmp = sys.argv[1:5]
vstup = json.load(open(vstup_soubor, encoding='utf-8'))
sys.path.insert(0, nastroje + '/' + misto)
sys.path.insert(0, nastroje)
volano, args = [], []
class Stranka:
    def evaluate(self, js, arg=None):
        if not js.lstrip().startswith('async'):
            return True
        for klic, odp in vstup['odpovedi'].items():
            if klic in js:
                volano.append(klic); args.append([klic, arg])
                return odp
        raise AssertionError('neznámý JS: ' + js[:80])
    def goto(self, *a, **k): volano.append('goto ' + a[0])
    def wait_for_timeout(self, *a): pass
    def reload(self, *a, **k): pass
class Prohlizec:
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def otevri(self, url, *a): volano.append('otevri ' + url); return Stranka()
    def prihlaseni(self, *a, **k): return True
fake = types.ModuleType('prohlizec'); fake.Prohlizec = Prohlizec
def prihlas_sam(b, s, test, misto, url, login=None):
    volano.append('prihlas_sam ' + misto + ' ' + str(login)); return True
fake.prihlas_sam = prihlas_sam
fake.jdi = lambda s, url, *a: s.goto(url)
sys.modules['prohlizec'] = fake
R = __import__(misto + '_kontrola')
R.VYSTUP = tmp + '/vysledek.json'
if hasattr(R, 'KATALOG'): R.KATALOG = tmp + '/katalog.json'
if hasattr(R, 'SOUBOR'):
    R.SOUBOR = tmp + '/pinger.txt'; open(R.SOUBOR, 'w', encoding='utf-8').write(vstup.get('pinger', ''))
zapisy = []
R.S.prihlas = lambda *a: 'token'
R.S.nacti_pinger_wtb = lambda token, uid=None: (vstup.get('pinger_cloud', ''), '2026-11-13T09:30:00Z' if vstup.get('pinger_cloud') else None)
R.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
R.S._zapis_dokument = zapis
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
chyba = ''
try:
    R.main(vstup['argv'])
except Exception as e:
    import traceback; chyba = traceback.format_exc()
v = json.load(open(R.VYSTUP, encoding='utf-8')) if not chyba else {}
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': v, 'volano': volano, 'args': args, 'chyba': chyba}, ensure_ascii=False, default=list))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(misto, argv, odpoved, jine) {
  const soubor = path.join(tmp, misto + '.json');
  fs.writeFileSync(soubor, JSON.stringify(Object.assign({ mista: MISTA, sklad: SKLAD, odpovedi: ODPOVEDI[misto] || {}, argv, odpoved: odpoved || '' }, jine || {})));
  return new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic.py'), misto, NASTROJE, soubor, tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000 },
    (err, so, se) => {
      const out = String(so) + String(se);
      const i = out.lastIndexOf('###');
      let j = null; try { j = i >= 0 ? JSON.parse(out.slice(i + 3).split('\n')[0]) : null; } catch (e) {}
      res({ out, j, v: j ? j.vysledek : {} });
    }));
}
const naz = (a) => (a || []).map(x => x.nazev + '|' + x.velikost).sort().join(' ; ');
const fajfky = (v) => (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
const odeslano = (r, misto) => {
  const z = r.j ? r.j.zapisy : [];
  const k = (z.find(x => x.obsah.kontrola) || { obsah: {} }).obsah.kontrola;
  return { rep: z.find(x => /^pozadavek_report_/.test(x.jmeno)), k, z };
};

(async () => {
  sekce('1) Tnsky');
  let r = await spust('tnsky', ['--nahled']);
  ok('proběhne', r.j && !r.j.chyba, r.out.slice(-800));
  ok('Smazat: prodaný Yeezy s id prodeje', naz(r.v.smazat) === 'Yeezy Slide Onyx|42' && JSON.stringify(r.v.smazat[0].ids) === '["s1"]', JSON.stringify(r.v.smazat));
  ok('Přidat: Dunk a mikina (sneakers + oblečení), Pokémon ne', naz(r.v.pridat) === 'Corteiz Alcatraz Hoodie|M ; Nike Dunk Low Panda|42', naz(r.v.pridat));
  const t4 = (r.v.platby || []).find(x => /Black Cat/.test(x.nazev)) || {};
  ok('cena z placeholderu, Market Low 9 490 → nastav 9 390, payout 7 512', t4.cena === 9990 && t4.doporucena === 9390 && t4.payout_doporucena === 7512, JSON.stringify(t4));
  ok('fajfky: Black Cat +, Dunk −, vrácený −', fajfky(r.v) === 'a+,d-,v-', fajfky(r.v));
  r = await spust('tnsky', [], 'a');
  let o = odeslano(r);
  ok('report a kontrola Tnsky', o.rep && o.k && o.k.misto === 'Tnsky' && JSON.stringify(o.k.smazat) === '["s1"]', JSON.stringify(o.z.map(x => x.jmeno)) + r.out.slice(-400));
  const zdrojT = fs.readFileSync(path.join(NASTROJE, 'tnsky', 'tnsky_kontrola.py'), 'utf8');
  ok('Tnsky: žádné tokeny ani API stránky (jen tabulka)', !/fetch\(|localStorage|sessionStorage|cookie/i.test(zdrojT.split('JS_NABIDKY')[1].split('"""')[1]));

  sekce('2) Sneakerstore');
  r = await spust('sneakerstore', ['--nahled']);
  ok('proběhne', r.j && !r.j.chyba, r.out.slice(-800));
  const formy = (r.j.args.find(a => a[0] === 'Turbo-Frame') || [])[1] || [];
  ok('ceny velikostí jen u potřebných produktů', JSON.stringify(formy.slice().sort()) === '["p1","p2"]', JSON.stringify(formy));
  ok('Smazat: Yeezy (prodaný)', (r.v.smazat || []).length === 1 && /Prodáno/.test(r.v.smazat[0].duvod), JSON.stringify(r.v.smazat));
  const pr = (re) => (r.v.pridat || []).find(x => re.test(x.nazev)) || {};
  ok('Dunk 42: velikost není v nabídce (nejde), mikina mimo katalog', pr(/Dunk/).kat === 0 && /velikost není v nabídce/.test(pr(/Dunk/).duvod)
    && /na cestě/.test(pr(/Dunk/).duvod) && pr(/Corteiz/).kat === 0, JSON.stringify(r.v.pridat));
  const p4 = (r.v.platby || [])[0] || {};
  ok('Black Cat 220 €, nejnižší 200 €, payout 158,4 €', p4.cena === 220 && p4.nejnizsi === 200 && p4.payout === 158.4, JSON.stringify(p4));
  ok('fajfky: Black Cat +, Dunk −', fajfky(r.v) === 'a+,d-', fajfky(r.v));

  sekce('3) Hypeboost');
  r = await spust('hypeboost', ['--nahled']);
  ok('proběhne', r.j && !r.j.chyba, r.out.slice(-800));
  ok('Smazat: Yeezy; Ověřit: Mind (ve SKLADu nikdy)', naz(r.v.smazat) === 'Yeezy Slide Onyx|42' && naz(r.v.overit) === 'Nike Mind 001|40', naz(r.v.smazat) + ' / ' + naz(r.v.overit));
  ok('Přidat jen sneakers: Dunk (mikina ne)', naz(r.v.pridat) === 'Nike Dunk Low Panda|42', naz(r.v.pridat));
  ok('náhled neprodlužuje', !r.j.volano.includes('almost-expired'));
  r = await spust('hypeboost', [], 'a');
  o = odeslano(r);
  ok('prodlouží vždy a pak pošle (prodlouženo v reportu)', r.j.volano.includes('almost-expired') && o.rep && /Prodlouženo: 3 z 3/.test(JSON.stringify(o.rep.obsah.souhrn)), JSON.stringify(o.rep && o.rep.obsah.souhrn) + r.out.slice(-300));

  sekce('4) KLEKT');
  r = await spust('klekt', ['--nahled']);
  ok('proběhne', r.j && !r.j.chyba, r.out.slice(-800));
  const k4 = (r.v.platby || []).find(x => /Black Cat/.test(x.nazev)) || {};
  ok('US 10 → EU 44 z katalogu, SKU s mezerou = pomlčka, nejnižší 240 € (moje nabídka vynechaná)', k4.velikost === '44' && k4.nejnizsi === 240, JSON.stringify(k4));
  ok('payout 250 × 0,92 − 16,58 = 213,42 €', k4.payout === 213.42, k4.payout);
  ok('IE5836 se ignoruje', !JSON.stringify(r.v).includes('Samba') && r.v.nabidek === 2);
  ok('Smazat: Yeezy (prodaný)', naz(r.v.smazat) === 'Yeezy Slide Onyx|42', naz(r.v.smazat));
  const kd = (r.v.pridat || []).find(x => /Dunk/.test(x.nazev)) || {};
  ok('Dunk: nejnižší 110 € s payoutem a dva záznamy v katalogu', kd.kat === 1 && /nejnižší 110 €/.test(kd.duvod) && /2 záznamy/.test(kd.duvod), kd.duvod);
  r = await spust('klekt', [], 'a');
  const prodl = (r.j.args.find(a => a[0] === 'edit.data') || [])[1] || [];
  ok('prodlužuje všechny kromě IE5836', JSON.stringify(prodl) === '["L1","L2"]', JSON.stringify(prodl) + r.out.slice(-300));

  sekce('5) Released');
  r = await spust('released', ['--nahled']);
  ok('proběhne', r.j && !r.j.chyba, r.out.slice(-800));
  ok('Smazat: Yeezy s důvodem prodáno', naz(r.v.smazat) === 'Yeezy Slide Onyx|42' && /Prodáno 1\. 10\. 2026/.test(r.v.smazat[0].duvod), JSON.stringify(r.v.smazat));
  const rp = (re) => (r.v.pridat || []).find(x => re.test(x.nazev)) || {};
  ok('katalog: Dunk bez tvé velikosti (+), mikina není v katalogu', rp(/Dunk/).kat === 0 && rp(/Dunk/).plus && /bez tvé velikosti/.test(rp(/Dunk/).duvod)
    && rp(/Corteiz/).kat === 0 && /není v katalogu/.test(rp(/Corteiz/).duvod), JSON.stringify(r.v.pridat));
  ok('katalog si pamatuje (katalog.json)', fs.existsSync(path.join(tmp, 'katalog.json')) && 'Nike Dunk Low Panda' in JSON.parse(fs.readFileSync(path.join(tmp, 'katalog.json'))));
  const ra = (r.v.platby || []).find(x => /Black Cat/.test(x.nazev)) || {};
  ok('payout 5 990 × 0,77 − 50 = 4 562, konkurent 4 408', ra.payout === 4562 && ra.konkurent === 4408, JSON.stringify(ra));

  sekce('6) Facebook');
  r = await spust('facebook', ['--nahled']);
  ok('proběhne', r.j && !r.j.chyba, r.out.slice(-800));
  ok('Smazat: prodaný Yeezy a duplicitní Black Cat', (r.v.smazat || []).length === 2 && r.v.smazat.some(x => /Prodáno/.test(x.duvod)) && r.v.smazat.some(x => /Duplicitní/.test(x.duvod)), JSON.stringify(r.v.smazat));
  const fp = (re) => (r.v.pridat || []).find(x => re.test(x.nazev)) || {};
  ok('Přidat: mikina „jen koncept" (Coretiz = Corteiz), Pokémon v ostatních', fp(/Corteiz/).kat === 1 && /jen koncept/.test(fp(/Corteiz/).duvod) && fp(/Pokémon/).kat === 0, JSON.stringify(r.v.pridat));
  ok('fajfky: Black Cat +, Dunk −, vrácený −', fajfky(r.v) === 'a+,d-,v-', fajfky(r.v));

  sekce('7) WTB Market');
  const PINGER = '(0) Jordan 4 Black Cat 44, (1) Yeezy Slide 42,\n(2) Corteiz Alcatraz Hoodie M/L, (3) Jordan 4 Black Cat 45';
  r = await spust('wtb', ['--nahled'], '', { pinger: PINGER });
  ok('proběhne', r.j && !r.j.chyba, r.out.slice(-800));
  ok('Smazat s čísly z pingeru: #1 Yeezy (prodaný), #3 Black Cat 45 (není)', JSON.stringify((r.v.smazat || []).map(x => x.cislo)) === '[1,3]', JSON.stringify(r.v.smazat));
  ok('velikost M/L = M není chyba; Přidat jen Dunk', naz(r.v.pridat) === 'Nike Dunk Low Panda|42', naz(r.v.pridat));
  /* Majitel 13. 11. 2026: výsledek WTB chce v aplikaci, i když WTB Market
     nemá mezi místy prodeje. Kontrola i report jdou s `mimo`, fajfky ne. */
  r = await spust('wtb', [], 'a', { pinger: PINGER });
  o = odeslano(r);
  ok('WTB není v nastavení míst → report i kontrola s mimo, žádné fajfky', o.rep && o.k && o.k.mimo === true && o.rep.obsah.mimo === true
    && !o.z.some(x => x.obsah.zmeny && x.obsah.zmeny.length), JSON.stringify(o.z.map(x => x.jmeno)) + r.out.slice(-300));
  r = await spust('wtb', ['--nahled'], '', { pinger: '', pinger_cloud: PINGER });
  ok('pinger vložený ve SKLADu má přednost a jede z cloudu', r.j && !r.j.chyba && JSON.stringify((r.v.smazat || []).map(x => x.cislo)) === '[1,3]' && /ze SKLADu/.test(r.out), r.out.slice(-400));
  r = await spust('wtb', ['--nahled'], '', { pinger: '', bez_ptani: true });
  ok('bez pingeru skončí chybou s návodem, kam ho vložit', r.j && /Vložit pinger/.test(r.j.chyba), (r.j && r.j.chyba || '').slice(-300));
  r = await spust('wtb', [], 'a', { pinger: PINGER, mista: Object.assign({}, MISTA, { local: ['Facebook', 'WTB Market'] }) });
  o = odeslano(r);
  ok('s WTB Market v nastavení: report a kontrola, žádné fajfky', o.rep && o.k && o.k.misto === 'WTB Market' && !o.z.some(x => x.obsah.zmeny && x.obsah.zmeny.length)
    && /1, 3/.test(JSON.stringify(o.rep.obsah)), JSON.stringify(o.z.map(x => x.jmeno)) + r.out.slice(-300));

  sekce('8) Prohlížeč a zdroj');
  /* Majitel 12. 11. 2026: u některých kontrol to vypadalo, že se sekly.
     Každá kontrola, která čte web, ukazuje průběh (S.pracuji); sklad
     z cloudu a odeslání ho mají společně v sklad_firestore.py. */
  const slozky = fs.readdirSync(NASTROJE).filter(d => fs.existsSync(path.join(NASTROJE, d, d + '_kontrola.py')));
  const bez = slozky.filter(d => d !== 'wtb' && !/S\.pracuji\(/.test(fs.readFileSync(path.join(NASTROJE, d, d + '_kontrola.py'), 'utf8')));
  ok('každá kontrola s webem ukazuje průběh (' + slozky.length + ' kontrol)', slozky.length >= 15 && !bez.length, bez.join(', '));
  const sf = fs.readFileSync(path.join(NASTROJE, 'sklad_firestore.py'), 'utf8');
  ok('načtení skladu a odeslání ukazují průběh u všech', /with pracuji\("Načítám sklad z cloudu"\)/.test(sf) && /with pracuji\("Posílám výsledek do SKLADu"\)/.test(sf));
  for (const [m, misto, login] of [['tnsky', 'Tnsky', 'https://sell.tnsky.cz/login'], ['sneakerstore', 'Sneakerstore', 'https://sell.sneakerstore.cz/users/sign_in'],
    ['hypeboost', 'Hypeboost', 'https://hypeboost.com/en/login'], ['released', 'Released', 'https://sell-releasedcz-dev.web.app/login']]) {
    r = await spust(m, ['--nahled']);
    ok(m + ': přihlásí se sám heslem ze Správce pověření (jejich formulář)', r.j && r.j.volano.includes('prihlas_sam ' + misto + ' ' + login), JSON.stringify(r.j && r.j.volano.slice(0, 3)));
  }
  r = await spust('klekt', ['--nahled']);
  ok('KLEKT: přihlašovací kód chodí mailem → jen přihlášení v okně, heslo nechce', r.j && !r.j.volano.some(x => /prihlas_sam/.test(x)));
  r = await spust('facebook', ['--nahled']);
  ok('Facebook: jen ruční přihlášení (samostatné by mohlo účet zablokovat)', r.j && !r.j.volano.some(x => /prihlas_sam/.test(x)));
  for (const m of ['hypeboost', 'klekt']) {
    r = await spust(m, ['--nahled']);
    ok(m + ': náhled neprodlužuje ani nic nepošle', r.j && r.j.zapisy.length === 0 && !r.j.volano.includes('almost-expired') && !r.j.volano.includes('edit.data'));
  }
  const prohl = fs.readFileSync(path.join(NASTROJE, 'prohlizec.py'), 'utf8');
  ok('profil prohlížeče mimo Google Disk (LOCALAPPDATA)', /LOCALAPPDATA/.test(prohl) && /MTKM-kontroly/.test(prohl));
  ok('heslo jen přes Správce pověření (sklad_firestore), nikdy do souboru ani na výpis',
    /S\.prihlaseni_webu\(misto\)/.test(prohl) && /S\.uloz_prihlaseni_webu/.test(prohl) && !/print\([^)]*[,%(]\s*heslo\b/.test(prohl) && !/open\(/.test(prohl));
  for (const m of ['tnsky', 'sneakerstore', 'hypeboost', 'klekt', 'released', 'facebook', 'wtb']) {
    const z = fs.readFileSync(path.join(NASTROJE, m, m + '_kontrola.py'), 'utf8');
    ok(m + ': do cloudu jen přes sklad_firestore', !/"PATCH"|urllib\.request\.Request\(.*firestore/.test(z));
  }

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
