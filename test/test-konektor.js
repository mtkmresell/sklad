// Konektor (konektor/worker.js) — protokol MCP i data, bez sítě a bez nasazení.
// Firestore nahrazuje podstrčený fetch, Worker se volá přímo jako funkce.

const path = require('path');

let selhalo = 0, proslo = 0;
function ok(popis, podminka) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis); }
}
function shoda(popis, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + '\n  čekáno: ' + sb + '\n  dostal: ' + sa); }
}

/* ── Falešný Firestore ──────────────────────────────────────────────── */
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

const POLOZKY_SKLAD = [
  { id: 's1', name: 'Dunk Low Panda', sku: 'DD1391', category: 'sneakers', buyPrice: 2400, saleState: 'stock', platforms: ['Bazoš.cz'], imgUrl: 'data:image/jpeg;base64,AAAA' },
  { id: 's2', name: 'Pikachu VMAX', category: 'pokemon', buyPrice: 850, saleState: 'stock', personal: true, tags: ['karty'] },
  { id: 's3', name: 'LEGO Titanic', category: 'lego', buyPrice: 3200, saleState: 'stock', platforms: ['Vinted'] },
  { id: 'w1', name: 'Jordan 4 Bred', category: 'sneakers', buyPrice: 5000, saleState: 'waiting' },
];
const POLOZKY_2025 = [
  { id: 'p1', name: 'Jordan 1 Chicago', category: 'sneakers', buyPrice: 5200, sellPrice: 8900, saleState: 'paid', payoutDate: '2025-06-01' },
];
const POLOZKY_2026 = [
  { id: 'p2', name: 'Yeezy Slide', category: 'sneakers', buyPrice: 1800, sellPrice: 2600, saleState: 'paid', payoutDate: '2026-02-11' },
];

const DOKUMENTY = {
  data: { savedAt: '2026-08-01T09:30:00Z', itemsStock: POLOZKY_SKLAD, archiveYears: ['2025', '2026'], items: [] },
  sold_2025: { items: POLOZKY_2025 },
  sold_2026: { items: POLOZKY_2026 },
  cache: { 'name:dunk low panda': { sku: 'DD1391' } },
  photo_s1: { data: 'data:image/jpeg;base64,' + 'A'.repeat(3000) },
};

let volani = [];
function odp(status, telo) {
  return { ok: status >= 200 && status < 300, status, json: async () => telo, text: async () => JSON.stringify(telo) };
}
global.fetch = async function (url, opts = {}) {
  const a = String(url);
  volani.push({ url: a, method: (opts.method || 'GET').toUpperCase() });
  if (a.includes('signInWithPassword')) return odp(200, { idToken: 'TOKEN', localId: 'ctecka1' });
  if (a.includes(':batchGet')) {
    return odp(200, JSON.parse(opts.body).documents.map(n => {
      const id = n.split('/').pop();
      return DOKUMENTY[id] ? { found: dok(n, DOKUMENTY[id]) } : { missing: n };
    }));
  }
  if (a.includes('/crm/main')) {
    return odp(200, dok('crm/main', {
      customers: [{ id: 'c1', name: 'Petr Novák', phone: '777123456' }, { id: 'c2', name: 'Jana Malá' }],
      partners: [{ id: 'pa1', name: 'Bazar Brno' }],
    }));
  }
  if (a.includes('/sklad')) {
    return odp(200, { documents: Object.keys(DOKUMENTY).map(id => ({ name: KOL + '/' + id, fields: {} })) });
  }
  return odp(404, {});
};

const ENV = { SKLAD_EMAIL: 'ctecka@sklad.local', SKLAD_HESLO: 'tajne', SKLAD_UID: UID, MCP_TOKEN: 'tajnytokentajnytokentajnytoken12' };

function pozadavek(cesta, telo, metoda = 'POST') {
  return new Request('https://sklad.workers.dev' + cesta, {
    method: metoda,
    headers: { 'Content-Type': 'application/json' },
    body: metoda === 'POST' ? JSON.stringify(telo) : undefined,
  });
}

(async function () {
  const { default: worker } = await import(path.resolve(__dirname, '..', 'konektor', 'worker.js'));
  const CESTA = '/' + ENV.MCP_TOKEN + '/mcp';
  const posli = async (telo, cesta = CESTA, metoda = 'POST') =>
    worker.fetch(pozadavek(cesta, telo, metoda), ENV);
  const rpc = async (method, params, id = 1) => (await (await posli({ jsonrpc: '2.0', id, method, params })).json());
  const nastroj = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r.result.content[0].text;
    // Chybová hláška je prostý text, ne JSON — nesmí shodit test
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    return { syrove: r, data, text, chyba: !!r.result.isError };
  };

  /* ── Zámek na veřejné adrese ──────────────────────────────────────── */
  ok('bez tokenu 404', (await posli({ jsonrpc: '2.0', id: 1, method: 'initialize' }, '/mcp')).status === 404);
  ok('se špatným tokenem 404', (await posli({}, '/spatnytoken/mcp')).status === 404);
  ok('token správné délky, ale jiný, taky 404',
    (await posli({}, '/' + 'x'.repeat(ENV.MCP_TOKEN.length) + '/mcp')).status === 404);
  ok('správný token, ale jiná cesta 404', (await posli({}, '/' + ENV.MCP_TOKEN + '/neco')).status === 404);
  /* ── Zkouška z prohlížeče ─────────────────────────────────────────
     Prohlížeč umí jen GET, a tohle je jediný způsob, jak si uživatel
     ověří adresu, aniž by komukoli poslal token. Odpověď proto musí
     říct, co se děje. */
  const gettem = await posli(null, CESTA, 'GET');
  ok('GET nedostane data (405)', gettem.status === 405);
  const gettelo = await gettem.json();
  ok('ale řekne, že konektor běží', gettelo.stav === 'ok');
  ok('a poradí, co dál', /konektor/i.test(gettelo.zprava || ''));

  const bezNastaveni = await worker.fetch(pozadavek(CESTA, {}), { MCP_TOKEN: ENV.MCP_TOKEN });
  ok('bez přihlašovacích údajů 500', bezNastaveni.status === 500);
  const bezTelo = await bezNastaveni.json();
  shoda('a vyjmenuje, co chybí', bezTelo.chybi, ['SKLAD_EMAIL', 'SKLAD_HESLO', 'SKLAD_UID']);

  // Chybějící tajemství se musí poznat i z prohlížeče, tedy přes GET
  const bezNastaveniGet = await worker.fetch(
    new Request('https://sklad.workers.dev' + CESTA, { method: 'GET' }), { MCP_TOKEN: ENV.MCP_TOKEN });
  ok('chybějící tajemství přebijí i GET', bezNastaveniGet.status === 500);
  ok('a vypíšou se', (await bezNastaveniGet.json()).stav === 'nenastaveno');

  const jenJedno = await worker.fetch(pozadavek(CESTA, {}),
    { MCP_TOKEN: ENV.MCP_TOKEN, SKLAD_EMAIL: 'a@b.cz', SKLAD_HESLO: 'x' });
  shoda('hlásí se jen to, co opravdu chybí', (await jenJedno.json()).chybi, ['SKLAD_UID']);

  // Bez tokenu se nesmí prozradit ani to, že tajemství chybí
  const bezTokenuBezNastaveni = await worker.fetch(
    new Request('https://sklad.workers.dev/spatny/mcp', { method: 'GET' }), { MCP_TOKEN: ENV.MCP_TOKEN });
  ok('špatný token mlčí i o nastavení', bezTokenuBezNastaveni.status === 404);

  /* ── Protokol ─────────────────────────────────────────────────────── */
  const init = await rpc('initialize', { protocolVersion: '2026-07-28', capabilities: {} });
  shoda('initialize vrátí vyžádanou verzi', init.result.protocolVersion, '2026-07-28');
  ok('hlásí nástroje', !!init.result.capabilities.tools);
  ok('má jméno serveru', init.result.serverInfo.name === 'sklad');
  ok('posílá instrukce ke kurzům', /kurz/i.test(init.result.instructions || ''));

  const initStara = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  shoda('starší klient dostane svoji verzi', initStara.result.protocolVersion, '2025-06-18');

  ok('oznámení se nepotvrzuje (202)',
    (await posli({ jsonrpc: '2.0', method: 'notifications/initialized' })).status === 202);
  ok('ping odpoví', (await rpc('ping', {})).result !== undefined);
  ok('neznámá metoda vrátí -32601', (await rpc('neco/divneho', {})).error.code === -32601);

  const spatnyJson = await worker.fetch(
    new Request('https://sklad.workers.dev' + CESTA, { method: 'POST', body: '{tohle není json' }), ENV);
  ok('rozbitý JSON vrátí 400', spatnyJson.status === 400);

  const davka = await (await posli([
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ])).json();
  ok('dávka vrátí dvě odpovědi', Array.isArray(davka) && davka.length === 2);

  /* ── Seznam nástrojů ──────────────────────────────────────────────── */
  const seznam = (await rpc('tools/list')).result.tools;
  shoda('nástroje', seznam.map(t => t.name).sort(),
    ['sklad_polozky', 'sklad_prodeje', 'sklad_souhrn', 'sklad_zakaznici']);
  ok('každý nástroj má popis', seznam.every(t => t.description && t.description.length > 30));
  ok('každý nástroj má schéma', seznam.every(t => t.inputSchema && t.inputSchema.type === 'object'));
  ok('u zákazníků je varování na osobní údaje',
    /osobní údaje/i.test(seznam.find(t => t.name === 'sklad_zakaznici').description));

  /* ── Souhrn ───────────────────────────────────────────────────────── */
  const s = (await nastroj('sklad_souhrn', {})).data;
  shoda('na skladě', s.naSklade, 3);
  shoda('čeká', s.cekaNaPayout, 1);
  shoda('prodáno (oba archivy)', s.prodano, 2);
  shoda('celkem', s.celkem, 6);
  shoda('osobní', s.osobni, 1);
  shoda('podnikání', s.podnikani, 5);
  shoda('zákazníků', s.zakazniku, 2);
  shoda('prodeje po letech', s.prodejePoLetech, { 2025: 1, 2026: 1 });
  shoda('sklad po kategoriích', s.naSkladePodleKategorii, { sneakers: 1, pokemon: 1, lego: 1 });

  /* ── Položky ──────────────────────────────────────────────────────── */
  const vychozi = (await nastroj('sklad_polozky', {})).data;
  shoda('výchozí stav je sklad', vychozi.polozky.map(i => i.id), ['s1', 's2', 's3']);

  shoda('filtr waiting', (await nastroj('sklad_polozky', { stav: 'waiting' })).data.polozky.map(i => i.id), ['w1']);
  shoda('filtr vse', (await nastroj('sklad_polozky', { stav: 'vse' })).data.celkem, 6);
  shoda('filtr osobní', (await nastroj('sklad_polozky', { profil: 'osobni' })).data.polozky.map(i => i.id), ['s2']);
  shoda('filtr kategorie', (await nastroj('sklad_polozky', { kategorie: 'lego' })).data.polozky.map(i => i.id), ['s3']);
  shoda('filtr platformy', (await nastroj('sklad_polozky', { platforma: 'bazoš' })).data.polozky.map(i => i.id), ['s1']);
  shoda('hledání podle SKU', (await nastroj('sklad_polozky', { hledat: 'DD1391' })).data.polozky.map(i => i.id), ['s1']);
  shoda('hledání podle štítku', (await nastroj('sklad_polozky', { hledat: 'karty' })).data.polozky.map(i => i.id), ['s2']);
  shoda('výběr sloupců', (await nastroj('sklad_polozky', { kategorie: 'lego', pole: ['name', 'buyPrice'] })).data.polozky,
    [{ name: 'LEGO Titanic', buyPrice: 3200 }]);

  const omezene = (await nastroj('sklad_polozky', { limit: 2 })).data;
  shoda('limit ořízne', omezene.vraceno, 2);
  shoda('ale hlásí celkový počet', omezene.celkem, 3);
  ok('a upozorní, že je toho víc', /Vráceno prvních/.test(omezene.poznamka || ''));

  /* ── Fotky ────────────────────────────────────────────────────────── */
  const sFotkou = (await nastroj('sklad_polozky', { hledat: 'Dunk' })).data.polozky[0];
  ok('base64 fotka se nevrací', sFotkou.imgUrl === undefined);
  ok('zůstane jen značka', sFotkou.maFotku === 1);

  /* ── Prodeje ──────────────────────────────────────────────────────── */
  shoda('prodeje bez roku', (await nastroj('sklad_prodeje', {})).data.polozky.map(i => i.id), ['p1', 'p2']);
  shoda('prodeje 2026', (await nastroj('sklad_prodeje', { rok: '2026' })).data.polozky.map(i => i.id), ['p2']);

  /* ── Zákazníci ────────────────────────────────────────────────────── */
  const crm = (await nastroj('sklad_zakaznici', {})).data;
  shoda('počet zákazníků', crm.zakazniku, 2);
  shoda('počet partnerů', crm.partneru, 1);
  shoda('hledání zákazníka', (await nastroj('sklad_zakaznici', { hledat: 'novák' })).data.zakaznici.map(z => z.id), ['c1']);

  /* ── Chyby nástroje ───────────────────────────────────────────────── */
  const zly = await nastroj('sklad_neexistuje', {});
  ok('neznámý nástroj se hlásí jako chyba výsledku', zly.chyba === true);
  ok('a ne jako chyba protokolu', zly.syrove.error === undefined);

  /* ── Nic se nezapisuje ────────────────────────────────────────────── */
  // Do Firestore smí jen čtení. POST je tam legitimní jen u :batchGet
  // (hromadné čtení) a u přihlášení — všechno ostatní by byl zápis.
  const doFirestore = volani.filter(v => /firestore\.googleapis\.com|identitytoolkit/.test(v.url));
  const zapisy = doFirestore.filter(v =>
    ['PATCH', 'PUT', 'DELETE'].includes(v.method) ||
    (v.method === 'POST' && !v.url.includes(':batchGet') && !v.url.includes('signIn')));
  shoda('žádný zápisový požadavek do Firestore', zapisy.map(v => v.method + ' ' + v.url), []);

  // Kam všude Worker vůbec sahá. Kdyby přibyla další adresa, ať se o tom ví.
  const hostitele = [...new Set(volani.map(v => new URL(v.url).host))].sort();
  shoda('Worker mluví jen s Googlem', hostitele,
    ['firestore.googleapis.com', 'identitytoolkit.googleapis.com']);

  const zdroj = require('fs').readFileSync(path.resolve(__dirname, '..', 'konektor', 'worker.js'), 'utf8');
  ok('žádný commit', !/documents:commit/.test(zdroj));
  ok('žádný PATCH', !/['"]PATCH['"]/.test(zdroj));
  ok('žádný DELETE', !/['"]DELETE['"]/.test(zdroj));

  /* Do logu Workeru nesmí spadnout nic tajného. Dřív se to hlídalo tím,
     že se console nesměla použít vůbec — jenže cron bez logu je němý:
     když se upozornění neodešle, nikdo se to nedozví. Tak se místo toho
     kontroluje, co se do logu předává. */
  const konzole = zdroj.match(/console\.(log|error|warn)\([^\n]*/g) || [];
  const podezrele = konzole.filter(r => /env\.|token|heslo|api_key|password/i.test(r));
  shoda('do logu nejde nic tajného', podezrele, []);
  ok('cron má log, aby nebyl němý', konzole.length > 0);

  console.log(selhalo ? selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo' : 'OK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})().catch(e => { console.log('ERROR: ' + (e && e.stack || e)); process.exit(1); });
