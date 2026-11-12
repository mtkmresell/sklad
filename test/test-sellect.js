// Test: nastroje/sellect/sellect_kontrola.py — kontrola Sellectu na PC.
//
// Pravidla jsou ze skillu „sellect-kontrola" (zůstává jako záloha):
// klíč SKU|velikost („43.0" = 43), bez SKU podle názvu (Labubu), UGG
// US 9 = 42; „sus" kus (skladem, ale s místem prodeje a mimo známá
// místa) → Smazat s Ověř, fajfka beze změny, neprodlužuje se; důvody
// Čeká / Prodáno / špatná velikost / není; Přidat jen sneakers +
// oblečení, mimo katalog štítek; prodlužuje se jen to, co je skladem,
// a teprve po „a". Stránka se nestahuje — HTML se podstrčí.

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

const NASTROJE = path.resolve(__dirname, '..', 'nastroje', 'sellect');
const MISTA = { platforms: ['StockX'], eshopy: ['Sellect'], local: [] };
const SKLAD = [
  { id: 'a', name: 'Jordan 4 Black Cat', sku: 'CU1110-010', size: '44', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'u', name: 'UGG Tasman Chestnut', sku: '1181910-CHE', size: '42', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Sellect'] },
  { id: 'l', name: 'Labubu Big Into Energy', size: 'OS', category: 'alternate', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 'x', name: 'Dunk Low Panda', sku: 'DD1391-100', size: '42', category: 'sneakers', saleState: 'stock', location: 'Sneakysneakers', soldWhere: 'Vinted', saleDate: '2026-11-02', platforms: ['Sellect'] },
  { id: 'p', name: 'Supreme Box Logo Tee', size: 'L', category: 'obleceni', saleState: 'stock', location: 'Na cestě', platforms: [] },
  { id: 'k', name: 'Samba OG', sku: 'B75806', size: '43', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Sellect'] },
  { id: 'm', name: 'Mimo katalog', sku: 'ZZ-1', size: '41', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: [] },
  { id: 's1', name: 'Yeezy Slide', sku: 'HQ6448', size: '42', category: 'sneakers', saleState: 'paid', soldWhere: 'Vinted', saleDate: '2026-10-01' },
  { id: 's2', name: 'Air Max 1', sku: 'AM1', size: '40', category: 'sneakers', saleState: 'waiting', soldWhere: 'StockX', saleDate: '2026-11-03' },
];
const td = (c) => c.map(x => `<td>\n  ${x}\n</td>`).join('');
const radek = (sku, nazev, vel, cena, payout, ext, img) => `<tr>${td(['', img ? `<img src="https://cdn.sellect.cz/${img}.jpg">` : '', '', '', '',
  sku, nazev, vel, '', cena, '', payout, 'Platí do 20. 11.'])}<td>${ext ? `<a href="/nabidky/extend/${ext}">Prodloužit</a>` : ''}</td></tr>`;
const STRANKA = `<html><a href="/security/logout">Odhlásit</a><table id="table" class="dt"><thead><tr><th>x</th></tr></thead><tbody>
  ${radek('CU1110-010', 'Air Jordan 4 Retro Black Cat', '44.0', '5 000 Kč', '3 950 Kč', 101, 'aj4')}
  ${radek('1181910-CHE', 'UGG Tasman', '9', '3 000 Kč (+200 Kč)', '2 350 Kč', 102)}
  ${radek('', 'Labubu Big Into Energy', 'OS', '900 Kč', '670 Kč', 103)}
  ${radek('DD1391-100', 'Nike Dunk Low', '42', '2 500 Kč', '1 950 Kč', 104)}
  ${radek('HQ6448', 'Yeezy Slide', '42', '2 000 Kč', '1 550 Kč', 105)}
  ${radek('AM1', 'Air Max 1', '40', '2 000 Kč', '1 550 Kč', 106)}
  ${radek('B75806', 'Samba', '44', '2 000 Kč', '1 550 Kč', 107)}
  ${radek('QQ-5', 'Něco', '40', '1 000 Kč', '750 Kč', 108)}
</tbody></table></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sellect-'));
const RIDIC = `
import sys, json
sys.path.insert(0, sys.argv[1])
import sellect_kontrola as R
vstup = json.load(open(sys.argv[2], encoding='utf-8'))
R.VYSTUP = sys.argv[3] + '/vysledek.json'
zapisy, volano, ulozeno, ladici = [], [], [], []
R.S.prihlas = lambda *a: 'token'
R.S.nacti_sklad = lambda token, uid=None: ({'platGroups': vstup['mista'], 'savedAt': 'x'}, vstup['sklad'])
R.S.prihlaseni_webu = lambda misto, zeptat=True: ('gabro@x.cz', vstup.get('heslo', 'tajne'), True)
R.S.uloz_prihlaseni_webu = lambda misto, e, h: ulozeno.append(misto)
R.S.uloz_ladici = lambda sl, nazev, obsah: ladici.append(nazev) or nazev
def zapis(token, uid, jmeno, obsah):
    assert jmeno.startswith('pozadavek_')
    zapisy.append({'jmeno': jmeno, 'obsah': obsah}); return jmeno
R.S._zapis_dokument = zapis
class W:
    def get(self, cesta, h=None):
        volano.append('GET ' + cesta)
        if cesta == '/security/login': return cesta, '<form><input type="hidden" name="_csrf_token" value="abc"><input name="password"></form>'
        if cesta == '/nabidky/aktualni': return cesta, vstup['stranka']
        if cesta.startswith('/nabidky/extend/'): return cesta, 'ok'
        raise AssertionError(cesta)
    def post(self, cesta, pole, h=None):
        volano.append('POST ' + cesta + ' ' + json.dumps(pole, sort_keys=True))
        if cesta == '/security/login':
            if pole['password'] != 'tajne' or pole['_csrf_token'] != 'abc':
                return cesta, '<div>Neplatné přihlašovací údaje.</div><input name="password">'
            return '/nabidky/aktualni', vstup['stranka']
        if cesta == '/produkty/find-product/':
            return cesta, json.dumps([{'code': pole['search']}] if pole['search'] != 'ZZ-1' else [{'code': 'ZZ-10'}])
        raise AssertionError(cesta)
R.Web = W
import builtins
builtins.input = lambda *a: vstup.get('odpoved', '')
try:
    R.main(vstup['argv'])
    chyba = ''
except RuntimeError as e:
    chyba = str(e)
v = json.load(open(R.VYSTUP, encoding='utf-8')) if not chyba else {}
print('###' + json.dumps({'zapisy': zapisy, 'vysledek': v, 'volano': volano, 'ulozeno': ulozeno, 'ladici': ladici, 'chyba': chyba}, ensure_ascii=False))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);
function spust(argv, odpoved, jine) {
  fs.writeFileSync(path.join(tmp, 'vstup.json'), JSON.stringify(Object.assign({ mista: MISTA, sklad: SKLAD, stranka: STRANKA, argv, odpoved: odpoved || '' }, jine || {})));
  return new Promise(res => execFile('python3', ['-I', path.join(tmp, 'ridic.py'), NASTROJE, path.join(tmp, 'vstup.json'), tmp],
    { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000 },
    (err, so, se) => {
      const out = String(so) + String(se);
      const i = out.lastIndexOf('###');
      let j = null; try { j = i >= 0 ? JSON.parse(out.slice(i + 3)) : null; } catch (e) {}
      res({ kod: err ? err.code : 0, out, j });
    }));
}
const naz = (a) => (a || []).map(x => (x.sku || x.nazev) + '|' + x.velikost).sort().join(' ; ');

(async () => {
  sekce('1) Přihlášení a tabulka');
  let r = await spust(['--nahled']);
  ok('proběhne bez chyby', r.kod === 0 && r.j && !r.j.chyba, r.out);
  const v = r.j ? r.j.vysledek : {};
  ok('přihlášení s CSRF ze stránky', r.j && r.j.volano.some(x => /POST \/security\/login .*"_csrf_token": "abc"/.test(x)), JSON.stringify(r.j && r.j.volano));
  ok('všech 8 nabídek', v.nabidek === 8, r.out.slice(0, 400));
  const aj = (v.nabidky || [])[0] || {};
  ok('řádek: 44.0 → 44, cena a payout čísla, obrázek', aj.velikost === '44' && aj.cena === 5000 && aj.payout === 3950
    && aj.obrazek === 'https://cdn.sellect.cz/aj4.jpg' && aj.extend === '/nabidky/extend/101', JSON.stringify(aj));
  ok('„+200 Kč" navíc', ((v.nabidky || [])[1] || {}).navic === 200);
  ok('katalog se ptá jen na SKU chybějících velikostí, každé jednou', r.j.volano.filter(x => /find-product/.test(x)).length === 2
    && r.j.volano.some(x => /find-product.*ZZ-1/.test(x)), JSON.stringify(r.j.volano));
  ok('náhled nic nezapíše ani neprodlouží', r.j.zapisy.length === 0 && !r.j.volano.some(x => /extend/.test(x)));

  sekce('2) Pravidla ze skillu');
  ok('Smazat: sus Dunk, Yeezy, Air Max, Samba (špatná velikost), Něco', naz(v.smazat) === 'AM1|40 ; B75806|44 ; DD1391-100|42 ; HQ6448|42 ; QQ-5|40', naz(v.smazat));
  const du = (k) => ((v.smazat || []).find(x => x.sku === k) || {}).duvod || '';
  ok('důvody', /^Ověř/.test(du('DD1391-100')) && /Prodáno \(Vinted 1\. 10\.\)/.test(du('HQ6448')) && /Čeká \(StockX 3\. 11\.\)/.test(du('AM1'))
    && /skladem 43\) — špatná velikost/.test(du('B75806')) && du('QQ-5') === 'Ve SKLADu vůbec není',
    ['DD1391-100', 'HQ6448', 'AM1', 'B75806', 'QQ-5'].map(du).join(' | '));
  ok('UGG US 9 = 42 a Labubu podle názvu sedí', !(v.smazat || []).some(x => /UGG|Labubu/.test(x.nazev)));
  ok('Přidat: Samba 43, tričko na cestě, mimo katalog; Labubu ne (alternate)', naz(v.pridat) === 'B75806|43 ; Supreme Box Logo Tee|L ; ZZ-1|41', naz(v.pridat));
  const zz = (v.pridat || []).find(x => x.sku === 'ZZ-1') || {};
  const tee = (v.pridat || []).find(x => /Tee/.test(x.nazev)) || {};
  ok('štítky: mimo katalog, bez SKU, na cestě', zz.v_katalogu === false && /není v katalogu Sellectu/.test(zz.duvod)
    && /na cestě/.test(tee.duvod) && /bez SKU/.test(tee.duvod), JSON.stringify([zz, tee]));
  ok('pořadí: v katalogu první', (v.pridat || [])[0] && v.pridat[0].sku === 'B75806');
  const f = (v.zmeny || []).map(z => z.id + (z.zaskrtnout ? '+' : '-')).sort().join();
  ok('fajfky: AJ4 a Labubu zaškrtnout, Samba 43 odškrtnout, sus Dunk nechat', f === 'a+,k-,l+', f);
  ok('prodloužit jen skladem: AJ4, UGG, Labubu', JSON.stringify(v.prodlouzit) === '["/nabidky/extend/101","/nabidky/extend/102","/nabidky/extend/103"]', JSON.stringify(v.prodlouzit));

  sekce('3) Odeslání');
  r = await spust([], 'n');
  ok('bez „a" nic a nic se neprodlouží', r.j && r.j.zapisy.length === 0 && !r.j.volano.some(x => /extend/.test(x)));
  r = await spust([], 'a');
  const z = r.j ? r.j.zapisy : [];
  ok('fajfky, report a kontrola', z.length === 3 && z[1].jmeno === 'pozadavek_report_sellect' && z[2].obsah.kontrola, z.map(x => x.jmeno).join() + r.out.slice(-300));
  ok('po „a" prodlouženo 3', r.j && r.j.volano.filter(x => /GET \/nabidky\/extend/.test(x)).length === 3);
  const k = z[2] ? z[2].obsah.kontrola : {};
  ok('kontrola: smazat jen prodané (ne Ověř), chybí v katalogu, nejde mimo katalog, není ve skladu', JSON.stringify(k.smazat) === '["s1","s2"]'
    && JSON.stringify(k.chybi) === '["k"]' && (k.nejde || []).map(x => x.id).sort().join() === 'm,p'
    && (k.neniVeSkladu || []).length === 2 && k.web === 'https://partner.sellect.cz/nabidky/aktualni', JSON.stringify(k));

  sekce('4) Chyby');
  r = await spust(['--nahled'], '', { heslo: 'spatne' });
  ok('špatné heslo → hláška, nic neuloženo', r.j && /Neplatné/.test(r.j.chyba) && r.j.ulozeno.length === 0, r.out.slice(-300));
  r = await spust(['--nahled'], '', { stranka: '<html><a href="/security/logout">x</a><table id="table"><tbody></tbody></table></html>' });
  ok('prázdná tabulka → stránka do debug', r.j && r.j.ladici.includes('sellect_aktualni.html'), r.out.slice(-300));

  sekce('5) Zdroj');
  const zdroj = fs.readFileSync(path.join(NASTROJE, 'sellect_kontrola.py'), 'utf8');
  ok('do cloudu jen přes sklad_firestore', !/PATCH|DELETE/.test(zdroj));
  ok('na Sellectu jen přihlášení, katalog a prodloužení', (zdroj.match(/w\.post\(|self\.post|\.post\(/g) || []).length <= 3
    && !/\/nabidky\/(?!aktualni|extend)/.test(zdroj.replace(/"\/nabidky\/extend\/"/g, '')), '');
  ok('prodlužuje se až v pred_odeslanim', /pred_odeslanim=prodluz/.test(zdroj));

  console.log('\n' + (selhalo ? 'SELHALO ' + selhalo + ' z ' + (selhalo + proslo) : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
