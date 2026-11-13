// Test: nastroje/sklad_firestore.py — lokální kontroly čtou sklad z Firestore
// a zapisují výsledek stejnou cestou jako konektor (lísteček pozadavek_…).
//
// Python běží proti falešnému serveru (adresy přes SKLAD_AUTH_URL
// a SKLAD_FS_BASE), nic nejde ven. Lístečky, které zapíše, se pak dají
// skutečné aplikaci v prohlížeči — hlídá se, že je opravdu převezme.
// Dva programy, které si posílají data, se umí rozejít tiše: Python by
// zapisoval, aplikace by to zahazovala a nikdo by si nevšiml.

const http = require('http');
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

const SKRIPT = path.resolve(__dirname, '..', 'nastroje', 'sklad_firestore.py');
const UID = 'p6JKNhfrbmZYaF8OIBxgd9durmq2';
const HESLO = 'tajneHeslo123';

function zabal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(zabal) } };
  const f = {}; for (const k of Object.keys(v)) f[k] = zabal(v[k]);
  return { mapValue: { fields: f } };
}
function rozbal(v) {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(rozbal);
  if ('mapValue' in v) { const o = {}; for (const k of Object.keys(v.mapValue.fields || {})) o[k] = rozbal(v.mapValue.fields[k]); return o; }
  return null;
}

const MISTA = { platforms: ['StockX'], eshopy: ['Section'], local: ['Bazoš.cz', 'Bazoš.sk', 'Vinted'] };
const DEN = 86400000;
const datum = (dni) => new Date(Date.now() - dni * DEN).toISOString().slice(0, 10);
const SKLAD = [
  { id: 'a', name: 'Jordan 4 Black Cat', size: '44', category: 'sneakers', saleState: 'stock', location: 'Doma', platforms: ['Bazoš.cz'], buyPrice: 5000, buyDate: datum(20), tags: [] },
  { id: 'b', name: 'Mind 001 Slide', size: '46', category: 'sneakers', saleState: 'stock', location: 'Na cestě', platforms: [], buyPrice: 2000, buyDate: datum(20), tags: [] },
  { id: 'v', name: 'Vrácené boty', size: '43', category: 'sneakers', saleState: 'stock', location: 'Vráceno', platforms: [], buyPrice: 1000, buyDate: datum(20), tags: [] },
  { id: 'p', name: 'Poškozené', size: '43', category: 'sneakers', saleState: 'stock', location: 'Poškozené', platforms: [], buyPrice: 1000, buyDate: datum(20), tags: [] },
  { id: 'w', name: 'Dunk Low Panda', size: '42', category: 'sneakers', saleState: 'waiting', waitState: 'sent', soldWhere: 'Vinted', sellPrice: 3000, platforms: ['Bazoš.sk'], buyPrice: 2000, buyDate: datum(40), tags: [] },
  { id: 'bal', type: 'bulk', name: 'Balík', saleState: 'stock', platforms: [] },
];
const ARCHIV = [
  { id: 'old', name: 'Yeezy Slide', size: '40', saleState: 'paid', soldWhere: 'Vinted', payoutDate: '2026-03-01', platforms: [] },
];

/* ── Falešný Google ─────────────────────────────────────────────────── */
let volani = [], zapisy = [];
const DOKUMENTY = {
  data: { savedAt: '2026-11-10T10:00:00Z', itemsStock: SKLAD, archiveYears: [2026], items: [], platGroups: JSON.stringify(MISTA) },
  sold_2026: { items: ARCHIV },
  photo_a: { data: 'data:image/png;base64,AAAA' },
};
const PRE = 'projects/x/databases/(default)/documents/users/' + UID + '/sklad/';
const server = http.createServer((req, res) => {
  let telo = '';
  req.on('data', c => telo += c);
  req.on('end', () => {
    volani.push({ metoda: req.method, url: req.url, telo });
    const posli = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/auth')) {
      const b = JSON.parse(telo);
      return b.password === HESLO ? posli(200, { idToken: 'TOKEN' }) : posli(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
    }
    if (req.headers.authorization !== 'Bearer TOKEN') return posli(401, {});
    if (req.method === 'GET' && req.url.startsWith('/fs/users/' + UID + '/sklad?')) {
      return posli(200, { documents: Object.keys(DOKUMENTY).map(n => ({ name: PRE + n })) });
    }
    if (req.method === 'POST' && req.url === '/fs:batchGet') {
      const b = JSON.parse(telo);
      return posli(200, b.documents.map(n => {
        const id = n.split('/').pop();
        const f = DOKUMENTY[id] ? zabal(DOKUMENTY[id]).mapValue.fields : null;
        return f ? { found: { name: n, fields: f } } : { missing: n };
      }));
    }
    if (req.method === 'PATCH') {
      zapisy.push({ url: req.url, telo: JSON.parse(telo) });
      return posli(200, {});
    }
    posli(404, {});
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skladpy-'));
function python(args, env) {
  return new Promise(resolve => {
    execFile('python3', [SKRIPT].concat(args), {
      cwd: tmp,
      env: Object.assign({ PATH: process.env.PATH, HOME: tmp }, env),
      timeout: 30000,
    }, (err, stdout, stderr) => resolve({ kod: err ? err.code : 0, out: String(stdout) + String(stderr) }));
  });
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ENV = {
    SKLAD_AUTH_URL: 'http://127.0.0.1:' + port + '/auth',
    SKLAD_FS_BASE: 'http://127.0.0.1:' + port + '/fs',
    SKLAD_EMAIL: 'ctecka@sklad.local',
    SKLAD_HESLO: HESLO,
  };
  const spust = async (args, env) => { volani = []; zapisy = []; return python(args, Object.assign({}, ENV, env || {})); };

  sekce('1) Přihlášení a čtení');
  let r = await spust(['test']);
  ok('test projde', r.kod === 0 && /Přihlášení OK/.test(r.out), r.out);
  ok('skladem 2 kusy (bez vráceného, poškozeného a balíku)', /Skladem ke kontrole: 2 kusů/.test(r.out), r.out);
  ok('prodané včetně archivu', /prodaných: 2/.test(r.out), r.out);
  ok('heslo se nikde nevypíše', r.out.indexOf(HESLO) === -1);
  const davka = volani.find(v => v.url === '/fs:batchGet');
  ok('fotky se nestahují', davka && !/photo_/.test(davka.telo), davka && davka.telo);
  ok('čtení nic nezapisuje', !volani.some(v => v.metoda === 'PATCH' || v.metoda === 'DELETE'));

  r = await spust(['test'], { SKLAD_HESLO: 'spatne' });
  ok('špatné heslo: srozumitelná chyba', r.kod === 1 && /Přihlášení nesedí/.test(r.out), r.out);
  r = await spust(['test'], { SKLAD_EMAIL: '', SKLAD_HESLO: '' });
  ok('bez údajů: poradí příkaz nastavit', r.kod === 1 && /nastavit/.test(r.out), r.out);

  // Heslo ze schránky (nastavit): do příkazového řádku Windows se heslo
  // psát naslepo a vkládat Ctrl+V nedaří — majitel ho tam nedostal vůbec.
  const kodPy = [
    'import sys; sys.path.insert(0, sys.argv[1]); import sklad_firestore as S',
    'print(S._jen_heslo("abc\\r\\n") == "abc")',
    'print(S._jen_heslo("SKLAD_HESLO=tajne heslo\\n") == "tajne heslo")',
    'print(S._jen_heslo("") == "")',
    'print(S.heslo_ze_schranky() == "")',
  ].join('\n');
  r = await new Promise(res => execFile('python3', ['-c', kodPy, path.dirname(SKRIPT)], { cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp }, timeout: 30000 },
    (err, so, se) => res({ kod: err ? err.code : 0, out: String(so) + String(se) })));
  ok('heslo ze schránky: konec řádku i „SKLAD_HESLO=" se utne, prázdná schránka nespadne',
    r.kod === 0 && r.out.trim().split('\n').every(l => l.trim() === 'True'), r.out);

  sekce('2) sklad.json ve starém formátu');
  r = await spust(['sklad', 'sklad.json']);
  const sklad = JSON.parse(fs.readFileSync(path.join(tmp, 'sklad.json'), 'utf8'));
  ok('[id, název, velikost, cz, sk]', JSON.stringify(sklad) === JSON.stringify([
    ['a', 'Jordan 4 Black Cat', '44', true, false],
    ['b', 'Mind 001 Slide', '46', false, false],
  ]), JSON.stringify(sklad));
  const prod = JSON.parse(fs.readFileSync(path.join(tmp, 'prodane.json'), 'utf8'));
  ok('prodane.json má čekající i vyplacené z archivu', prod.map(x => x[0]).join() === 'w,old', JSON.stringify(prod));

  sekce('3) Kontrola: náhled nic nezapíše');
  fs.writeFileSync(path.join(tmp, 'k.json'), JSON.stringify({
    misto: 'Bazoš.cz', chybi: ['b', 'w', 'nic'], smazat: ['w', 'a'], nejde: [{ id: 'b', duvod: 'Bazoš velikost nebere' }],
    web: 'https://www.bazos.cz/hodnoceni.php?idmail=1', report: 'javascript:alert(1)', poznamka: 'Vše ostatní sedí',
    opravit: [{ nazev: 'Jordan 4 Black Cat', odkaz: 'https://www.bazos.cz/inzerat/1/', inzerat: '43, 44', sklad: '44', ids: ['a', 'zadny'] }],
    neniVeSkladu: [{ nazev: 'Supreme Box Logo', odkaz: 'javascript:x', velikost: 'L' }],
    inzeratu: 50, limit: 50,
  }));
  r = await spust(['kontrola', 'k.json']);
  let v = JSON.parse(r.out.slice(0, r.out.lastIndexOf('}') + 1));
  ok('bez --odeslat nic nezapíše', zapisy.length === 0 && v.stav === 'nahled');
  ok('chybí: jen kus skladem', JSON.stringify(v.kontrola.chybi) === '["b"]', JSON.stringify(v.kontrola));
  ok('smazat: jen prodaný kus', JSON.stringify(v.kontrola.smazat) === '["w"]');
  ok('neexistující a nesedící kusy jsou v nelze', v.nelze.length === 3, JSON.stringify(v.nelze));
  ok('odkaz javascript: neprojde', v.kontrola.report === '' && v.kontrola.neniVeSkladu[0].odkaz === '' && v.pozor.length === 2, JSON.stringify(v.pozor));
  ok('opravit: jen existující id', JSON.stringify(v.kontrola.opravit[0].ids) === '["a"]', JSON.stringify(v.kontrola.opravit));
  fs.writeFileSync(path.join(tmp, 'k2.json'), JSON.stringify({ misto: 'Bazos', chybi: [] }));
  r = await spust(['kontrola', 'k2.json', '--odeslat']);
  ok('neznámé místo se odmítne a nic nezapíše', /nezname_misto/.test(r.out) && zapisy.length === 0, r.out);

  sekce('4) Kontrola a fajfky: zápis lístečku');
  r = await spust(['kontrola', 'k.json', '--odeslat']);
  ok('jeden zápis', zapisy.length === 1, r.out);
  const kontrolaZapis = zapisy[0];
  const jmeno = kontrolaZapis && kontrolaZapis.url.split('/').pop();
  ok('jen do sklad/pozadavek_… — jiný dokument pravidla čtečce nepustí',
    kontrolaZapis && kontrolaZapis.url.indexOf('/fs/users/' + UID + '/sklad/') === 0
    && /^pozadavek_[A-Za-z0-9_-]{1,60}$/.test(jmeno), kontrolaZapis && kontrolaZapis.url);
  const k = rozbal({ mapValue: { fields: kontrolaZapis.telo.fields } });
  ok('tvar jako u konektoru (kdy + kontrola)', Object.keys(k).sort().join() === 'kdy,kontrola', JSON.stringify(k));
  ok('pole kontroly jako u konektoru',
    Object.keys(k.kontrola).sort().join() === 'chybi,datum,inzeratu,limit,misto,nejde,neniVeSkladu,opravit,poznamka,report,smazat,web',
    JSON.stringify(k.kontrola));

  fs.writeFileSync(path.join(tmp, 'f.json'), JSON.stringify({ zmeny: [
    { id: 'b', platforma: 'Bazoš.cz', zaskrtnout: true },
    { id: 'a', platforma: 'Bazoš.cz', zaskrtnout: true },       // už je
    { id: 'w', platforma: 'Bazoš.sk', zaskrtnout: false },      // není skladem
    { id: 'a', platforma: 'Bazos.cz', zaskrtnout: false },      // neznámé místo
  ] }));
  r = await spust(['fajfky', 'f.json', '--odeslat']);
  ok('fajfky: jeden zápis', zapisy.length === 1, r.out);
  const fajfkyZapis = zapisy[0];
  const f = rozbal({ mapValue: { fields: fajfkyZapis.telo.fields } });
  ok('poslaná jen platná změna', JSON.stringify(f.zmeny) === JSON.stringify([{ id: 'b', platforma: 'Bazoš.cz', zaskrtnout: true }]), JSON.stringify(f));
  ok('ostatní vysvětlené v nelze', (r.out.match(/"duvod"/g) || []).length === 3, r.out);

  sekce('5) Zdroj');
  const zdroj = fs.readFileSync(SKRIPT, 'utf8');
  ok('PATCH jen v jediné zapisovací funkci, a ta pustí jen pozadavek_…', (zdroj.match(/'PATCH'/g) || []).length === 1
    && /def _zapis_dokument[\s\S]*?startswith\(POZADAVEK_PREFIX\)[\s\S]*?'PATCH'/.test(zdroj));
  ok('nic nemaže', !/'DELETE'/.test(zdroj));
  ok('jen standardní knihovna', !/^\s*(import|from)\s+(requests|google|firebase)/m.test(zdroj));
  ok('UID majitele sedí s pravidly', fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8').indexOf(UID) !== -1);

  /* Stuffsell 13. 11. 2026: Ctrl+V do skrytého pole v konzoli Windows
     nevloží text, ale znak \x16 — ten odešel jako heslo a web ho odmítl.
     Řídicí znak = „chtěl jsem vložit" → bere se schránka; BOM se ořízne. */
  sekce('5b) Heslo: Ctrl+V a schránka');
  const hesla = await new Promise(res => execFile('python3', ['-I', '-c', `
import sys, json, getpass; sys.path.insert(0, sys.argv[1]); import sklad_firestore as S
vstupy = []; S.vymaz_schranku = lambda: None
def zkus(napsano, schranka):
    getpass.getpass = lambda *a: napsano
    S.heslo_ze_schranky = lambda: S._jen_heslo(schranka)
    return list(S.zeptej_heslo(1))
print(json.dumps([zkus('\\x16', 'Tajne 123\\r\\n'), zkus('', '\\ufeffTajne123'), zkus('Napsane1', 'jine'), zkus('\\x16', '')]))
`, path.dirname(SKRIPT)], (e, out, err) => res(e ? { chyba: String(err || e) } : JSON.parse(out))));
  ok('Ctrl+V (\\x16) → vezme se schránka bez konce řádku', hesla[0] && hesla[0][0] === 'Tajne 123' && hesla[0][1] === 'ze schránky', JSON.stringify(hesla));
  ok('BOM ze schránky se ořízne', hesla[1] && hesla[1][0] === 'Tajne123', JSON.stringify(hesla[1]));
  ok('napsané heslo zůstane napsané', hesla[2] && hesla[2][0] === 'Napsane1' && hesla[2][1] === 'napsané', JSON.stringify(hesla[2]));
  ok('Ctrl+V s prázdnou schránkou nepošle \\x16', hesla[3] && hesla[3][0] === '', JSON.stringify(hesla[3]));
  ok('heslo se nikdy nevypisuje, jen počet znaků', !/print\([^)]*%s[^)]*heslo\)/.test(zdroj) && /Heslo mám \(%d znaků/.test(zdroj));

  /* ── Aplikace převezme, co Python zapsal ─────────────────────────── */
  sekce('6) Aplikace lístečky převezme');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await ctx.addInitScript((m) => localStorage.setItem('sklad_plat_groups_v1', JSON.stringify(m)), MISTA);
  await ctx.addInitScript((s) => { if (!localStorage.getItem('sklad_v3')) localStorage.setItem('sklad_v3', JSON.stringify(s)); },
    SKLAD.concat(ARCHIV));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _provedPozadavky === 'function' && Array.isArray(items) && items.length > 0, { timeout: 20000 });
  await page.waitForTimeout(400);
  const vysledek = await page.evaluate((d) => {
    window._fbDb = {}; window._fbUser = { uid: 'majitel1' };
    var smazano = [];
    window._fbFns = { doc: function () { return { cesta: [].slice.call(arguments).join('/') }; },
      deleteDoc: function (ref) { smazano.push(ref.cesta); return Promise.resolve(); } };
    _provedPozadavky({ forEach: function (cb) { d.forEach(function (x) { cb({ id: x.id, data: function () { return x.data; } }); }); } });
    var b = items.find(function (i) { return i.id === 'b'; });
    return { fajfka: (b.platforms || []).indexOf('Bazoš.cz') !== -1,
      kontroly: JSON.parse(localStorage.getItem('sklad_kontroly_v1') || '{}'), smazano: smazano };
  }, [{ id: 'pozadavek_f', data: f }, { id: jmeno, data: k }]);
  ok('fajfka z Pythonu se zaškrtla', vysledek.fajfka, JSON.stringify(vysledek));
  const kb = vysledek.kontroly['Bazoš.cz'];
  ok('kontrola je v okně Kontroly listingů', kb && JSON.stringify(kb.chybi) === '["b"]' && JSON.stringify(kb.smazat) === '["w"]', JSON.stringify(kb));
  ok('i s nejde, webem a poznámkou', kb && kb.nejde.length === 1 && kb.nejde[0].duvod === 'Bazoš velikost nebere'
    && /^https:\/\/www\.bazos\.cz/.test(kb.web) && kb.poznamka === 'Vše ostatní sedí', JSON.stringify(kb));
  ok('lístečky aplikace uklidí', vysledek.smazano.length === 2, JSON.stringify(vysledek.smazano));
  ok('opravit, není ve skladu i limit dorazily', kb && kb.opravit.length === 1 && kb.neniVeSkladu.length === 1
    && kb.inzeratu === 50 && kb.limit === 50, JSON.stringify(kb));

  /* Okno Kontroly listingů: sekce Opravit a Není ve skladu, limit
     a Opraveno / Vyřízeno po jednom inzerátu. */
  const okno = () => page.evaluate(() => {
    var ov = document.getElementById('kontrolyOv');
    return { text: ov ? ov.textContent.replace(/\s+/g, ' ') : '', plno: !!(ov && ov.querySelector('.kl-limit-plno')),
      odkaz: ov && ov.querySelector('.kl-inz a.kl-tl-odkaz') ? ov.querySelector('.kl-inz a.kl-tl-odkaz').getAttribute('href') : null,
      pocet: kontrolyPocetOtevrenych() };
  });
  await page.evaluate(() => { var ov = document.getElementById('kontrolyOv'); if (ov) ov.remove(); openKontroly('Bazoš.cz'); });
  let o = await okno();
  ok('sekce Opravit s velikostmi', /Opravit na Bazoš\.cz/.test(o.text) && /V inzerátu: 43, 44 · skladem: 44/.test(o.text), o.text.slice(0, 600));
  ok('sekce Není ve skladu', /Na Bazoš\.cz, ale není ve skladu/.test(o.text) && /Supreme Box Logo/.test(o.text), o.text.slice(0, 600));
  ok('limit 50/50 svítí', /50\/50 inzerátů/.test(o.text) && o.plno, o.text.slice(0, 300));
  ok('odkaz na inzerát', o.odkaz === 'https://www.bazos.cz/inzerat/1/', o.odkaz);
  ok('počet u tlačítka je zahrnuje', o.pocet === 4, o.pocet);   // chybí b, smazat w, opravit 1, není 1
  await page.click('#kontrolyOv .kl-inz[data-druh="opravit"] .kl-hotovo');
  await page.waitForTimeout(100);
  o = await okno();
  ok('Opraveno inzerát odklidí', !/Opravit na Bazoš/.test(o.text) && o.pocet === 3, o.text.slice(0, 300));
  ok('žádné chyby na stránce', errs.length === 0, errs.join(' | '));
  await browser.close();

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(selhalo ? '\n' + selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo' : '\nOK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})().catch(e => { console.log('ERROR: ' + (e && e.stack || e)); process.exit(1); });
