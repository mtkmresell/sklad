// Test: nastroje/thebeast/thebeast_kontrola.py — kontrola TheBeast na PC.
//
// Pravidla jsou ze skillu „thebeast-kontrola" (zůstává jako záloha):
// párování SKU / název + velikost (air jordan = jordan, 1/3 = .33, OS),
// Smazat = nabídka visí a kus není skladem, Přidat jen sneakers +
// oblečení, mimo katalog do „Nejde nalistovat", NOCTA tričko do Opravit,
// payout = cena × 0,77 − 50, fajfky obousměrně a pojistka: víc než 10
// odškrtnutí → fajfky se nepošlou (nejspíš se nenačetly nabídky).
// Web se nestahuje — GraphQL odpovědi se podstrčí, cloud taky.

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

const NASTROJE = path.resolve(__dirname, '..', 'nastroje', 'thebeast');
const MISTA = { platforms: ['StockX'], eshopy: ['TheBeast'], local: [] };
const SKLAD = [
  { id: 'a', name: 'Air Jordan 4 Black Cat', sku: 'CU1110-010', size: '44', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'b', name: 'adidas Samba OG', sku: 'B75806', size: '42 2/3', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['TheBeast'] },
  { id: 'c', name: 'Supreme Box Logo Cap', size: 'OS', category: 'obleceni', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'd', name: 'Nike Dunk Low Panda', sku: 'DD1391-100', size: '43', category: 'sneakers', saleState: 'stock', location: 'Na cestě', platforms: ['TheBeast'] },
  { id: 'e', name: 'Labubu Big Into Energy', size: 'OS', category: 'alternate', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'f', name: 'Neznámá bota', sku: 'XX-1', size: '41', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'g', name: 'Poškozená', sku: 'CU1110-010', size: '45', category: 'sneakers', saleState: 'stock', location: 'Doma', condition: 'poskozene', platforms: ['TheBeast'] },
  { id: 's1', name: 'Yeezy Slide Onyx', sku: 'HQ6448', size: '42', category: 'sneakers', saleState: 'paid', soldWhere: 'Vinted', saleDate: '2026-10-01', payoutDate: '2026-10-05' },
  { id: 's2', name: 'Yeezy Slide Onyx', sku: 'HQ6448', size: '42', category: 'sneakers', saleState: 'waiting', soldWhere: 'StockX', saleDate: '2026-11-01' },
  { id: 'n', name: 'Nike x NOCTA CS T-shirt Dark Grey', size: 'M', category: 'obleceni', saleState: 'paid', soldWhere: 'Section', saleDate: '2026-09-01' },
];
const nab = (id, title, sku, size, price, min) => ({ id, price, quantity: 1,
  productSize: { statsMinPrice: min, product: { id: 'p' + id, title, sku, imageUrl: 'https://img.thebeast.cz/' + id + '.jpg' }, size: { title: size } } });
const NABIDKY = [
  nab(1, 'Jordan 4 Black Cat', 'CU1110-010', 'EU 44', 10000, 9000),     // sedí podle SKU, dražší o 1000
  nab(2, 'adidas Samba OG', '', '42 2/3', 3000, 3000),                 // podle názvu, zlomek
  nab(3, 'Yeezy Slide Onyx', 'HQ6448', '42', 2500, 2500),              // prodaný → Smazat
  nab(4, 'Nike x NOCTA CS T-shirt Dark Grey', '', 'M', 1500, 1500),     // vratka → Opravit
  nab(5, 'Neexistující', 'ZZ-9', '40', 1000, 1000),                    // ve skladu není
];
const KATALOG = [{ sku: 'CU1110-010', title: 'Jordan 4' }, { sku: 'DD1391-100', title: 'Dunk' }, { sku: '', title: 'Supreme Box Logo Cap' }];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thebeast-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import thebeast_kontrola as R
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
R.VYSTUP = sys.argv[3] + '/vysledek.json'
zapisy, dotazy, ulozeno = [], [], []
R.S.prihlas = lambda *a: 'token'
R.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
R.S.prihlaseni_webu = lambda misto, zeptat=True: ('gabro@x.cz', 'tajne', True)
R.S.uloz_prihlaseni_webu = lambda misto, e, h: ulozeno.append(misto)
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
R.S._zapis_dokument = zapis
R.verejny_token = lambda: 'verejny'
def post(url, dotaz, promenne=None, token=None):
    dotazy.append({'url': url, 'dotaz': dotaz, 'token': token})
    if 'signIn' in dotaz:
        ok = promenne['password'] == 'tajne'
        return {'result': {'ok': ok, 'result': {'token': 'relace'} if ok else None, 'error': None if ok else {'code': 'INVALID_PASSWORD'}}}
    if 'me {' in dotaz: return {'me': {'person': {'id': 'osoba-1'}}}
    if 'listMerchant' in dotaz: return {'listMerchant': [{'id': 'm-1', 'name': 'MTKM'}]}
    if 'listOffer' in dotaz: return {'listOffer': vstup['nabidky']}
    if 'listProduct' in dotaz: return {'listProduct': vstup['katalog']}
    raise AssertionError(dotaz)
R._post = post
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
R.main(vstup['argv'])
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': json.load(open(R.VYSTUP, encoding='utf-8')), 'dotazy': dotazy, 'ulozeno': ulozeno}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(argv, odpoved, sklad, nabidky) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify({ mista: MISTA, sklad: sklad || SKLAD, nabidky: nabidky || NABIDKY, katalog: KATALOG, argv, odpoved: odpoved || '' }));
  return new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000 },
    (err, so, se) => {
      const out = String(so) + String(se);
      const i = out.lastIndexOf('###');
      let j = null; try { j = i >= 0 ? JSON.parse(out.slice(i + 3).split('\n')[0]) : null; } catch (e) {}
      res({ kod: err ? err.code : 0, out, j });
    }));
}
const naz = (a) => (a || []).map(x => x.nazev + '|' + x.velikost).sort().join(' ; ');

(async () => {
  sekce('1) Přihlášení a načtení');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j, r.out);
  const v = r.j ? r.j.vysledek : {};
  const d = r.j ? r.j.dotazy : [];
  ok('přihlášení veřejným tokenem stránky, data tokenem relace', d[0] && /signIn/.test(d[0].dotaz) && d[0].token === 'verejny'
    && d.slice(1).every(x => x.token === 'relace'), JSON.stringify(d.map(x => x.token)));
  ok('id osoby i prodejce jdou do dotazu v uvozovkách', d.some(x => /personId: \{eq: "osoba-1"\}/.test(x.dotaz))
    && d.some(x => /merchant: \{id: \{eq: "m-1"\}\}/.test(x.dotaz)));
  ok('povedené přihlášení se uloží do Správce pověření', JSON.stringify(r.j && r.j.ulozeno) === '["TheBeast"]');
  ok('náhled nic nezapíše', r.j && r.j.zapisy.length === 0);

  sekce('2) Pravidla ze skillu');
  ok('Smazat: prodaný Yeezy (Čeká má přednost) a neexistující', naz(v.smazat) === 'Neexistující|40 ; Yeezy Slide Onyx|42', naz(v.smazat));
  const yz = (v.smazat || []).find(x => /Yeezy/.test(x.nazev)) || {};
  ok('u Yeezy id nejčerstvějšího prodeje a důvod Čeká', JSON.stringify(yz.ids) === '["s2"]' && /Čeká/.test(yz.duvod), JSON.stringify(yz));
  ok('Opravit: NOCTA tričko (vratka vedená jako prodaná)', naz(v.opravit) === 'Nike x NOCTA CS T-shirt Dark Grey|M', naz(v.opravit));
  ok('Přidat: čepice (v katalogu podle názvu) a Dunk na cestě; Labubu ani poškozený ne', naz(v.pridat) === 'Nike Dunk Low Panda|43 ; Supreme Box Logo Cap|OS', naz(v.pridat));
  ok('Dunk má štítek na cestě', ((v.pridat || []).find(x => /Dunk/.test(x.nazev)) || {}).duvod === 'na cestě');
  ok('Nejde nalistovat: bota mimo katalog', naz(v.nejde) === 'Neznámá bota|41', naz(v.nejde));
  const j4 = (v.platby || []).find(x => /Black Cat/.test(x.nazev)) || {};
  ok('payout 10 000 × 0,77 − 50 = 7 650, u nejlevnějšího 6 880', j4.payout === 7650 && j4.konkurent === 6880, JSON.stringify(j4));
  const f = (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: Black Cat zaškrtnout, Dunk (nevisí) a poškozený odškrtnout, Samba nechat', f === 'a+,d-,g-', f);

  sekce('3) Pojistka fajfek');
  const mnoho = SKLAD.concat(Array.from({ length: 11 }, (_, i) => ({ id: 'x' + i, name: 'Kus ' + i, sku: 'K' + i, size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['TheBeast'] })));
  r = await spust(['--nahled'], '', mnoho);
  ok('víc než 10 odškrtnutí → fajfky se zadrží', r.j && r.j.vysledek.zmeny.length === 0 && r.j.vysledek.zmeny_zadrzene.length > 10, r.out.slice(-400));

  sekce('4) Odeslání');
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[0].obsah.zmeny && z[1].jmeno === 'pozadavek_report_thebeast'
    && z[2].obsah.kontrola && z[2].obsah.kontrola.misto === 'TheBeast', z.map(x => x.jmeno).join() + r.out.slice(-300));
  const k = z[2] ? z[2].obsah.kontrola : {};
  ok('kontrola: smazat prodaný, chybí 2, nejde 1, není ve skladu 1, opravit 1, web', JSON.stringify(k.smazat) === '["s2"]'
    && (k.chybi || []).length === 2 && (k.nejde || []).length === 1 && (k.neniVeSkladu || []).length === 1
    && (k.opravit || []).length === 1 && k.web === 'https://sell.thebeast.cz/' && k.inzeratu === 5, JSON.stringify(k));
  const rep = z[1] ? z[1].obsah : { sekce: [] };
  ok('report: obrázky z TheBeast a stejný okamžik jako kontrola', rep.datum === k.datum
    && /img\.thebeast\.cz\/3\.jpg/.test(JSON.stringify(rep.sekce)), JSON.stringify(rep.sekce[1]));

  sekce('5) Špatné heslo');
  fs.writeFileSync(path.join(tmp, 'ridic2.py'), RIDIC.replace("('gabro@x.cz', 'tajne', True)", "('gabro@x.cz', 'spatne', False)")
    .replace("R.main(vstup['argv'])", "zapomenuto = []\nR.S.zapomen_prihlaseni_webu = lambda m: zapomenuto.append(m)\ntry:\n    R.main(vstup['argv'])\nexcept RuntimeError as e:\n    print('###' + json.dumps({'chyba': str(e), 'zapomenuto': zapomenuto}, ensure_ascii=False)); sys.exit(0)"));
  r = await new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic2.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp } }, (err, so) => { const s = String(so); res(JSON.parse(s.slice(s.lastIndexOf('###') + 3))); }));
  ok('uložené špatné heslo se zapomene a řekne se, ať se spustí znovu', /Špatné heslo/.test(r.chyba) && /Spusť znovu/.test(r.chyba)
    && r.zapomenuto.length >= 1 && r.zapomenuto.every(m => m === 'TheBeast'), JSON.stringify(r));

  /* Majitel 13. 11. 2026: překlep v hesle znamenal Enter a celý program
     znovu. Teď se při špatném hesle zeptá znovu (S.prihlas_opakovane). */
  fs.writeFileSync(path.join(tmp, 'ridic3.py'), RIDIC.replace(
    "R.S.prihlaseni_webu = lambda misto, zeptat=True: ('gabro@x.cz', 'tajne', True)",
    "hesla = ['spatne', 'tajne']\nR.S.prihlaseni_webu = lambda misto, zeptat=True: ('gabro@x.cz', hesla.pop(0), True)"));
  r = await new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic3.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp } }, (err, so) => { const s = String(so); res({ out: s, j: s.indexOf('###') < 0 ? null : JSON.parse(s.slice(s.lastIndexOf('###') + 3)) }); }));
  ok('překlep v hesle: zeptá se znovu, s druhým heslem projde a uloží ho', r.j && JSON.stringify(r.j.ulozeno) === '["TheBeast"]'
    && /Zkus to znovu/.test(r.out), r.out.slice(-400));

  sekce('6) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'thebeast_kontrola.py'), 'utf8');
  ok('do cloudu jen přes sklad_firestore (žádný vlastní PATCH)', !/PATCH|DELETE/.test(zdroj));
  ok('na TheBeast jen čte (žádná mutace kromě přihlášení)', (zdroj.match(/mutation/g) || []).length === 1 && /mutation UserLogin/.test(zdroj));
  ok('heslo se nikam nevypisuje ani neukládá do souboru', !/print\([^)]*heslo/.test(zdroj) && !/json\.dump\([^)]*heslo/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
