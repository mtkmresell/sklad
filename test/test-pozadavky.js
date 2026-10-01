// Test: požadavky z konektoru — zaškrtávání listingů přes chat.
//
// Konektor do skladu zapisovat NESMÍ. Do skladu zapisuje jedině aplikace;
// druhý zapisovatel by se pral s její synchronizací a neodeslaná změna by
// zmizela. Konektor proto jen položí lísteček `pozadavek_…` a aplikace ho
// ze snímku kolekce provede a smaže.
//
// Hlídají se obě půlky:
//   1.–4. konektor  — co pustí, co odmítne a kam přesně zapíše
//   5.–9. aplikace  — jak lísteček provede, čemu nevěří a co po sobě uklidí

const { chromium } = require('playwright');
const path = require('path');

let selhalo = 0, proslo = 0;
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail === undefined ? '' : ' | ' + detail)); }
}
function shoda(popis, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + '\n  čekáno: ' + sb + '\n  dostal: ' + sa); }
}
function sekce(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length))); }

/* ══════════════════════════════════════════════════════════════════════
   Konektor
══════════════════════════════════════════════════════════════════════ */
function zabal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(zabal) } };
  const f = {};
  for (const k of Object.keys(v)) f[k] = zabal(v[k]);
  return { mapValue: { fields: f } };
}
function dok(jmeno, o) {
  const f = {};
  for (const k of Object.keys(o)) f[k] = zabal(o[k]);
  return { name: jmeno, fields: f };
}

const UID = 'majitel1';
const KOL = 'projects/sklad-7eec9/databases/(default)/documents/users/' + UID + '/sklad';
const POLOZKY = [
  { id: 's1', name: 'Dunk Low Panda', category: 'sneakers', buyPrice: 2400,
    saleState: 'stock', platforms: [] },
  { id: 's2', name: 'Už na Bazoši', category: 'sneakers', buyPrice: 1000,
    saleState: 'stock', platforms: ['Bazoš.cz'] },
  { id: 'w1', name: 'Čeká na payout', category: 'sneakers', buyPrice: 5000, saleState: 'waiting' },
];

/* Místa prodeje, jak je má majitel v nastavení. Schválně se liší od
   výchozí sady: `Tuzex` si přidal sám a `Sneakysneakers` smazal.
   V cloudu je to text (syncSettings, shape 'text'), ne objekt. */
const MISTA = {
  platforms: ['StockX', 'Hypeboost'],
  eshopy: ['Pikastore', 'Purekickz', 'Tuzex'],
  local: ['Bazoš.cz', 'Vinted', 'Instagram'],
};

let nastaveniMist = MISTA;      // jde zhasnout, viz sekce 4
let volani = [];
let zapsano = [];
function odp(status, telo) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => telo, text: async () => JSON.stringify(telo) };
}
let zapisOdpoved = () => odp(200, {});
global.fetch = async function (url, opts = {}) {
  const a = String(url);
  const metoda = (opts.method || 'GET').toUpperCase();
  volani.push({ url: a, method: metoda });
  if (a.includes('signInWithPassword')) return odp(200, { idToken: 'TOKEN', localId: 'ctecka1' });
  if (a.includes(':batchGet')) {
    return odp(200, JSON.parse(opts.body).documents.map(n => {
      const id = n.split('/').pop();
      if (id === 'data') {
        return { found: dok(n, { savedAt: '2026-09-01T09:00:00Z', itemsStock: POLOZKY,
          archiveYears: [], items: [], platGroups: JSON.stringify(nastaveniMist) }) };
      }
      return { missing: n };
    }));
  }
  if (metoda === 'PATCH') {
    zapsano.push({ url: a, telo: JSON.parse(opts.body || '{}') });
    return zapisOdpoved();
  }
  if (a.includes('/sklad')) {
    return odp(200, { documents: [{ name: KOL + '/data', fields: {} }] });
  }
  return odp(404, {});
};

const ENV = { SKLAD_EMAIL: 'ctecka@sklad.local', SKLAD_HESLO: 'tajne', SKLAD_UID: UID,
  MCP_TOKEN: 'tajnytokentajnytokentajnytoken12' };

(async function () {
  const { default: worker } = await import(path.resolve(__dirname, '..', 'konektor', 'worker.js'));
  const nastroj = async (name, args) => {
    volani = []; zapsano = [];
    const r = await worker.fetch(new Request(
      'https://sklad.workers.dev/' + ENV.MCP_TOKEN + '/mcp',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name, arguments: args } }) }), ENV);
    const o = await r.json();
    let data = null;
    try { data = JSON.parse(o.result.content[0].text); } catch (e) {}
    return { data, text: o.result.content[0].text, chyba: !!o.result.isError };
  };

  sekce('1) Lísteček se uloží a nikam jinam se nesáhne');
  let v = await nastroj('sklad_listing',
    { zmeny: [{ id: 's1', platforma: 'Bazoš.cz', zaskrtnout: true }] });
  ok('požadavek se zadá', v.data && v.data.stav === 'zadano', v.text.slice(0, 200));
  shoda('a je v něm, co se má stát',
    (v.data.zadano || []).map(z => z.id + '/' + z.platforma + '/' + z.zaskrtnout),
    ['s1/Bazoš.cz/true']);
  /* Do skladu konektor nezapisuje. Jediný zápis smí mířit na dokument
     s tím jménem — na `data` by čtečka stejně neprošla přes pravidla,
     ale chyba by se pak hledala u nich místo tady. */
  shoda('zapsal se právě jeden dokument', zapsano.length, 1);
  ok('a jmenuje se pozadavek_…', /\/sklad\/pozadavek_[A-Za-z0-9_-]+$/.test(zapsano[0].url),
    zapsano[0].url);
  ok('rozhodně ne data ani archiv',
    !/\/sklad\/(data|cache|sold_|photo_)/.test(zapsano[0].url), zapsano[0].url);
  /* Odpověď nesmí slibovat, že je hotovo — provede to až aplikace. */
  ok('a neslibuje se, že je to hotové',
    /aplikace/.test(v.data.poznamka || '') && !/hotovo/i.test(v.data.poznamka || ''),
    v.data.poznamka);

  sekce('2) Co nedává smysl, se pozná hned');
  const nelze = async (zmena) => {
    const r = await nastroj('sklad_listing', { zmeny: [zmena] });
    return { stav: r.data && r.data.stav, duvod: ((r.data && r.data.nelze) || [])[0],
      zapsano: zapsano.length };
  };
  let n = await nelze({ id: 's1', platforma: 'Neexistuje' });
  ok('neznámé místo prodeje neprojde', n.stav === 'nic_k_provedeni'
    && /v nastavení není/.test((n.duvod || {}).duvod || ''), JSON.stringify(n));
  ok('a nic se nezapíše', n.zapsano === 0, String(n.zapsano));
  /* Bez výpisu se „to místo nemáš" nedá odlišit od „opsaný seznam ho
     nezná" — a právě to tuhle chybu posledně schovalo. */
  shoda('a rovnou se vypíše, co v nastavení je',
    ((n.duvod || {}).mista_v_nastaveni || []).includes('Tuzex'), true);

  n = await nelze({ id: 'neni', platforma: 'Vinted' });
  ok('kus, který ve skladu není, taky ne',
    /ve skladu není/.test((n.duvod || {}).duvod || ''), JSON.stringify(n));

  n = await nelze({ id: 'w1', platforma: 'Vinted' });
  ok('a kus, který není na skladě, taky ne',
    /není na skladě/.test((n.duvod || {}).duvod || ''), JSON.stringify(n));

  n = await nelze({ id: 's2', platforma: 'Bazoš.cz', zaskrtnout: true });
  ok('co už zaškrtnuté je, se neposílá znovu',
    /už je zaškrtnuté/.test((n.duvod || {}).duvod || ''), JSON.stringify(n));
  ok('a nezapíše se kvůli tomu lísteček', n.zapsano === 0, String(n.zapsano));

  const mnoho = [];
  for (let i = 0; i < 250; i++) mnoho.push({ id: 's1', platforma: 'Vinted' });
  v = await nastroj('sklad_listing', { zmeny: mnoho });
  ok('a hromada změn naráz se zarazí', v.data && v.data.stav === 'moc_zmen', v.text.slice(0, 160));
  ok('a taky nic nezapíše', zapsano.length === 0, String(zapsano.length));

  v = await nastroj('sklad_listing', { zmeny: [] });
  ok('prázdné zadání se nevydává za hotovo', v.data && v.data.stav === 'nic', v.text.slice(0, 160));

  sekce('3) Stará pravidla v konzoli se pojmenují');
  /* 403 tu znamená jedinou konkrétní věc: v konzoli Firebase leží znění
     bez `jePozadavekCtecky`. Bez pojmenování by se to hledalo hodinu. */
  zapisOdpoved = () => odp(403, { error: { message: 'Missing or insufficient permissions.' } });
  v = await nastroj('sklad_listing', { zmeny: [{ id: 's1', platforma: 'Vinted' }] });
  ok('odmítnutý zápis se ohlásí', v.chyba || /403/.test(v.text), v.text.slice(0, 200));
  ok('a rovnou se řekne, že jde o stará pravidla',
    /firestore\.rules|jePozadavekCtecky/.test(v.text), v.text.slice(0, 260));
  zapisOdpoved = () => odp(200, {});

  sekce('4) Místa prodeje se čtou z nastavení, ne ze seznamu v kódu');
  /* Tohle je ta chyba, kterou předchozí verze testu propustila: hlídala,
     že se dvě kopie seznamu v kódu nerozejdou — jenže obě byly špatně.
     Majitel si v aplikaci přidal `Tuzex`, `Cardmarket` a `Instagram`,
     opsaný seznam je neznal a lísteček s nimi se zahodil. V chatu to
     vypadalo, že takové místo prodeje vůbec neexistuje. Porovnávat dvě
     kopie nestačí — ověřuje se, že žádná není. */
  v = await nastroj('sklad_listing', { zmeny: [{ id: 's1', platforma: 'Tuzex' }] });
  ok('místo přidané majitelem projde', v.data && v.data.stav === 'zadano', v.text.slice(0, 200));
  shoda('a v lístečku je', (v.data.zadano || []).map(z => z.platforma), ['Tuzex']);

  /* Druhý směr: co majitel smazal, platit přestane. Výchozí sada tohle
     místo má, takže kdyby se ověřovalo proti ní, prošlo by. */
  n = await nelze({ id: 's1', platforma: 'Sneakysneakers' });
  ok('a smazané místo už neprojde, i když je ve výchozí sadě',
    /v nastavení není/.test((n.duvod || {}).duvod || ''), JSON.stringify(n));

  /* Žádný seznam míst prodeje nesmí v kódu zůstat — ani v konektoru,
     ani v aplikaci. Jediná povolená kopie je výchozí sada pro první
     spuštění, a ta bydlí v `getDefaultGroups()`. */
  const zdrojW = require('fs').readFileSync(
    path.resolve(__dirname, '..', 'konektor', 'worker.js'), 'utf8');
  const zdrojA = require('fs').readFileSync(
    path.resolve(__dirname, '..', 'index.html'), 'utf8');
  ok('konektor žádný seznam míst neopisuje', !/const PLATFORMY\s*=\s*\[/.test(zdrojW));
  ok('a aplikace taky ne', !/const PLATFORMS\s*=\s*\[/.test(zdrojA));
  /* `Sneakysneakers` je v aplikaci jen ve výchozí sadě. Kdyby se objevilo
     i jinde, je to další opsaná kopie. */
  shoda('jediná kopie v aplikaci je getDefaultGroups()',
    (zdrojA.match(/'Sneakysneakers'/g) || []).length, 1);

  /* Bez nastavení se neodmítá po jednom „tohle místo neznám" — to je
     přesně ta hláška, která chybu posledně zamaskovala. */
  nastaveniMist = {};
  v = await nastroj('sklad_listing', { zmeny: [{ id: 's1', platforma: 'Vinted' }] });
  ok('a když nastavení v cloudu chybí, řekne se to naplno',
    v.data && v.data.stav === 'nezname_mista', v.text.slice(0, 200));
  ok('a nic se nezapíše', zapsano.length === 0, String(zapsano.length));
  nastaveniMist = MISTA;

  /* ══════════════════════════════════════════════════════════════════
     Aplikace
  ══════════════════════════════════════════════════════════════════ */
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  /* Táž místa jako u konektoru — `Tuzex` navíc, `Sneakysneakers` pryč. */
  await ctx.addInitScript((m) => localStorage.setItem('sklad_plat_groups_v1',
    JSON.stringify(m)), MISTA);
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), [
    { id: 'a', name: 'Boty', category: 'sneakers', condition: 'DS', buyPrice: 1000,
      saleState: 'stock', location: 'Doma', dateAdded: 1, platforms: [], tags: [] },
    { id: 'vadny', name: 'Vadné boty', category: 'sneakers', condition: 'poskozene',
      buyPrice: 1000, saleState: 'stock', location: 'Doma', dateAdded: 2, platforms: [], tags: [] },
    { id: 'ceka', name: 'Čeká', category: 'sneakers', condition: 'DS', buyPrice: 1000,
      saleState: 'waiting', location: 'Doma', dateAdded: 3, platforms: [], tags: [] },
  ]);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'),
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _provedPozadavky === 'function'
    && Array.isArray(items) && items.length > 0, { timeout: 20000 });

  /* Snímek kolekce předstíráme — `forEach` s `id` a `data()` je všechno,
     co `_provedPozadavky` ze snímku potřebuje. Mazání se jen zaznamená. */
  await page.evaluate(() => {
    window.__smazano = [];
    window._fbDb = {};
    window._fbUser = { uid: 'majitel1' };
    window._fbFns = {
      doc: function () { return { cesta: [].slice.call(arguments).join('/') }; },
      deleteDoc: function (ref) { window.__smazano.push(ref.cesta); return Promise.resolve(); },
    };
    window.__snimek = function (dokumenty) {
      return { forEach: function (cb) {
        dokumenty.forEach(function (d) { cb({ id: d.id, data: function () { return d.data; } }); });
      } };
    };
  });

  const proved = (dokumenty) => page.evaluate((d) => {
    window.__smazano = [];
    _provedPozadavky(window.__snimek(d));
    return { plat: items.reduce(function (o, it) { o[it.id] = (it.platforms || []).slice(); return o; }, {}),
      smazano: window.__smazano };
  }, dokumenty);

  sekce('5) Lísteček aplikace provede a uklidí');
  let r = await proved([{ id: 'pozadavek_x1', data: { kdy: new Date().toISOString(),
    zmeny: [{ id: 'a', platforma: 'Vinted', zaskrtnout: true }] } }]);
  shoda('fajfka naskočí', r.plat.a, ['Vinted']);
  ok('a lísteček se smaže', r.smazano.some(c => /pozadavek_x1/.test(c)), JSON.stringify(r.smazano));

  r = await proved([{ id: 'pozadavek_x2', data: { kdy: new Date().toISOString(),
    zmeny: [{ id: 'a', platforma: 'Vinted', zaskrtnout: false }] } }]);
  shoda('a odškrtnout jde taky', r.plat.a, []);

  /* Tohle je ten nahlášený případ: `Tuzex` si majitel přidal sám, takže
     v žádném seznamu v kódu není. Aplikace ho bere z `platGroups`. */
  r = await proved([{ id: 'pozadavek_tuzex', data: { kdy: new Date().toISOString(),
    zmeny: [{ id: 'a', platforma: 'Tuzex', zaskrtnout: true }] } }]);
  shoda('a místo, které si majitel přidal sám, taky', r.plat.a, ['Tuzex']);
  r = await proved([{ id: 'pozadavek_tuzex2', data: { kdy: new Date().toISOString(),
    zmeny: [{ id: 'a', platforma: 'Tuzex', zaskrtnout: false }] } }]);
  shoda('a jde i odškrtnout', r.plat.a, []);

  /* Opačný směr — co majitel smazal, se neprovede, i když to výchozí
     sada má. Jinak by fajfka naskočila u místa, které v nabídkách není. */
  r = await proved([{ id: 'pozadavek_smazane', data: { kdy: new Date().toISOString(),
    zmeny: [{ id: 'a', platforma: 'Sneakysneakers', zaskrtnout: true }] } }]);
  shoda('smazané místo se neprovede ani v aplikaci', r.plat.a, []);

  sekce('6) Brány aplikace platí i pro lísteček');
  /* Jde to přes `togglePlatItem`, takže poškozený kus se na komisi
     nedostane ani odsud. Druhá kopie těch pravidel by se rozešla
     a požadavek z chatu by uměl víc než klik myší. */
  r = await proved([{ id: 'pozadavek_x3', data: { kdy: new Date().toISOString(),
    zmeny: [{ id: 'vadny', platforma: 'Pikastore', zaskrtnout: true }] } }]);
  shoda('poškozený kus se na komisi nedostane', r.plat.vadny, []);
  ok('a lísteček se stejně smaže', r.smazano.some(c => /pozadavek_x3/.test(c)),
    JSON.stringify(r.smazano));

  r = await proved([{ id: 'pozadavek_x4', data: { kdy: new Date().toISOString(),
    zmeny: [{ id: 'ceka', platforma: 'Vinted', zaskrtnout: true }] } }]);
  shoda('kus mimo sklad se nechá být', r.plat.ceka, []);

  sekce('7) Co přijde po síti, se nebere jak leží');
  /* Dokument přijde po síti, takže se z něj bere jen dohodnutá hrstka
     polí. Zkouší se rovnou filtr — přes výsledek by prošla i sabotáž,
     která do seznamu pustí zmetek, co pak stejně nikam nedosedne. */
  const filtr = await page.evaluate(() => _pozadavekZmeny({ zmeny: [
    { id: 'a', platforma: 'Vinted', zaskrtnout: true, navic: 'tohle se zahodí' },
    { id: 'a', platforma: 'Neexistuje', zaskrtnout: true },
    { id: 'a', platforma: '<img src=x>', zaskrtnout: true },
    { platforma: 'Vinted', zaskrtnout: true },          // bez id
    { id: 123, platforma: 'Vinted', zaskrtnout: true }, // id není text
    { id: 'a', zaskrtnout: true },                      // bez platformy
    { id: 'b', platforma: 'Bazoš.cz', zaskrtnout: false },
  ] }));
  shoda('projde jen dohodnutý tvar a nic navíc', filtr, [
    { id: 'a', platforma: 'Vinted', zaskrtnout: true },
    { id: 'b', platforma: 'Bazoš.cz', zaskrtnout: false },
  ]);
  const kolik = await page.evaluate(() => {
    const zmeny = [];
    for (let i = 0; i < POZADAVEK_NEJVIC + 50; i++) zmeny.push({ id: 'a', platforma: 'Vinted' });
    return { delka: _pozadavekZmeny({ zmeny }).length, strop: POZADAVEK_NEJVIC };
  });
  shoda('a nekonečný lísteček se usekne', kolik.delka, kolik.strop);

  r = await proved([{ id: 'pozadavek_x5', data: { kdy: new Date().toISOString(), zmeny: [
    { id: 'a', platforma: 'Neexistuje', zaskrtnout: true },
    { id: 'neni', platforma: 'Vinted', zaskrtnout: true },
    { platforma: 'Vinted', zaskrtnout: true },
  ] } }]);
  shoda('neznámá platforma ani chybějící id nic nezapíšou', r.plat.a, []);

  r = await proved([{ id: 'pozadavek_x6', data: { zmeny: 'tohle není pole' } },
    { id: 'pozadavek_x7', data: {} }]);
  ok('rozbitý lísteček aplikaci neshodí a smaže se',
    r.smazano.length === 2, JSON.stringify(r.smazano));

  sekce('8) Starý lísteček se neprovádí');
  /* Kdyby aplikace týden neběžela, je sklad mezitím jinde a fajfka by
     dosedla na stav, na který se ten požadavek vůbec nevztahoval. */
  const pred10dny = new Date(Date.now() - 10 * 86400000).toISOString();
  r = await proved([{ id: 'pozadavek_stary', data: { kdy: pred10dny,
    zmeny: [{ id: 'a', platforma: 'Vinted', zaskrtnout: true }] } }]);
  shoda('deset dní starý požadavek se neprovede', r.plat.a, []);
  ok('ale uklidí se, ať nechodí dokola',
    r.smazano.some(c => /pozadavek_stary/.test(c)), JSON.stringify(r.smazano));

  sekce('9) Účetní listingy neřídí');
  const uc = await page.evaluate(() => {
    _uctetniRezim = true;
    window.__smazano = [];
    _provedPozadavky(window.__snimek([{ id: 'pozadavek_u1',
      data: { kdy: new Date().toISOString(),
        zmeny: [{ id: 'a', platforma: 'Vinted', zaskrtnout: true }] } }]));
    const out = { plat: (items.find(i => i.id === 'a').platforms || []).slice(),
      smazano: window.__smazano.length };
    _uctetniRezim = false;
    return out;
  });
  shoda('v pohledu účetního se nezapíše nic', uc.plat, []);
  ok('a nic se ani nemaže', uc.smazano === 0, String(uc.smazano));

  ok('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(selhalo ? '\n' + selhalo + ' z ' + (selhalo + proslo) + ' kontrol selhalo'
    : '\nOK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
