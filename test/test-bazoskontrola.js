// Test: nastroje/bazos_kontrola.py — Bazoš kontrola na PC, napojená na SKLAD.
//
// Dřív skript četl ručně obnovovaný sklad.json a výsledek předával
// Claudovi v chatu, který rozhodl Smazat / Není ve SKLADu a poslal
// fajfky a kontrolu přes konektor. Teď to dělá skript sám přes
// sklad_firestore.py (majitel, 11. 11. 2026). Bazoš se tu nestahuje:
// inzeráty se podstrčí, cloud taky a lístečky se dají skutečné aplikaci.
//
// Hlídá hlavně, co se stát nesmí: nejistá shoda nesmí skončit ve Smazat,
// fajfka modelu, kterému se možná jen nespároval inzerát, se neodškrtne,
// a bez souhlasu se nic neodešle.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { chromium } = require('playwright');

let selhalo = 0, proslo = 0;
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail === undefined ? '' : '\n  ' + detail)); }
}
function sekce(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length))); }

const NASTROJE = path.resolve(__dirname, '..', 'nastroje');
const MISTA = { platforms: ['StockX'], eshopy: [], local: ['Bazoš.cz', 'Bazoš.sk', 'Vinted'] };
const DEN = 86400000;
const datum = (dni) => new Date(Date.now() - dni * DEN).toISOString().slice(0, 10);
const SKLAD = [
  { id: 'a', name: 'Jordan 4 Black Cat', size: '44', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Bazoš.cz'], buyPrice: 5000, buyDate: datum(20), tags: [] },
  { id: 'a2', name: 'Jordan 4 Black Cat', size: '45', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [], buyPrice: 5000, buyDate: datum(20), tags: [] },
  { id: 'b', name: 'Mind 001 Slide Black', size: '46', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Bazoš.cz'], buyPrice: 2000, buyDate: datum(20), tags: [] },
  { id: 'c', name: 'Adidas Samba OG Cloud White', size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Bazoš.cz'], buyPrice: 2000, buyDate: datum(20), tags: [] },
  { id: 'v', name: 'Vrácené boty', size: '43', category: 'sneakers', saleState: 'stock', location: 'Vráceno', platforms: ['Bazoš.cz'], buyPrice: 1000, buyDate: datum(20), tags: [] },
  { id: 'w', name: 'Dunk Low Panda', size: '42', category: 'sneakers', saleState: 'waiting', waitState: 'sent', soldWhere: 'Vinted', sellPrice: 3000, sellDate: datum(5), platforms: [], buyPrice: 2000, buyDate: datum(40), tags: [] },
  { id: 'w0', name: 'Dunk Low Panda', size: '42', category: 'sneakers', saleState: 'paid', soldWhere: 'Vinted', sellPrice: 3000, payoutDate: datum(200), platforms: [], buyPrice: 2000, buyDate: datum(300), tags: [] },
];
// Inzeráty, jak by je načetl nacti_profil + nacti_velikosti
const INZ = {
  cz: [
    { id: '1', nazev: 'Air Jordan 4 Retro Black Cat', velikosti_text: '44, 46', url: 'https://obleceni.bazos.cz/inzerat/1/x.php' },
    { id: '2', nazev: 'Nike Dunk Low Panda', velikosti_text: '42', url: 'https://obleceni.bazos.cz/inzerat/2/x.php' },
    { id: '3', nazev: 'Supreme Box Logo Hoodie', velikosti_text: 'L', url: 'https://obleceni.bazos.cz/inzerat/3/x.php' },
    // Podobá se Sambě skladem, ale jistá shoda to není — patří do „ověřit ručně"
    { id: '4', nazev: 'Adidas Samba Black Gum Vintage Edition Rare', velikosti_text: '42', url: 'https://obleceni.bazos.cz/inzerat/4/x.php' },
  ],
  sk: [
    { id: '9', nazev: 'Jordan 4 Black Cat', velikosti_text: '44, 45', url: 'https://oblecenie.bazos.sk/inzerat/9/x.php' },
  ],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bazos-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import bazos_kontrola as B
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
B.VYSTUP = sys.argv[3] + '/vysledek_bazos.json'
B.DEBUG = sys.argv[3] + '/debug'
zapisy = []
B.S.prihlas = lambda *a: 'token'
B.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
B.S._zapis_listecek = lambda token, uid, obsah: zapisy.append(obsah) or 'pozadavek_t%d' % len(zapisy)
def profil(misto, kod):
    inz = [dict(i) for i in vstup['inz'][kod]]
    return inz, len(inz), 'https://www.bazos.%s/hodnoceni.php?idmail=1&idphone=2&jmeno=Gabriel+V.' % kod
def velikosti(inz):
    inz['velikosti'] = sorted(B.rozdel_velikosti(inz['velikosti_text']), key=B.klic_vel)
    inz['popis_nalezen'] = True
B.nacti_profil = profil
B.nacti_velikosti = velikosti
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
B.main(vstup['argv'])
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': json.load(open(B.VYSTUP, encoding='utf-8'))}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);

function spust(argv, odpoved) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify({ mista: MISTA, sklad: SKLAD, inz: INZ, argv, odpoved: odpoved || '' }));
  return new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000 },
    (err, so, se) => {
      const out = String(so) + String(se);
      const i = out.lastIndexOf('###');
      let j = null; try { j = i >= 0 ? JSON.parse(out.slice(i + 3)) : null; } catch (e) {}
      res({ kod: err ? err.code : 0, out, j });
    }));
}

(async () => {
  sekce('1) Vyhodnocení');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j, r.out);
  const v = r.j ? r.j.vysledek : { cz: {}, sk: {} };
  ok('náhled nic nezapíše', r.j && r.j.zapisy.length === 0, r.j && JSON.stringify(r.j.zapisy));
  ok('Smazat: prodaný model, nejčerstvější kus', JSON.stringify(v.cz.smazat) === '["w"]', JSON.stringify(v.cz.smazat));
  ok('Opravit: velikosti v inzerátu nesedí se skladem', v.cz.opravit && v.cz.opravit.length === 1
    && v.cz.opravit[0].nazev === 'Jordan 4 Black Cat' && v.cz.opravit[0].inzerat === '44, 46'
    && v.cz.opravit[0].sklad === '44, 45' && /inzerat\/1\//.test(v.cz.opravit[0].odkaz), JSON.stringify(v.cz.opravit));
  ok('Není ve SKLADu: Supreme', v.cz.neni_ve_skladu && v.cz.neni_ve_skladu.length === 1
    && v.cz.neni_ve_skladu[0].nazev === 'Supreme Box Logo Hoodie' && v.cz.neni_ve_skladu[0].velikost === 'L', JSON.stringify(v.cz.neni_ve_skladu));
  ok('nejistá Samba jde do „ověřit ručně", ne do Smazat ani Není ve SKLADu',
    (v.cz.k_overeni || []).some(o => /Samba/.test(o.nazev)) && !(v.cz.neni_ve_skladu || []).some(o => /Samba/.test(o.nazev)),
    JSON.stringify(v.cz.k_overeni));
  const fcz = (v.cz.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky CZ: Mind bez inzerátu odškrtnout, Sambu (možná jen nespárovanou) nechat', fcz === 'b-', fcz);
  ok('vrácený kus se nekontroluje', !JSON.stringify(v).includes('"v"'));
  const fsk = (v.sk.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky SK: obě velikosti z inzerátu zaškrtnout', fsk === 'a+,a2+', fsk);
  ok('výpis říká, co by se poslalo', /SMAZAT\s+Dunk Low Panda 42/.test(r.out) && /OVĚŘIT RUČNĚ\s+Adidas Samba Black Gum/.test(r.out)
    && /Jen náhled, nic se neposlalo/.test(r.out), r.out);

  sekce('2) Bez souhlasu se nic neodešle');
  r = await spust([], 'n');
  ok('odpověď „n": nic', r.j && r.j.zapisy.length === 0 && /Nic se neposlalo/.test(r.out), r.out);
  r = await spust([], '');
  ok('jen Enter: nic', r.j && r.j.zapisy.length === 0, r.out);

  sekce('3) Odeslání');
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('tři lístečky: fajfky, pak Bazoš.cz a Bazoš.sk', z.length === 3 && z[0].zmeny && z[1].kontrola && z[1].kontrola.misto === 'Bazoš.cz'
    && z[2].kontrola.misto === 'Bazoš.sk', JSON.stringify(z).slice(0, 400));
  const kcz = z[1] ? z[1].kontrola : {};
  ok('kontrola CZ: smazat, opravit, není ve skladu, počet a limit', JSON.stringify(kcz.smazat) === '["w"]'
    && kcz.opravit.length === 1 && kcz.neniVeSkladu.length === 1 && kcz.inzeratu === 4 && kcz.limit === 50
    && JSON.stringify(kcz.chybi) === '[]', JSON.stringify(kcz));
  ok('poznámka připomene ruční ověření', /K ověření ručně: 1/.test(kcz.poznamka || ''), kcz.poznamka);
  ok('web = profil prodejce', /^https:\/\/www\.bazos\.cz\/hodnoceni\.php/.test(kcz.web || ''), kcz.web);

  sekce('4) Aplikace lístečky převezme');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await ctx.addInitScript((m) => localStorage.setItem('sklad_plat_groups_v1', JSON.stringify(m)), MISTA);
  await ctx.addInitScript((s) => { if (!localStorage.getItem('sklad_v3')) localStorage.setItem('sklad_v3', JSON.stringify(s)); }, SKLAD);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _provedPozadavky === 'function' && Array.isArray(items) && items.length > 0, { timeout: 20000 });
  await page.waitForTimeout(400);
  const kdy = new Date().toISOString();
  const res = await page.evaluate((d) => {
    window._fbDb = {}; window._fbUser = { uid: 'majitel1' };
    window._fbFns = { doc: function () { return {}; }, deleteDoc: function () { return Promise.resolve(); } };
    _provedPozadavky({ forEach: function (cb) { d.forEach(function (x, i) { cb({ id: 'pozadavek_t' + i, data: function () { return x; } }); }); } });
    var p = function (id) { return (items.find(function (i) { return i.id === id; }).platforms || []).join('|'); };
    return { a: p('a'), a2: p('a2'), b: p('b'), c: p('c'), kontroly: JSON.parse(localStorage.getItem('sklad_kontroly_v1') || '{}') };
  }, z.map(x => Object.assign({ kdy }, x)));
  ok('fajfky se provedly', /Bazoš\.sk/.test(res.a) && /Bazoš\.sk/.test(res.a2) && !/Bazoš\.cz/.test(res.b) && /Bazoš\.cz/.test(res.c), JSON.stringify(res));
  const kb = res.kontroly['Bazoš.cz'];
  ok('kontrola Bazoš.cz je v okně Kontroly listingů', kb && JSON.stringify(kb.smazat) === '["w"]' && kb.opravit.length === 1
    && kb.neniVeSkladu.length === 1 && kb.inzeratu === 4, JSON.stringify(kb));
  ok('i Bazoš.sk', !!res.kontroly['Bazoš.sk'], JSON.stringify(Object.keys(res.kontroly)));
  ok('bez chyb na stránce', errs.length === 0, errs.join('\n'));
  await browser.close();

  sekce('5) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'bazos_kontrola.py'), 'utf8');
  ok('sklad.json se už nečte', !/sklad\.json/.test(zdroj.replace(/^.*#.*$/gm, '')) || !/open\(SKLAD/.test(zdroj));
  ok('zapisuje jen přes sklad_firestore (žádný vlastní PATCH)', !/PATCH|DELETE/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
