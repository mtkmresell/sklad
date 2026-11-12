// Test: nastroje/sneakersnow/sneakersnow_kontrola.py — kontrola SneakersNow na PC.
//
// Pravidla jsou ze skillu „sneakersnow-kontrola" (jeho kontrola.py,
// skill zůstává jako záloha): párování název + velikost (Jaccard ≥ 0,6,
// značky se ignorují, aliasy), „Čeká na schválení" = nalistováno, ale
// do payoutů ne; katalog shoda názvu ≥ 0,75; provize 20 %; doporučená
// cena končí 90 pod tržním minimem; víc než 10 odškrtnutí → fajfky se
// nepošlou. Portál (Supabase) se nevolá — odpovědi se podstrčí.

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

const NASTROJE = path.resolve(__dirname, '..', 'nastroje', 'sneakersnow');
const MISTA = { platforms: ['StockX'], eshopy: ['Sneakersnow'], local: [] };
const SKLAD = [
  { id: 'a', name: 'Air Jordan 4 Black Cat', sku: 'CU1110-010', size: '44', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'b', name: 'Nike Dunk Low Panda', sku: 'DD1391-100', size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Sneakersnow'] },
  { id: 'c', name: 'Corteiz Alcatraz Hoodie', size: 'M', category: 'obleceni', saleState: 'stock', location: 'Na cestě', platforms: [] },
  { id: 'd', name: 'Mizuno Wave Rider', sku: 'MZ1', size: '43', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'e', name: 'Adidas Samba OG White', sku: 'B75806', size: '42 2/3', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Sneakersnow'] },
  { id: 'v', name: 'Vrácené boty', size: '41', category: 'sneakers', saleState: 'stock', location: 'Vráceno', platforms: ['Sneakersnow'] },
  { id: 's1', name: 'Yeezy Slide Onyx', sku: 'HQ6448', size: '42', category: 'sneakers', saleState: 'paid', soldWhere: 'Vinted', saleDate: '2026-10-01' },
  { id: 's2', name: 'Air Max 1 Patta', sku: 'AM1', size: '43', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
];
const nab = (id, status, brand, model, size, cena) => ({ id, user_id: 'u1', status, brand, model, size, shop_price: cena, images: ['https://img.sn/' + id + '.jpg'] });
const NABIDKY = [
  nab('n1', 'approved', 'Jordan', 'Air Jordan 4 Retro Black Cat', '44', 9990),   // sedí, dražší než minimum 9490
  nab('n2', 'approved', 'Nike', 'Dunk Low Panda', '42', 2990),                   // sedí, nejlevnější
  nab('n3', 'approved', 'Yeezy', 'Slide Onyx', '42', 1990),                       // prodaný → Smazat
  nab('n4', 'pending', 'Adidas', 'Samba OG White', '42 2/3', 2490),               // čeká na schválení: nalistováno
  nab('n5', 'paid', 'Nike', 'Air Max 1 Patta', '43', 5990),                       // vyplaceno: ignorovat
  nab('n6', 'approved', 'Nike', 'Air Max 1 Patta', '44', 5990),                   // jiná velikost → špatná velikost
];
const KATALOG = [{ brand: 'Jordan', name: 'Air Jordan 4 Black Cat' }, { brand: 'Corteiz', name: 'Alcatraz Hoodie' },
  { brand: 'Nike', name: 'Air Max 1 Patta' }];
const MINIMA = { n1: 9490, n2: 2990, n3: 1990, n6: 5990 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sneakersnow-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import sneakersnow_kontrola as R
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
R.VYSTUP = sys.argv[3] + '/vysledek.json'
zapisy, volano, ulozeno = [], [], []
R.S.prihlas = lambda *a: 'token'
R.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
R.S.prihlaseni_webu = lambda misto, zeptat=True: ('gabro@x.cz', vstup.get('heslo', 'tajne'), True)
R.S.uloz_prihlaseni_webu = lambda misto, e, h: ulozeno.append(misto)
R.S.uloz_ladici = lambda *a: 'x'
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
R.S._zapis_dokument = zapis
R.nastaveni_portalu = lambda: ('https://x.supabase.co', 'klic')
class P(R.Portal):
    def _req(self, cesta, telo=None):
        volano.append(cesta)
        if cesta.startswith('/auth/'):
            if telo['password'] != 'tajne':
                import urllib.error; raise urllib.error.HTTPError(cesta, 400, 'bad', {}, None)
            return {'access_token': 't', 'user': {'id': 'u1'}}
        assert self.token == 't'
        if cesta.startswith('/rest/v1/submitted_products?select=*'): return vstup['nabidky']
        if cesta.startswith('/rest/v1/catalog_models'): return vstup['katalog']
        if cesta.startswith('/rest/v1/submitted_products?select=shop_price'):
            import urllib.parse
            q = dict(urllib.parse.parse_qsl(cesta.split('?', 1)[1]))
            n = next(x for x in vstup['nabidky'] if 'eq.' + x['model'] == q['model'] and 'eq.' + x['size'] == q['size'])
            return [{'shop_price': vstup['minima'][n['id']]}]
        raise AssertionError(cesta)
R.Portal = P
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
try:
    R.main(vstup['argv']); chyba = ''
except RuntimeError as e:
    chyba = str(e)
v = json.load(open(R.VYSTUP, encoding='utf-8')) if not chyba else {}
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': v, 'volano': volano, 'ulozeno': ulozeno, 'chyba': chyba}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(argv, odpoved, jine) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify(Object.assign({ mista: MISTA, sklad: SKLAD, nabidky: NABIDKY, katalog: KATALOG, minima: MINIMA, argv, odpoved: odpoved || '' }, jine || {})));
  return new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000 },
    (err, so, se) => {
      const out = String(so) + String(se);
      const i = out.lastIndexOf('###');
      let j = null; try { j = i >= 0 ? JSON.parse(out.slice(i + 3)) : null; } catch (e) {}
      res({ kod: err ? err.code : 0, out, j });
    }));
}
const naz = (a) => (a || []).map(x => x.nazev + '|' + x.velikost).sort().join(' ; ');

(async () => {
  sekce('1) Přihlášení a načtení');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j && !r.j.chyba, r.out);
  const v = r.j ? r.j.vysledek : {};
  ok('jen vlastní nabídky (user_id), katalog, minimum jen u schválených', r.j && r.j.volano.some(x => /user_id=eq\.u1/.test(x))
    && r.j.volano.filter(x => /select=shop_price/.test(x)).length === 4, JSON.stringify(r.j && r.j.volano));
  ok('aktivní = schválené + čekající (5), vyplacené ne', v.aktivnich === 5 && v.schvalenych === 4, JSON.stringify([v.aktivnich, v.schvalenych]));
  ok('náhled nic nezapíše', r.j && r.j.zapisy.length === 0);

  sekce('2) Pravidla ze skillu');
  ok('Smazat: prodaný Yeezy a Air Max ve špatné velikosti', naz(v.smazat) === 'Nike Air Max 1 Patta|44 ; Yeezy Yeezy Slide Onyx|42' || naz(v.smazat) === 'Nike Air Max 1 Patta|44 ; Yeezy Slide Onyx|42', naz(v.smazat));
  const du = (re) => ((v.smazat || []).find(x => re.test(x.nazev)) || {});
  ok('důvody: prodáno s id, skladem jen jiná velikost', /Prodáno/.test(du(/Yeezy/).duvod) && JSON.stringify(du(/Yeezy/).ids) === '["s1"]'
    && /Skladem jen vel\. 43/.test(du(/Air Max/).duvod), JSON.stringify(v.smazat));
  ok('Přidat: mikina (na cestě, v katalogu), Mizuno (není v katalogu), Air Max 43', naz(v.pridat) === 'Air Max 1 Patta|43 ; Corteiz Alcatraz Hoodie|M ; Mizuno Wave Rider|43', naz(v.pridat));
  const p = (re) => (v.pridat || []).find(x => re.test(x.nazev)) || {};
  ok('katalog: mikina ano, Mizuno ne', p(/Corteiz/).v_katalogu === true && p(/Mizuno/).v_katalogu === false && p(/Corteiz/).duvod === 'na cestě');
  const j4 = (v.platby || []).find(x => /Black Cat/.test(x.nazev)) || {};
  ok('Black Cat: dražší o 500, nastav 9 390, payout 7 512; payout z ceny 7 992', j4.drazsi_o === 500 && j4.doporucena === 9390
    && j4.payout_doporucena === 7512 && j4.payout === 7992, JSON.stringify(j4));
  ok('čekající Samba v payoutech není', !(v.platby || []).some(x => /Samba/.test(x.nazev)));
  const f = (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: Black Cat zaškrtnout, vrácený odškrtnout, Samba (čeká) a Dunk nechat', f === 'a+,v-', f);

  sekce('3) Pojistka a odeslání');
  const mnoho = SKLAD.concat(Array.from({ length: 11 }, (_, i) => ({ id: 'x' + i, name: 'Kus číslo ' + i, size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Sneakersnow'] })));
  r = await spust(['--nahled'], '', { sklad: mnoho });
  ok('víc než 10 odškrtnutí → fajfky se zadrží', r.j && r.j.vysledek.zmeny.length === 0 && r.j.vysledek.zmeny_zadrzene.length > 10, r.out.slice(-300));
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[1].jmeno === 'pozadavek_report_sneakersnow' && z[2].obsah.kontrola, z.map(x => x.jmeno).join() + r.out.slice(-300));
  const k = z[2] ? z[2].obsah.kontrola : {};
  ok('kontrola: smazat prodaný, chybí 2, nejde Mizuno, není ve skladu 1, web', JSON.stringify(k.smazat) === '["s1"]'
    && (k.chybi || []).sort().join() === 'c,s2' && (k.nejde || []).map(x => x.id).join() === 'd'
    && (k.neniVeSkladu || []).length === 1 && k.web === 'https://snconsign.cz/dashboard', JSON.stringify(k));
  ok('uložené přihlášení', JSON.stringify(r.j && r.j.ulozeno) === '["Sneakersnow"]');

  sekce('4) Špatné heslo a zdroj');
  r = await spust(['--nahled'], '', { heslo: 'spatne' });
  ok('špatné heslo → hláška, nic neuloženo', r.j && /odmítl/.test(r.j.chyba) && r.j.ulozeno.length === 0, r.out.slice(-300));
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'sneakersnow_kontrola.py'), 'utf8');
  ok('do cloudu jen přes sklad_firestore', !/"PATCH"|"DELETE"/.test(zdroj));
  ok('na portálu jen čte: POST jen na přihlášení, žádný zápis do tabulek', !/\.insert\(|\.update\(|\.delete\(|"PATCH"/.test(zdroj.replace(/sys\.path\.insert/g, ''))
    && (zdroj.match(/self\._req\("[^"]*", \{/g) || []).length === 1);

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
