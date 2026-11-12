// Test: nastroje/adonio/adonio_kontrola.py — kontrola Adonia na PC.
//
// Pravidla jsou ze skillu „adonio-kontrola" (jeho match.py; skill zůstává
// jako záloha): jen aktivní nabídky; tenisky SKU + velikost, jinak název
// (podobnost ≥ 0,7) + velikost; dvojité SKU „A / B"; ruční alias Corteiz
// V.A.A.; neaktivní na Adoniu → Přidat se štítkem; alternate jen pro
// párování; rozdíl SKU → zkontrolovat; payout = cena − max(25 %, 700 Kč);
// doporučená = nejnižší − 1 Kč. Stránka /listings se podstrčí jako HTML
// ve tvaru z 12. 10. 2026, cookie přihlášení ve tvaru @supabase/ssr.

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

const NASTROJE = path.resolve(__dirname, '..', 'nastroje', 'adonio');
const MISTA = { platforms: ['StockX'], eshopy: ['Adonio'], local: [] };
const SKLAD = [
  { id: 'a', name: 'Jordan 4 Black Cat', sku: 'CU1110-010', size: '44', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'f', name: 'Jordan 13 Flu Game', sku: 'CT8013-002', size: '41', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Adonio'] },
  { id: 'c', name: 'Corteiz V.A.A. Tee White', size: 'S', category: 'obleceni', saleState: 'stock', location: 'Doma', platforms: ['Adonio'] },
  { id: 'l', name: 'Labubu Big Into Energy', size: '', category: 'alternate', saleState: 'stock', location: 'Doma', platforms: ['Adonio'] },
  { id: 'm', name: 'Air Max 95 Sail', sku: 'DM9104-001', size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Adonio'] },
  { id: 'n', name: 'New Balance 990v6 Grey', sku: 'NB990', size: '43', category: 'sneakers', saleState: 'stock', location: 'Na cestě', platforms: [] },
  { id: 'k', name: 'Labubu Zimomriavky', size: '', category: 'alternate', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 's1', name: 'Nike x NOCTA CS T-shirt Dark Grey', size: 'M', category: 'obleceni', saleState: 'paid', soldWhere: 'Pikastore', saleDate: '2026-10-05' },
];
const varianta = (vel, stav, cena, diff, pay) => `<div class="v"><div>${vel}</div><div>Margin</div><div>×1</div><div><span>${stav}</span></div>
  <div><span>${cena}</span></div><div>${diff ? '+' + diff + ' Kč vs nejlevnější' : '✓ Nejlevnější'}</div><div>Payout</div><div>${pay}</div>
  <button>Upravit</button><button>Deaktivovat</button></div>`;
const produkt = (nazev, sku, varianty) => `<section><h3>${nazev}</h3>${sku ? `<p>${sku}</p>` : ''}<button>Přidat</button>${varianty.join('')}</section>`;
const LISTINGS = `<html><head><script>self.__next_f.push([1,"Margin Přidat"])</script></head><body><main><h1>Moje nabídky</h1><div>7 nab.</div>
  ${produkt('Air Jordan 4 Retro Black Cat', 'CU1110-010 / CU1110-011', [varianta('44', 'Aktivní', '9 990 Kč', 400, '7 493 Kč')])}
  ${produkt('Jordan 13 Retro Flu Game', 'CT8013-060', [varianta('41', 'Aktivní', '4 590 Kč', 0, '3 443 Kč')])}
  ${produkt('Corteiz x V.A.A. Virgil Abloh Tee White', '', [varianta('S', 'Aktivní', '1 990 Kč', 0, '1 290 Kč')])}
  ${produkt('Labubu Big Into Energy', '', [varianta('OS', 'Aktivní', '1 500 Kč', 0, '800 Kč')])}
  ${produkt('Nike x NOCTA CS T-shirt Dark Grey', '', [varianta('M', 'Aktivní', '1 990 Kč', 0, '1 290 Kč')])}
  ${produkt('Air Max 95 Sail', 'DM9104-001', [varianta('42', 'Neaktivní', '3 990 Kč', 0, '2 990 Kč'), varianta('45', 'Aktivní', '3 990 Kč', 0, '2 990 Kč')])}
</main></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adonio-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import adonio_kontrola as R
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
R.VYSTUP = sys.argv[3] + '/vysledek.json'
zapisy, volano, ulozeno, ladici = [], [], [], []
R.S.prihlas = lambda *a: 'token'
R.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
R.S.prihlaseni_webu = lambda misto, zeptat=True: ('gabro@x.cz', 'tajne', True)
R.S.uloz_prihlaseni_webu = lambda misto, e, h: ulozeno.append(misto)
R.S.uloz_ladici = lambda sl, n, o: ladici.append(n) or n
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
R.S._zapis_dokument = zapis
R.nastaveni_portalu = lambda: ('https://abc123.supabase.co', 'klic')
R.prihlas_web = lambda url, klic, e, h: R.cookie_relace(url, {'access_token': 't' * vstup.get('delka', 10), 'refresh_token': 'r'})
def get(url, cookie=None):
    volano.append({'url': url, 'cookie': cookie})
    return url, vstup['stranka']
R._get = get
def prohlizec(cookie):
    volano.append({'prohlizec': cookie})
    return R.text_stranky(vstup.get('prohlizec', vstup['stranka']))
R.nacti_prohlizecem = prohlizec
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
try:
    R.main(vstup['argv']); chyba = ''
except RuntimeError as e:
    chyba = str(e)
v = json.load(open(R.VYSTUP, encoding='utf-8')) if not chyba else {}
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': v, 'volano': volano, 'ulozeno': ulozeno, 'ladici': ladici, 'chyba': chyba,
  'cookie_dlouha': R.cookie_relace('https://abc123.supabase.co', {'access_token': 'x' * 5000})}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(argv, odpoved, jine) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify(Object.assign({ mista: MISTA, sklad: SKLAD, stranka: LISTINGS, argv, odpoved: odpoved || '' }, jine || {})));
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
  sekce('1) Přihlášení a stránka');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j && !r.j.chyba, r.out);
  const v = r.j ? r.j.vysledek : {};
  const c = r.j ? r.j.volano[0].cookie : '';
  ok('/listings s cookie sb-<projekt>-auth-token=base64-…', r.j && /\/listings$/.test(r.j.volano[0].url) && /^sb-abc123-auth-token=base64-[A-Za-z0-9_-]+$/.test(c), c);
  ok('dlouhá cookie se dělí na .0, .1', r.j && /^sb-abc123-auth-token\.0=base64-.*; sb-abc123-auth-token\.1=/.test(r.j.cookie_dlouha));
  ok('7 nabídek (sedí s „7 nab.") a 6 aktivních, skript stránky se nečte', v.nabidek === 7 && v.aktivnich === 6 && r.j.ladici.length === 0, JSON.stringify([v.nabidek, v.aktivnich, r.j && r.j.ladici]));
  ok('náhled nic nezapíše', r.j && r.j.zapisy.length === 0);

  r = await spust(['--nahled'], '', { stranka: '<main><h1>Moje nabídky</h1><p>Načítám…</p></main>', prohlizec: LISTINGS });
  ok('stránka jen „Načítám…" → nabídky z prohlížeče se stejnou cookie', r.j && !r.j.chyba && r.j.vysledek.nabidek === 7
    && r.j.volano.some(x => x.prohlizec && /^sb-abc123-auth-token=/.test(x.prohlizec)), r.out.slice(-400));
  r = await spust(['--nahled'], '', { stranka: '<main>Načítám…</main>', prohlizec: '<main>Načítám…</main>' });
  ok('ani prohlížeč nic → chyba a text do debug, nic se nepošle', r.j && /nenašla/.test(r.j.chyba) && r.j.zapisy.length === 0 && r.j.ladici.includes('adonio_listings.txt'));

  const NOVY = ['Moje nabídky', '4 nab.', '—', 'Air Jordan 4 Retro Black Cat', 'CU1110-010', 'Přidat', 'Velikost Cena Payout Ks Status VAT',
    '44', '9 990 Kč', '+400 Kč vs nejlevnější', '7 493 Kč 1 Aktivní Margin', 'Nastavit nejnižší cenu',
    'Air Max 95 Sail', 'DM9104-001', 'Přidat', 'Velikost Cena Payout Ks Status VAT', '42', '3 990 Kč', '✓ Nejlevnější', '2 990 Kč 1 Neaktivní Margin', 'Obnovit',
    '45', '3 990 Kč', '✓ Nejlevnější', '2 990 Kč 1 Aktivní Margin', '46', '3 990 Kč', '✓ Nejlevnější', '2 990 Kč 0 Prodáno Margin'].join('\n');
  r = await spust(['--nahled'], '', { stranka: '<main>Načítám…</main>', prohlizec: NOVY });
  const vn = r.j && r.j.vysledek;
  ok('rozložení od 12. 11.: payout, ks a stav na jednom řádku; prodaný řádek se přeskočí a počet sedí',
    vn && vn.nabidek === 3 && vn.aktivnich === 2 && r.j.ladici.length === 0
    && (vn.platby || []).some(x => x.sku === 'CU1110-010' && x.cena === 9990 && x.payout === 7493), JSON.stringify(vn && [vn.nabidek, vn.aktivnich, r.j.ladici]) + r.out.slice(-300));

  sekce('2) Pravidla ze skillu');
  const pl = (re) => (v.platby || []).find(x => re.test(x.nazev)) || {};
  ok('dvojité SKU: vezme to, které je ve skladu; cena s mezerami', pl(/Black Cat/).sku === 'CU1110-010' && pl(/Black Cat/).cena === 9990
    && pl(/Black Cat/).payout === 7493, JSON.stringify(pl(/Black Cat/)));
  ok('Black Cat dražší o 400: nejnižší 9 590, nastav 9 589 → payout 7 192', pl(/Black Cat/).nejnizsi === 9590 && pl(/Black Cat/).doporucena === 9589
    && pl(/Black Cat/).payout_doporucena === 7192, JSON.stringify(pl(/Black Cat/)));
  ok('Corteiz (ruční alias) i Labubu (alternate, OS = prázdná) jsou spárované', !!pl(/Corteiz/).ids && !!pl(/Labubu/).ids
    && pl(/Corteiz/).ids[0] === 'c' && pl(/Labubu/).ids[0] === 'l', JSON.stringify(v.platby));
  ok('Smazat: NOCTA (prodaná přes Pikastore) a Air Max 45', naz(v.smazat) === 'Air Max 95 Sail|45 ; Nike x NOCTA CS T-shirt Dark Grey|M', naz(v.smazat));
  ok('NOCTA: důvod a id prodeje', /Prodáno \(Pikastore/.test(((v.smazat || []).find(x => /NOCTA/.test(x.nazev)) || {}).duvod)
    && JSON.stringify(((v.smazat || []).find(x => /NOCTA/.test(x.nazev)) || {}).ids) === '["s1"]');
  ok('zkontrolovat: Flu Game (SKU CT8013-060 vs CT8013-002)', naz(v.opravit) === 'Jordan 13 Retro Flu Game|41' && /CT8013-002/.test(v.opravit[0].duvod), JSON.stringify(v.opravit));
  ok('Přidat: Air Max 42 (neaktivní na Adoniu) a NB na cestě; Labubu Zimomriavky ne (alternate)',
    naz(v.pridat) === 'Air Max 95 Sail|42 ; New Balance 990v6 Grey|43', naz(v.pridat));
  ok('štítky', /neaktivní na Adoniu/.test(((v.pridat || []).find(x => /Air Max/.test(x.nazev)) || {}).duvod)
    && /na cestě/.test(((v.pridat || []).find(x => /New Balance/.test(x.nazev)) || {}).duvod));
  const f = (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: Black Cat zaškrtnout, Air Max 42 odškrtnout', f === 'a+,m-', f);

  sekce('3) Odeslání');
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[1].jmeno === 'pozadavek_report_adonio' && z[2].obsah.kontrola, z.map(x => x.jmeno).join() + r.out.slice(-300));
  const k = z[2] ? z[2].obsah.kontrola : {};
  ok('kontrola: smazat prodaný, chybí 2, není ve skladu 1, zkontrolovat 1', JSON.stringify(k.smazat) === '["s1"]'
    && (k.chybi || []).sort().join() === 'm,n' && (k.neniVeSkladu || []).length === 1 && (k.opravit || []).length === 1
    && k.web === 'https://consign-adonio.eu/listings', JSON.stringify(k));

  sekce('4) Změněná stránka');
  r = await spust(['--nahled'], '', { stranka: '<html><main>Moje nabídky<div>3 nab.</div></main></html>' });
  ok('žádná nabídka → chyba a text stránky do debug', r.j && /nenašla žádná nabídka/.test(r.j.chyba) && r.j.ladici.includes('adonio_listings.txt'), r.out.slice(-300));

  sekce('5) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'adonio_kontrola.py'), 'utf8');
  ok('do cloudu jen přes sklad_firestore', !/"PATCH"|"DELETE"/.test(zdroj));
  ok('na Adoniu jen čte: POST jen na přihlášení', (zdroj.match(/method="POST"/g) || []).length === 1 && /grant_type=password/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
