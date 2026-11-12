// Test: nastroje/refresher_kontrola.py — kontrola Refresheru na PC.
//
// Pravidla jsou ze skillu „refresher-kontrola" (majitel je nechává jako
// zálohu, když nebude u PC): Smazat = inzerát aktivní, model už není
// skladem; Opravit = velikosti v inzerátu ≠ skladem; duplicitní inzerát;
// Onesize = OS / L/XL / M/L, S = S/M; fajfky obousměrně, 1 kus na
// model + velikost. Web se tu nestahuje: profil i detail se podstrčí
// jako HTML ve skutečném tvaru (ověřeno 12. 11. 2026), cloud taky.

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
const MISTA = { platforms: ['StockX'], eshopy: [], local: ['Refresher', 'Vinted'] };
const SKLAD = [
  { id: 'a', name: 'Jordan 4 Black Cat', size: '44', saleState: 'stock', location: 'Doma', platforms: ['Refresher'] },
  { id: 'a2', name: 'Jordan 4 Black Cat', size: '45', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'c', name: 'Supreme Box Logo Cap', size: 'OS', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'm', name: 'Nike Mind 001', size: '46', saleState: 'stock', location: 'Doma', platforms: ['Refresher'] },
  { id: 'v', name: 'Vrácené', size: '43', saleState: 'stock', location: 'Vráceno', platforms: ['Refresher'] },
  { id: 'w', name: 'Dunk Low Panda', size: '42', saleState: 'paid', payoutDate: '2026-10-01', platforms: [] },
  { id: 'w2', name: 'Dunk Low Panda', size: '42', saleState: 'paid', payoutDate: '2026-11-01', platforms: [] },
  { id: 'q', name: 'Yeezy Slide', size: '40', saleState: 'waiting', platforms: [] },
];
function polozka(id, nazev) {
  return `<div class="market-list__item" data-id="${id}">
    <a href="https://market.refresher.sk/product/${id}/x"><img class="market-list__item-image" src="https://storage.refresher.sk/${id}.jpeg?a=1&amp;b=2" alt=""></a>
    <a href="https://market.refresher.sk/product/${id}/x" class="market-list__item-name">
            ${nazev}
        </a><div class="market-list__item-price">100 Kč</div></div>`;
}
const PROFIL = `<html><div data-seller="310225" data-product-endpoint="https://refresher.cz/ajx/profil/market"></div>
  ${polozka(1, 'Jordan 4 Black Cat')}${polozka(2, 'Jordan 4 Black Cat')}${polozka(3, 'Dunk Low Panda')}
  <button class="btn" data-more data-page="1" data-pages="2"><span>Načíst další produkty</span></button></html>`;
const STRANA2 = polozka(4, 'Supreme Box Logo Cap') + polozka(5, 'Yeezy Slide') + polozka(6, 'Bape Hoodie &amp; Co') + polozka(7, 'Jordan 4 Black Cat');
const det = (vel) => `<div class="Product-Info"><div class="Product-Info-Name">Popis produktu</div><div class="Product-Info-Value">Velikost: 99</div></div>
  <div class="Product-Info"><div class="Product-Info-Name">Dostupné veľkosti</div><div class="Product-Info-Value">${vel}</div></div>`;
const STRANKY = {
  'https://refresher.cz/profil/mtkm-store': [200, PROFIL],
  'https://refresher.cz/ajx/profil/market?seller=310225&page=2&more=1': [200, STRANA2],
  'https://market.refresher.sk/product/1/x': [200, det('44, 46')],
  'https://market.refresher.sk/product/2/x': [200, det('44')],          // duplicitní (44 už je v 1)
  'https://market.refresher.sk/product/3/x': [200, det('42')],
  'https://market.refresher.sk/product/4/x': [200, det('Onesize')],
  'https://market.refresher.sk/product/5/x': [403, 'Produkt bol pravdepodobne zmazaný'],
  'https://market.refresher.sk/product/6/x': [200, det('L')],
  'https://market.refresher.sk/product/7/x': [200, det('45')],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresher-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import refresher_kontrola as R
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
R.VYSTUP = sys.argv[3] + '/vysledek.json'
R.PAUZA = 0
zapisy, volano = [], []
R.S.prihlas = lambda *a: 'token'
R.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
R.S._zapis_dokument = zapis
def stahni(url, pokusu=2):
    volano.append(url)
    s = vstup['stranky'].get(url)
    return (s[0], s[1]) if s else (404, '')
R.stahni = stahni
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
R.main(vstup['argv'])
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': json.load(open(R.VYSTUP, encoding='utf-8')), 'volano': volano}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(argv, odpoved) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify({ mista: MISTA, sklad: SKLAD, stranky: STRANKY, argv, odpoved: odpoved || '' }));
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
  sekce('1) Načtení profilu');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j, r.out);
  const v = r.j ? r.j.vysledek : {};
  ok('všech 7 inzerátů včetně druhé stránky', v.count === 7, r.out.slice(0, 500));
  ok('náhled nic nezapíše', r.j && r.j.zapisy.length === 0);

  sekce('2) Pravidla ze skillu');
  const naz = (a) => (a || []).map(x => x.nazev + '|' + x.velikost).sort().join(' ; ');
  ok('Smazat: prodaný model (nejčerstvější kus) i model v Čeká se smazaným detailem',
    naz(v.smazat) === 'Dunk Low Panda|42 ; Yeezy Slide|', naz(v.smazat));
  const dunk = (v.smazat || []).find(x => /Dunk/.test(x.nazev)) || {};
  ok('u prodaného je id posledního prodeje', JSON.stringify(dunk.ids) === '["w2"]', JSON.stringify(dunk));
  const yz = (v.smazat || []).find(x => /Yeezy/.test(x.nazev)) || {};
  ok('Čeká a smazaný detail jsou v důvodu', /v Čeká/.test(yz.duvod) && /smazaný/.test(yz.duvod), yz.duvod);
  ok('Není ve SKLADu: Bape (entity v názvu rozluštěné)', naz(v.neni_ve_skladu) === 'Bape Hoodie & Co|L', naz(v.neni_ve_skladu));
  const opr = (v.opravit || []).filter(x => !x.duplicitni);
  ok('model rozdělený do dvou inzerátů (44, 46 + 45): velikosti se sečtou, opravit jen 46',
    opr.length === 1 && /odeber 46/.test(opr[0].duvod) && !/přidej/.test(opr[0].duvod) && /product\/1\//.test(opr[0].odkaz), JSON.stringify(opr));
  const dup = (v.opravit || []).filter(x => x.duplicitni);
  ok('druhý inzerát na tentýž model a velikost je duplicitní', dup.length === 1 && /Duplicitní/.test(dup[0].duvod), JSON.stringify(v.opravit));
  ok('Onesize = OS: čepice sedí, nic neopravovat', !opr.some(x => /Cap/.test(x.nazev)), JSON.stringify(opr));
  const f = (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: Black Cat 45 a čepice zaškrtnout, Mind bez inzerátu odškrtnout, vrácený kus nechat', f === 'a2+,c+,m-', f);

  sekce('3) Odeslání');
  r = await spust([], 'n');
  ok('bez „a" nic', r.j && r.j.zapisy.length === 0);
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[0].obsah.zmeny && z[1].jmeno === 'pozadavek_report_refresher'
    && z[2].obsah.kontrola && z[2].obsah.kontrola.misto === 'Refresher', z.map(x => x.jmeno).join());
  const k = z[2] ? z[2].obsah.kontrola : {};
  const rep = z[1] ? z[1].obsah : { sekce: [] };
  ok('kontrola: smazat jen prodané kusy, opravit i duplicitu, web profilu', JSON.stringify(k.smazat) === '["w2","q"]'
    && k.opravit.length === 2 && k.neniVeSkladu.length === 1 && k.web === 'https://refresher.cz/profil/mtkm-store' && k.inzeratu === 7,
    JSON.stringify(k));
  ok('report a kontrola stejný okamžik', rep.datum === k.datum);
  ok('report: duplicita patří do Smazat, obrázky z profilu', (rep.sekce[0].radky || []).length === 3
    && rep.sekce[0].radky.some(x => /Duplicitní/.test(x.duvod)) && /storage\.refresher\.sk\/3\.jpeg\?a=1&b=2/.test(rep.sekce[0].radky.map(x => x.obrazek).join(' ')),
    JSON.stringify(rep.sekce[0]));

  sekce('4) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'refresher_kontrola.py'), 'utf8');
  ok('do cloudu jen přes sklad_firestore (žádný vlastní PATCH)', !/PATCH|DELETE|method=/.test(zdroj));
  ok('na Refresher jen čte (žádný POST)', !/data=|\.post\(|"POST"/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
