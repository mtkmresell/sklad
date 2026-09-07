// Napojení na komisní prodej Pikastore (ConsignThem API) v konektoru.
//
// Jejich API je podstrčené — nic neodchází ven a nic se u nich nemění.
// Testuje se to, na čem se dá tiše pohořet:
//
//   · peníze chodí v celých centech a výdělek se počítá z dohodnuté
//     ceny, ne z ceny na pultě (během slevy je zvednutá),
//   · pole je pod `data`; kdo sáhne po `items`, dostane nula řádků
//     a žádnou chybu — sync by pak tvrdil, že u nich nic nevisí,
//   · neplatný token se pozná a nezkouší se dokola; API totiž po pár
//     odmítnutích přestane vracet 401 a začne vracet 429, což svádí
//     hledat chybu v tempu volání,
//   · 429 od nás a 429 kvůli cizímu provozu jsou dvě různé věci.

const path = require('path');

let selhalo = 0, proslo = 0;
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail === undefined ? '' : '\n  ' + detail)); }
}
function shoda(popis, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + '\n  čekáno: ' + sb + '\n  dostal: ' + sa); }
}
function sekce(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length))); }

/* ── Falešný Firestore (stejný trik jako v test-upozorneni.js) ──────── */
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

const ENV = {
  SKLAD_EMAIL: 'a@b.cz', SKLAD_HESLO: 'x', SKLAD_UID: 'u1',
  MCP_TOKEN: 'tajny-token-do-adresy', CONSIGNTHEM_TOKEN: 'pika-tajny-klic',
};

// Sklad: co má viset a co ne
const POLOZKY = [
  { id: '1', name: 'Nike Dunk Low', sku: 'DD1391-100', size: '43', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 4500 },
  { id: '2', name: 'Osobní kousek', sku: 'AA-1', size: '44', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 3000, personal: true },
  { id: '3', name: 'U komisáře', sku: 'BB-2', size: '45', category: 'sneakers',
    saleState: 'stock', location: 'Section', targetPrice: 6000 },
  { id: '4', name: 'Ještě nedorazilo', sku: 'CC-3', size: '42', category: 'sneakers',
    saleState: 'stock', location: 'Na cestě', targetPrice: 2000 },
  { id: '5', name: 'Pokémon box', sku: 'PKM-1', size: '', category: 'pokemon',
    saleState: 'stock', location: 'Doma', targetPrice: 9000 },
  { id: '6', name: 'Tričko bez cílovky', sku: '', size: 'M', category: 'obleceni',
    saleState: 'stock', location: 'Doma' },
  { id: '7', name: 'Už se prodalo', sku: 'DD-4', size: '41', category: 'sneakers',
    saleState: 'waiting', location: 'Doma', targetPrice: 5000 },
  { id: '8', name: 'Eurová cílovka', sku: 'EE-5', size: '46', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 4750, targetCurrency: 'EUR', targetPriceEur: 190 },
];

// Co u nich visí. Dunk sedí cenou, „U komisáře" má jinou, jeden je navíc a jeden prodaný.
const VYPIS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', short_id: 'L-1', sku: 'DD1391-100', size: '43',
    condition: 'DS', status: 'listed', price_cents: 450000, payout_basis_cents: null,
    commission_rate_bp: 2500, updated_at: '2026-09-01T10:00:00.000Z' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', short_id: 'L-2', sku: 'BB-2', size: '45',
    condition: 'DS', status: 'listed', price_cents: 700000, payout_basis_cents: 600000,
    commission_rate_bp: 2500, updated_at: '2026-09-01T10:00:00.000Z' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', short_id: 'L-3', sku: 'ZZ-9', size: '40',
    condition: 'DS', status: 'listed', price_cents: 100000, payout_basis_cents: null,
    commission_rate_bp: 2500, updated_at: '2026-09-01T10:00:00.000Z' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000004', short_id: 'L-4', sku: 'YY-8', size: '39',
    condition: 'DS', status: 'sold', price_cents: 250000, payout_basis_cents: null,
    updated_at: '2026-09-02T08:00:00.000Z' },
];

const ME = {
  type: 'seller',
  store: { id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'Pikastore', slug: 'pikastore' },
  consigner: { id: 123, display_name: 'Michal', status: 'active', payout_currency: 'CZK' },
  active_sale: null,
  capabilities: ['listings:read', 'listings:write', 'sales:read'],
};

(async function () {
  const { default: worker } = await import(path.resolve(__dirname, '..', 'konektor', 'worker.js'));
  const puvodniFetch = global.fetch;
  const puvodniLog = console.log, puvodniErr = console.error;

  let volani = [];          // co všechno odešlo
  let pikaOdpovedi = null;  // scénář pro /listings a /me
  /* Falešný katalog. Ve výchozím stavu najde všechno — kus se musí
     vystavit přes master_product_id, jinak u nich nemá fotku ani SKU. */
  let katalogNajde = true;
  let katalogShod = 1;      // kolik řádků vrátí hledání podle názvu
  function katalogOdpoved(url, init) {
    if (url.includes('/master-products/resolve-skus')) {
      const skus = JSON.parse((init && init.body) || '{}').skus || [];
      const mapa = {};
      if (katalogNajde) skus.forEach(x => { mapa[x] = 'mp-' + String(x).toLowerCase(); });
      return Response.json({ data: mapa });
    }
    if (url.includes('/master-products')) {
      const q = new URL(url).searchParams.get('q') || '';
      const radky = [];
      if (katalogNajde) {
        for (let i = 0; i < katalogShod; i++) {
          radky.push({ id: 'mp-nazev-' + i, sku: null, name: q,
            primary_photo_url: 'https://x/' + i + '.jpg' });
        }
      }
      return Response.json({ data: radky, page: 1, page_size: 20, total: radky.length });
    }
    return null;
  }
  let cnbOdpoved = () => new Response('03.09.2026 #170\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|25,000\n');

  let odpovezSklad = function (url) {
    if (url.includes('identitytoolkit')) return Response.json({ idToken: 't', localId: 'u1' });
    if (url.includes(':batchGet')) {
      return Response.json([{ found: dok('users/u1/sklad/data', {
        savedAt: '2026-09-03T06:00:00.000Z', items: POLOZKY,
      }) }]);
    }
    if (url.includes('/sklad?') || url.endsWith('/sklad')) {
      return Response.json({ documents: [{ name: 'projects/x/databases/(default)/documents/users/u1/sklad/data' }] });
    }
    return Response.json({});
  };

  global.fetch = async (vstup, init) => {
    // Worker volá fetch s řetězcem, s URL i s Requestem — vytáhni adresu ze všech
    const url = String(vstup && vstup.url ? vstup.url : vstup);
    volani.push({ url, init: init || {} });
    if (url.includes('cnb.cz')) return cnbOdpoved();
    if (url.includes('consignthem.com')) return pikaOdpovedi(url, init || {});
    return odpovezSklad(url);
  };

  async function bezLogu(fn) {
    console.log = () => {}; console.error = () => {};
    try { return await fn(); } finally { console.log = puvodniLog; console.error = puvodniErr; }
  }
  async function pika(env = ENV) {
    volani = [];
    const r = await bezLogu(() => worker.fetch(
      new Request('https://sklad.mtkm.workers.dev/' + env.MCP_TOKEN + '/pika'), env));
    return { stav: r.status, telo: await r.json() };
  }
  // Výchozí, zdravý scénář
  function scenarOk(strankaPo = 50, podminky) {
    return (url, init) => {
      const k = katalogOdpoved(url, init); if (k) return k;
      if (url.endsWith('/me')) return Response.json(ME);
      if (url.includes('consigner-terms/status')) {
        return podminky || Response.json({ accepted: true, version: '2026-01' });
      }
      const q = new URL(url).searchParams;
      const strana = Number(q.get('page') || 1);
      const od = (strana - 1) * strankaPo;
      return Response.json({
        data: VYPIS.slice(od, od + strankaPo),
        page: strana, page_size: strankaPo, total: VYPIS.length,
        server_time: '2026-09-03T09:00:00.000Z',
      });
    };
  }

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('1) Náhled spočítá rozdíl a nic nezapíše');
  pikaOdpovedi = scenarOk();
  let v = await pika();
  ok('odpoví to', v.stav === 200, JSON.stringify(v.telo).slice(0, 200));
  const r = v.telo.plan || {};
  shoda('chybí u nich jen ty, co mají viset',
    (r.vystavit || []).map(x => x.nazev).sort(),
    ['Eurová cílovka', 'Osobní kousek']);
  ok('osobní kus se vystavuje taky', (r.vystavit || []).some(x => x.osobni === true),
    'na profilu nezáleží — podnikatelský dostane fakturu, osobní kupní smlouvu');
  /* Čtyři kusy mají viset: dva doma, jeden u jiného komisáře (i ten se
     dá prodat — majitel pošle štítek a oni ho odešlou) a jeden s eurovou
     cílovkou. Mimo zůstává jen to, co ještě není doma nebo není na
     skladě, a jiné kategorie. */
  ok('vystavuje se i kus ležící u jiného komisáře',
    v.telo.ve_skladu && v.telo.ve_skladu.melo_by_viset === 4,
    JSON.stringify(v.telo.ve_skladu));
  shoda('bez cílové ceny se nevystaví, ale je vidět',
    (r.bez_cilove_ceny || []).map(x => x.nazev), ['Tričko bez cílovky']);
  ok('co není na skladě, se neřeší',
    !JSON.stringify(r).includes('Už se prodalo') && !JSON.stringify(r).includes('Ještě nedorazilo'));
  ok('jiné kategorie se neřeší', !JSON.stringify(r).includes('Pokémon box'));
  ok('co u nich visí navíc, se hlásí', (r.visi_navic_nezname || []).length === 1
    && r.visi_navic_nezname[0].id === 'L-3', JSON.stringify(r.visi_navic_nezname));
  ok('prodané se hlásí zvlášť', (r.prodano_u_nich || []).length === 1
    && r.prodano_u_nich[0].id === 'L-4', JSON.stringify(r.prodano_u_nich));
  /* Hledání v katalogu je taky POST (resolve-skus), ale nic nemění —
     měří se zápisy do jejich skladu, ne každý POST. */
  const zapisyDoSkladu = volani.filter(x => x.url.includes('consignthem')
    && (x.init.method || 'GET') !== 'GET' && !x.url.includes('master-products'));
  shoda('nic se u nich nezměnilo', zapisyDoSkladu.map(x => (x.init.method || 'GET') + ' ' + x.url), []);

  /* Nepodepsané podmínky obchodu shodí každý zápis na 409, zatímco
     čtení chodí dál — takže se to jinak zjistí až při prvním vystavení. */
  ok('je vidět, jestli jsou podepsané podmínky obchodu',
    v.telo.kdo && v.telo.kdo.podminky_obchodu && v.telo.kdo.podminky_obchodu.accepted === true,
    JSON.stringify(v.telo.kdo && v.telo.kdo.podminky_obchodu));

  /* Jestli chodí pošta, se z ničeho jiného nepozná — a bez ní se
     majitel o zaseknutém kusu nedozví. */
  shoda('náhled řekne, že pošta nastavená není',
    [v.telo.posta.nastavena, v.telo.posta.chybi], [false, ['RESEND_API_KEY', 'MAIL_KOMU']]);

  pikaOdpovedi = scenarOk(50, Response.json({ error: 'forbidden' }, { status: 403 }));
  const bezPodminek = await pika();
  ok('a když se to nezjistí, náhled kvůli tomu nespadne',
    bezPodminek.stav === 200 && !!bezPodminek.telo.kdo.podminky_obchodu.nezjisteno,
    JSON.stringify(bezPodminek.telo.kdo && bezPodminek.telo.kdo.podminky_obchodu));
  pikaOdpovedi = scenarOk();
  v = await pika();

  sekce('2) Peníze');
  /* Cílová cena ve SKLADu je to, co má majiteli přijít na účet. Obchod
     si z ceny na pultě bere provizi, takže na pult musí jít víc —
     jinak by mu z každého prodeje ubrali čtvrtinu. Provize se bere
     z jejich vlastních dat, ne z čísla opsaného z podmínek. */
  ok('provize se přečte z jejich řádků', v.telo.ve_skladu.provize_pct === 25,
    JSON.stringify(v.telo.ve_skladu));
  const osobni = (r.vystavit || []).find(x => x.nazev === 'Osobní kousek');
  ok('cílovka zůstává tím, co má přijít', osobni && osobni.cena_kc === 3000,
    JSON.stringify(osobni));
  ok('a na pult jde částka i s provizí', osobni && osobni.na_pulte_kc === 4090,
    '3000 / 0,75 = 4000 → nahoru na koncovku 90 = 4090 | ' + JSON.stringify(osobni));
  ok('a je vidět, kolik z toho přijde', osobni && osobni.dostanes_kc === 3068,
    '4090 × 0,75 = 3067,5 | ' + JSON.stringify(osobni));
  const euro = (r.vystavit || []).find(x => x.nazev === 'Eurová cílovka');
  ok('eurová cílovka se přepočítá dnešním kurzem', euro && euro.cena_kc === 4750,
    '190 € × 25 = 4750 | ' + JSON.stringify(euro));
  ok('a taky se navýší o provizi', euro && euro.na_pulte_kc === 6390,
    '4750 / 0,75 = 6333 → nahoru na 6390 | ' + JSON.stringify(euro));
  ok('kurz je vidět', v.telo.ve_skladu && v.telo.ve_skladu.kurz_eur === 25,
    JSON.stringify(v.telo.ve_skladu));

  /* Staré inzeráty se nepřeceňují vůbec. Majitel si komis prochází sám
     a ceny upravuje podle toho, jak na tom je; automatika by mu do
     toho neměla sahat. */
  ok('plán vůbec nezná přeceňování', r.precenit === undefined,
    JSON.stringify(Object.keys(r)));
  ok('a u nich už vystavené kusy se jen započtou', v.telo.ve_skladu.uz_visi === 2,
    JSON.stringify(v.telo.ve_skladu));

  // Bez kurzu se eurová cena nehádá
  cnbOdpoved = () => new Response('nic', { status: 500 });
  pikaOdpovedi = scenarOk();
  const bezKurzu = await pika();
  ok('bez kurzu ČNB se eurová cena nehádá',
    (bezKurzu.telo.plan.bez_cilove_ceny || []).some(x => x.nazev === 'Eurová cílovka'),
    JSON.stringify(bezKurzu.telo.plan.bez_cilove_ceny));
  cnbOdpoved = () => new Response('03.09.2026 #170\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|25,000\n');

  /* Když se provize z jejich odpovědi zjistit nedá, kus se nevystaví.
     Hádat ji z podmínek by znamenalo hádat peníze. */
  pikaOdpovedi = (url) => {
    if (url.endsWith('/me')) return Response.json(ME);
    if (url.includes('consigner-terms/status')) return Response.json({ accepted: true });
    const bez = VYPIS.map(x => { const y = Object.assign({}, x); delete y.commission_rate_bp; return y; });
    return Response.json({ data: bez, page: 1, page_size: 50, total: bez.length, server_time: 'x' });
  };
  const bezProvize = await pika();
  ok('bez známé provize se nevystavuje', (bezProvize.telo.plan.vystavit || []).length === 0,
    JSON.stringify(bezProvize.telo.plan.vystavit));
  ok('a řekne se to', (bezProvize.telo.plan.bez_zname_provize || []).length === 2,
    JSON.stringify(bezProvize.telo.plan.bez_zname_provize));
  pikaOdpovedi = scenarOk();
  v = await pika();

  sekce('3) Tvar odpovědi');
  // Pole pod `items` místo `data` — nula řádků a žádná chyba by byla nejhorší možný výsledek
  pikaOdpovedi = (url) => url.endsWith('/me') ? Response.json(ME)
    : Response.json({ items: VYPIS, page: 1, page_size: 50, total: VYPIS.length, server_time: 'x' });
  v = await pika();
  ok('cizí tvar odpovědi se pozná a nepokračuje se', v.stav === 502 && /data/.test(v.telo.chyba || ''),
    JSON.stringify(v.telo));

  // Stránkování — 4 řádky po dvou
  pikaOdpovedi = scenarOk(2);
  v = await pika();
  ok('výpis se dostránkuje', v.telo.u_nich && v.telo.u_nich.celkem === 4,
    JSON.stringify(v.telo.u_nich));
  ok('kurzor se bere ze server_time odpovědi',
    v.telo.u_nich.server_time === '2026-09-03T09:00:00.000Z', v.telo.u_nich.server_time);

  sekce('4) Chyby');
  let pokusu = 0;
  pikaOdpovedi = () => { pokusu++; return Response.json({ error: 'unauthorized' }, { status: 401 }); };
  v = await pika();
  ok('401 se pozná jako neplatný token', /token/.test(v.telo.chyba || '') && v.telo.duvod === 'token',
    JSON.stringify(v.telo));
  ok('a nezkouší se dokola', pokusu === 1, pokusu + ' pokusů');

  pokusu = 0;
  pikaOdpovedi = () => { pokusu++; return Response.json({ error: 'too_many_failed_attempts' }, { status: 429 }); };
  v = await pika();
  ok('too_many_failed_attempts je taky o tokenu, ne o tempu',
    /token/.test(v.telo.chyba || '') && v.telo.duvod === 'token', JSON.stringify(v.telo));
  ok('a taky se nezkouší dokola', pokusu === 1, pokusu + ' pokusů');

  pokusu = 0;
  pikaOdpovedi = () => { pokusu++; return Response.json({ error: 'bad_request', detail: 'nesmysl' }, { status: 400 }); };
  v = await pika();
  ok('4xx se neopakuje', pokusu === 1, pokusu + ' pokusů');
  ok('a je z toho čitelná hláška', /400/.test(v.telo.chyba || '') && /nesmysl/.test(v.telo.chyba || ''),
    v.telo.chyba);

  pokusu = 0;
  pikaOdpovedi = (url) => {
    pokusu++;
    if (pokusu < 3) return new Response('bum', { status: 503 });
    return url.endsWith('/me') ? Response.json(ME)
      : Response.json({ data: [], page: 1, page_size: 50, total: 0, server_time: 'x' });
  };
  v = await pika();
  ok('5xx se zkusí znovu', pokusu >= 3 && v.stav === 200, pokusu + ' pokusů, stav ' + v.stav);

  // Zahlcení: čeká se tolik, kolik řeknou. Delší čekání se nechá na příště.
  pokusu = 0;
  pikaOdpovedi = () => { pokusu++; return Response.json({ error: 'server_busy', retry_after_s: 300 }, { status: 429 }); };
  v = await pika();
  ok('dlouhé čekání se nechá na příští běh', v.telo.duvod === 'zahlceno' && pokusu === 1,
    pokusu + ' pokusů | ' + JSON.stringify(v.telo));

  sekce('5) Tajemství');
  const bezTokenu = Object.assign({}, ENV); delete bezTokenu.CONSIGNTHEM_TOKEN;
  pikaOdpovedi = scenarOk();
  volani = [];
  v = await pika(bezTokenu);
  ok('bez tokenu se ani nevolá', volani.filter(x => x.url.includes('consignthem')).length === 0);
  ok('a řekne se, co doplnit', /CONSIGNTHEM_TOKEN/.test(v.telo.chyba || ''), JSON.stringify(v.telo));

  pikaOdpovedi = scenarOk();
  v = await pika();
  ok('token se nikde nevypisuje', !JSON.stringify(v.telo).includes(ENV.CONSIGNTHEM_TOKEN));

  const zdroj = require('fs').readFileSync(path.resolve(__dirname, '..', 'konektor', 'worker.js'), 'utf8');
  const konzole = zdroj.match(/console\.(log|error|warn)\([^\n]*/g) || [];
  shoda('do logu nejde nic z hlaviček ani token',
    konzole.filter(x => /CONSIGNTHEM|Authorization|headers/i.test(x)), []);
  ok('token není nikde natvrdo', !/Bearer\s+[A-Za-z0-9_-]{8,}/.test(zdroj));

  sekce('6) Tolerantní parsování');
  /* Jejich smlouva slibuje aditivní změny: do odpovědí kdykoli přibudou
     nová pole a do výčtů nové hodnoty, bez ohlášení. Klient na tom
     nesmí padat — jinak se rozbije při první jejich novince a nebude to
     jejich vada. */
  pikaOdpovedi = (url) => {
    if (url.endsWith('/me')) {
      return Response.json(Object.assign({}, ME, {
        novinka: { neco: 'co jsme nikdy neviděli' },
        capabilities: ['listings:read', 'listings:write', 'neznama:schopnost'],
      }));
    }
    const zvlastni = VYPIS.map(x => Object.assign({}, x, {
      nove_pole: 'přibylo bez ohlášení',
      vnorene: { a: [1, 2, { b: null }] },
    }));
    zvlastni[0] = Object.assign({}, zvlastni[0], { status: 'reserved_for_buyer' });
    return Response.json({ data: zvlastni, page: 1, page_size: 50, total: zvlastni.length,
      server_time: '2026-09-05T09:00:00.000Z', budouci_klic: 42 });
  };
  v = await pika();
  ok('neznámá pole nevadí', v.stav === 200, JSON.stringify(v.telo).slice(0, 200));
  ok('neznámá hodnota ve výčtu taky ne',
    v.telo.u_nich && v.telo.u_nich.podle_stavu && v.telo.u_nich.podle_stavu.reserved_for_buyer === 1,
    JSON.stringify(v.telo.u_nich));

  sekce('7) Čtení jejich kontraktu');
  /* Jejich openapi.json je veřejný a generovaný z jejich routování.
     Vývojové prostředí na jejich doménu nedosáhne, Worker ano — tahle
     adresa z kontraktu vytáhne, jaká pole která cesta bere. */
  const OPENAPI = {
    info: { version: '1.4.2' },
    paths: {
      '/listings': {
        post: {
          summary: 'Založení kusu',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewListing' } } } },
          responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Listing' } } } },
            403: {}, 409: {} },
        },
        get: {
          summary: 'Moje kusy',
          parameters: [{ name: 'updated_since', required: false, schema: { type: 'string', format: 'date-time' } }],
          responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Obalka' } } } } },
        },
      },
      '/listings/{id}/withdraw': {
        post: { summary: 'Stažení kusu z prodeje', responses: { 200: {} } },
      },
    },
    components: {
      schemas: {
        NewListing: {
          type: 'object',
          required: ['store_id', 'consigner_id', 'price_cents'],
          properties: {
            store_id: { type: 'string', format: 'uuid' },
            consigner_id: { type: 'integer' },
            price_cents: { type: 'integer' },
            condition: { type: 'string', enum: ['DS', 'VNDS', 'used'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
        Listing: { allOf: [
          { type: 'object', properties: { id: { type: 'string' } } },
          { type: 'object', properties: { status: { type: 'string', enum: ['draft', 'listed'] } } },
        ] },
        Obalka: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Radek' } },
            total: { type: 'integer' },
          },
        },
        Radek: { type: 'object', properties: {
          id: { type: 'string' }, sku: { type: 'string', nullable: true }, size: { type: 'string' },
        } },
      },
    },
  };
  pikaOdpovedi = (url) => url.endsWith('/openapi.json')
    ? Response.json(OPENAPI) : Response.json({ chyba: 'sem se nemá chodit' }, { status: 500 });
  volani = [];
  const rApi = await bezLogu(() => worker.fetch(
    new Request('https://sklad.mtkm.workers.dev/' + ENV.MCP_TOKEN + '/pika/api'
      + '?cesty=post /listings,get /listings,post /listings/{id}/withdraw,get /nic'), ENV));
  const api = await rApi.json();
  ok('kontrakt se přečte', rApi.status === 200 && api.verze === '1.4.2', JSON.stringify(api).slice(0, 160));
  const zaloz = (api.cesty || []).find(x => x.cesta === '/listings' && x.metoda === 'post');
  shoda('povinná pole zakládání sedí', zaloz && zaloz.telo.povinne,
    ['store_id', 'consigner_id', 'price_cents']);
  ok('typy se rozbalí přes $ref', zaloz && zaloz.telo.pole.store_id === 'string (uuid)',
    JSON.stringify(zaloz && zaloz.telo.pole));
  ok('výčty jsou vidět', zaloz && /DS \| VNDS \| used/.test(zaloz.telo.pole.condition || ''),
    JSON.stringify(zaloz && zaloz.telo.pole));
  ok('pole se pozná', zaloz && zaloz.telo.pole.tags === 'pole<string>',
    JSON.stringify(zaloz && zaloz.telo.pole));
  ok('allOf se slije dohromady', zaloz && zaloz.odpoved && zaloz.odpoved.pole
    && zaloz.odpoved.pole.id && zaloz.odpoved.pole.status,
    JSON.stringify(zaloz && zaloz.odpoved));
  const vypisSch = (api.cesty || []).find(x => x.cesta === '/listings' && x.metoda === 'get');
  ok('u výpisu se leze do obálky data[]',
    vypisSch && vypisSch.odpoved && vypisSch.odpoved.pole && vypisSch.odpoved.pole.sku
    === 'string | null', JSON.stringify(vypisSch && vypisSch.odpoved));
  ok('parametry jsou vidět', vypisSch && (vypisSch.parametry || []).some(p => /updated_since/.test(p)),
    JSON.stringify(vypisSch && vypisSch.parametry));
  const stazeni = (api.cesty || []).find(x => x.cesta === '/listings/{id}/withdraw');
  ok('cesta bez těla projde taky', stazeni && stazeni.popis === 'Stažení kusu z prodeje',
    JSON.stringify(stazeni));
  ok('neexistující cesta se řekne', (api.cesty || []).some(x => x.chyba === 'v kontraktu není'),
    JSON.stringify(api.cesty && api.cesty.map(x => x.cesta)));
  ok('kontrakt se čte bez tokenu',
    !volani.some(x => x.url.includes('openapi') && x.init.headers && x.init.headers.Authorization),
    'openapi.json je veřejný, token tam nemá co dělat');

  sekce('8) Totéž jde zavolat jako nástroj MCP');
  /* Adresu s tokenem musí člověk skládat ručně a token přitom prochází
     schránkou. Přes nástroj se k témuž dostane ten, kdo napojení píše,
     aniž by token kamkoli posílal. */
  async function nastroj(name, args) {
    const r = await bezLogu(() => worker.fetch(new Request(
      'https://sklad.mtkm.workers.dev/' + ENV.MCP_TOKEN + '/mcp',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
          arguments: undefined, params: { name, arguments: args || {} } }) }), ENV));
    const o = await r.json();
    const text = o.result && o.result.content && o.result.content[0].text;
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { data, text, chyba: !!(o.result && o.result.isError) };
  }

  pikaOdpovedi = (url) => url.endsWith('/openapi.json')
    ? Response.json(OPENAPI) : Response.json({ chyba: 'sem se nemá chodit' }, { status: 500 });
  const nSmlouva = await nastroj('pika_smlouva', { cesty: ['post /listings'] });
  ok('pika_smlouva vrátí kontrakt', !nSmlouva.chyba && nSmlouva.data && nSmlouva.data.verze === '1.4.2',
    nSmlouva.text && nSmlouva.text.slice(0, 160));
  shoda('a je v něm tělo zakládání',
    nSmlouva.data && nSmlouva.data.cesty[0].telo.povinne,
    ['store_id', 'consigner_id', 'price_cents']);

  /* Kontrakt je veřejný a se skladem nemá nic společného, takže se
     musí přečíst i tehdy, když přihlášení do cloudu selhává. Jinak by
     rozbitý cloud zablokoval i psaní napojení. */
  const puvodniSklad = odpovezSklad;
  odpovezSklad = (u) => u.includes('identitytoolkit')
    ? Response.json({ error: { message: 'INVALID_PASSWORD' } }, { status: 400 })
    : Response.json({});
  const smlouvaBezCloudu = await nastroj('pika_smlouva', { cesty: ['post /listings'] });
  odpovezSklad = puvodniSklad;
  ok('kontrakt se přečte i při rozbitém přihlášení do cloudu',
    !smlouvaBezCloudu.chyba && smlouvaBezCloudu.data && smlouvaBezCloudu.data.verze === '1.4.2',
    smlouvaBezCloudu.text && smlouvaBezCloudu.text.slice(0, 160));

  pikaOdpovedi = scenarOk();
  const nNahled = await nastroj('pika_nahled', {});
  ok('pika_nahled vrátí rozdíl', !nNahled.chyba && nNahled.data && nNahled.data.stav === 'ok',
    nNahled.text && nNahled.text.slice(0, 160));
  ok('a je v něm plán, co vystavit',
    nNahled.data && Array.isArray(nNahled.data.plan.vystavit),
    JSON.stringify(nNahled.data && nNahled.data.plan).slice(0, 160));

  sekce('9) Jeden inzerát na model a velikost');
  /* Majitel listuje jeden kus, i když jich má víc — tak to dělal ručně
     a chce to tak dál. Když se prodá jinde, inzerát visí dál, dokud mu
     doma zbývá aspoň jeden; když se prodá u nich, vystaví se znovu. */
  const DVOJCATA = [
    { id: 'a', name: 'Tričko', sku: 'T-1', size: 'S', category: 'obleceni',
      saleState: 'stock', location: 'Doma', targetPrice: 750 },
    { id: 'b', name: 'Tričko', sku: 'T-1', size: 'S', category: 'obleceni',
      saleState: 'stock', location: 'Doma', targetPrice: 750 },
  ];
  function scenarSeSkladem(polozky, vypis, extra) {
    odpovezSklad = (url) => {
      if (url.includes('identitytoolkit')) return Response.json({ idToken: 't', localId: 'u1' });
      if (url.includes(':batchGet')) {
        return Response.json([{ found: dok('users/u1/sklad/data', {
          savedAt: '2026-09-03T06:00:00.000Z', items: polozky }) }]);
      }
      if (url.includes('/sklad?') || url.endsWith('/sklad')) {
        return Response.json({ documents: [{ name: 'projects/x/databases/(default)/documents/users/u1/sklad/data' }] });
      }
      return Response.json({});
    };
    pikaOdpovedi = (url, init) => {
      const k = katalogOdpoved(url, init); if (k) return k;
      if (url.endsWith('/me')) return Response.json(ME);
      if (url.includes('consigner-terms/status')) return Response.json({ accepted: true });
      if (url.includes('/listings?')) {
        return Response.json({ data: vypis, page: 1, page_size: 50, total: vypis.length,
          server_time: 'x' });
      }
      return (extra || (() => Response.json({ id: 'novy', short_id: 'N-1', status: 'draft' })))(url, init);
    };
  }
  const radekTricko = (id, stav, cena) => ({ id, short_id: id, sku: 'T-1', size: 'S',
    status: stav, price_cents: cena, payout_basis_cents: null, commission_rate_bp: 2500,
    master_product_id: 'mp-t-1', created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z' });

  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 100000)]);
  let p = (await pika()).telo.plan;
  shoda('dva kusy doma, jeden inzerát — nedělá se nic',
    [(p.vystavit || []).length, (p.stahnout || []).length], [0, 0]);

  // Jiný kus u nich visí (od něj se pozná provize), tenhle model ne
  const cizi = { id: 'C-9', short_id: 'C-9', sku: 'JINY-1', size: '44', status: 'listed',
    price_cents: 100000, commission_rate_bp: 2500, created_at: '2026-08-01T00:00:00Z' };
  scenarSeSkladem(DVOJCATA, [cizi]);
  p = (await pika()).telo.plan;
  ok('když ten model nevisí, vystaví se právě jeden', (p.vystavit || []).length === 1,
    JSON.stringify(p.vystavit));
  ok('a na pult jde cílovka i s provizí',
    p.vystavit[0] && p.vystavit[0].na_pulte_kc === 1090,
    '750 / 0,75 = 1000 → nahoru na 1090 | ' + JSON.stringify(p.vystavit));

  /* Když u nich nevisí vůbec nic, není odkud vzít provizi — a bez ní
     se cena na pultě spočítat nedá. Radši nic než kus vystavený za
     čistou částku, ze které si obchod ještě ukrojí. */
  scenarSeSkladem(DVOJCATA, []);
  p = (await pika()).telo.plan;
  shoda('bez jediného vystaveného kusu se provize nemá odkud vzít',
    [(p.vystavit || []).length, (p.bez_zname_provize || []).length], [0, 1]);

  // Prodej jinde: jeden kus jde do Čeká, druhý zůstává doma → inzerát visí dál
  const jedenCeka = [DVOJCATA[0], Object.assign({}, DVOJCATA[1], { saleState: 'waiting' })];
  scenarSeSkladem(jedenCeka, [radekTricko('T-A', 'listed', 100000)]);
  p = (await pika()).telo.plan;
  shoda('prodej jinde inzerát nestahuje, dokud je doma další kus',
    [(p.vystavit || []).length, (p.stahnout || []).length], [0, 0]);

  // Poslední kus odešel do Čeká → inzerát ven
  const obaCekaji = DVOJCATA.map(x => Object.assign({}, x, { saleState: 'waiting' }));
  scenarSeSkladem(obaCekaji, [radekTricko('T-A', 'listed', 100000)]);
  p = (await pika()).telo.plan;
  ok('poslední kus do Čeká inzerát stáhne', (p.stahnout || []).length === 1,
    JSON.stringify(p.stahnout));

  /* Prodej u nich: jejich řádek přejde na sold, činných je nula —
     a protože doma ještě jeden kus je, vystaví se znovu. Přesně to,
     co majitel dělal rukama. */
  scenarSeSkladem(jedenCeka, [radekTricko('T-B', 'sold', 100000)]);
  p = (await pika()).telo.plan;
  ok('po prodeji u nich se vystaví znovu', (p.vystavit || []).length === 1,
    JSON.stringify(p.vystavit));
  ok('a je vidět, že se u nich prodalo', (p.prodano_u_nich || []).length === 1,
    JSON.stringify(p.prodano_u_nich));

  // Návrat z Čeká: radši vrátit stažený kus než zakládat nový
  scenarSeSkladem(DVOJCATA, [radekTricko('T-B', 'withdrawn', 100000)]);
  p = (await pika()).telo.plan;
  shoda('návrat na sklad vrátí stažený kus, nezaloží nový',
    [(p.vratit_do_prodeje || []).length, (p.vystavit || []).length], [1, 0]);

  /* Stažený inzerát bez katalogového id je zmetek z dřívějška — nemá
     u nich fotku ani SKU. Takový se neoživuje, založí se pořádně znovu. */
  const bezKatalogu = Object.assign(radekTricko('T-C', 'withdrawn', 100000));
  delete bezKatalogu.master_product_id;
  scenarSeSkladem(DVOJCATA, [bezKatalogu]);
  p = (await pika()).telo.plan;
  shoda('zmetek bez katalogu se neoživuje, založí se znovu',
    [(p.vratit_do_prodeje || []).length, (p.vystavit || []).length], [0, 1]);

  /* Prodej u nich, o kterém sklad ještě neví. Kus je pořád veden doma,
     ale fyzicky ho majitel nemá — vystavit ho znovu by znamenalo
     prodat něco, co nemá, a podle jejich podmínek je za nedodání
     pokuta od 200 Kč. */
  const cerstvyProdej = Object.assign(radekTricko('T-P', 'sold', 100000),
    { updated_at: new Date(Date.now() - 3600000).toISOString() });
  scenarSeSkladem([DVOJCATA[0]], [cerstvyProdej]);
  p = (await pika()).telo.plan;
  shoda('po prodeji u nich se nevystavuje, dokud sklad nedožene',
    [(p.vystavit || []).length, (p.ceka_na_sklad || []).length], [0, 1]);
  ok('a řekne se proč', /sklad to ještě neví/.test(((p.ceka_na_sklad || [])[0] || {}).duvod || ''),
    JSON.stringify(p.ceka_na_sklad));

  // Se dvěma kusy doma a jedním čerstvým prodejem zbývá jeden — ten se vystaví
  scenarSeSkladem(DVOJCATA, [cerstvyProdej]);
  p = (await pika()).telo.plan;
  ok('když doma zbývá další kus, vystaví se', (p.vystavit || []).length === 1,
    JSON.stringify(p.vystavit));

  // Starý prodej už brzdit nesmí
  const staryProdej = Object.assign(radekTricko('T-S', 'sold', 100000),
    { updated_at: '2026-01-01T00:00:00Z' });
  scenarSeSkladem([DVOJCATA[0]], [staryProdej]);
  p = (await pika()).telo.plan;
  ok('starý prodej vystavování nebrzdí', (p.vystavit || []).length === 1,
    JSON.stringify({ vystavit: p.vystavit, ceka: p.ceka_na_sklad }));

  // Cizí kus, o kterém sklad neví, se hlásí, ale nesahá se na něj
  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 100000),
    { id: 'X-1', short_id: 'X-1', sku: 'CIZI-9', size: '44', status: 'listed',
      price_cents: 10000, commission_rate_bp: 2500 }]);
  p = (await pika()).telo.plan;
  shoda('cizí vystavení se nestahuje', (p.stahnout || []).map(x => x.popis), []);
  ok('jen se ohlásí', (p.visi_navic_nezname || []).length === 1
    && p.visi_navic_nezname[0].id === 'X-1', JSON.stringify(p.visi_navic_nezname));

  sekce('10) Koncovka ceny');
  /* Obchod chce ceny končící na 90. Zaokrouhluje se nahoru — dolů by
     cena spadla pod dohodnutou a majiteli by po provizi přišlo míň,
     než si řekl. */
  for (const [cilovka, naPulte] of [[750, 1090], [3000, 4090], [1500, 2090], [10000, 13390]]) {
    scenarSeSkladem(
      [{ id: 'k', name: 'Kus', sku: 'K-1', size: '42', category: 'sneakers',
        saleState: 'stock', location: 'Doma', targetPrice: cilovka }],
      [cizi]);
    p = (await pika()).telo.plan;
    const x = (p.vystavit || [])[0];
    ok('cílovka ' + cilovka + ' → cena na pultě ' + naPulte,
      x && x.na_pulte_kc === naPulte, JSON.stringify(x));
    ok('a končí na 90', x && x.na_pulte_kc % 100 === 90, String(x && x.na_pulte_kc));
    ok('a po provizi zbyde aspoň cílovka', x && x.dostanes_kc >= cilovka,
      'dostane ' + (x && x.dostanes_kc) + ', chtěl ' + cilovka);
  }

  sekce('11) Velikosti a názvy');
  /* Ověřeno na skutečných datech: u nich „EU42" a „O/S", u nás „42"
     a „OS"; u čepic mají „M", evidence vede „M/L"; a názvy se liší
     pořadím slov i předsazeným „Air". Bez srovnání by se kus založil
     podruhé vedle toho, který u nich už visí. */
  const dvojice = [
    ['EU42', '42', 'Nike Dunk Low', 'Nike Dunk Low'],
    ['O/S', 'OS', 'Supreme MM6 Split 6-Panel Purple', 'Supreme MM6 Split 6-Panel Purple'],
    ['M', 'M/L', 'Nike Flame Club Cap Navy', 'Nike Flame Club Cap Navy'],
    ['L', 'L/XL', 'Nike Flame Club Cap Navy', 'Nike Flame Club Cap Navy'],
    ['L', 'L', 'Corteiz Snickers White Tee', 'Corteiz White Snickers Tee'],
    ['EU42', '42', 'Air Jordan 12 Retro Flu Game 2025', 'Jordan 12 Retro Flu Game (2025)'],
  ];
  for (const [velJejich, velNase, nazevJejich, nazevNase] of dvojice) {
    scenarSeSkladem(
      [{ id: 'x', name: nazevNase, size: velNase, category: 'obleceni',
        saleState: 'stock', location: 'Doma', targetPrice: 1000 }],
      [{ id: 'R-1', short_id: 'R-1', name: nazevJejich, size: velJejich, status: 'listed',
        price_cents: 133300, commission_rate_bp: 2500 }]);
    p = (await pika()).telo.plan;
    ok('spáruje „' + velJejich + '/' + nazevJejich + '" s „' + velNase + '/' + nazevNase + '"',
      (p.vystavit || []).length === 0 && (p.visi_navic_nezname || []).length === 0,
      JSON.stringify({ vystavit: p.vystavit, navic: p.visi_navic_nezname }));
  }
  // A co se lišit má, se slévat nesmí
  scenarSeSkladem(
    [{ id: 'x', name: 'Bota', sku: 'B-1', size: '41 1/3', category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 1000 }],
    [{ id: 'R-9', short_id: 'R-9', sku: 'B-1', size: 'EU41', status: 'listed',
      price_cents: 133300, commission_rate_bp: 2500 }]);
  p = (await pika()).telo.plan;
  ok('zlomkovou velikost neslévá s celou', (p.vystavit || []).length === 1,
    '41 1/3 není 41 | ' + JSON.stringify(p.vystavit));

  sekce('12) Zápisy');
  let odeslane = [];
  const zapisovyScenar = (url, init) => {
    odeslane.push({ url, method: (init && init.method) || 'GET',
      telo: init && init.body ? JSON.parse(init.body) : null,
      klic: init && init.headers && init.headers['Idempotency-Key'] });
    if (/\/withdraw$|\/activate$/.test(url)) return Response.json({ ok: true });
    return Response.json({ id: 'nove-id', short_id: 'N-9', status: 'draft' });
  };
  async function srovnat(args) {
    odeslane = [];
    const r = await bezLogu(() => worker.fetch(new Request(
      'https://sklad.mtkm.workers.dev/' + ENV.MCP_TOKEN + '/mcp',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'pika_srovnat', arguments: args || {} } }) }), ENV));
    const o = await r.json();
    let data = null;
    try { data = JSON.parse(o.result.content[0].text); } catch (e) {}
    return data;
  }

  scenarSeSkladem(DVOJCATA, [cizi], zapisovyScenar);
  const jenPlan = await srovnat({});
  shoda('bez provest se nic neodešle', odeslane.filter(x => x.method !== 'GET').map(x => x.url), []);
  ok('a je vidět, že se to teprve provede', /provest/.test(jenPlan.poznamka || ''), jenPlan.poznamka);

  const provedeno = await srovnat({ provest: true });
  const posty = odeslane.filter(x => x.method === 'POST' && /\/listings$/.test(x.url));
  ok('vystavení odešlo', posty.length === 1, JSON.stringify(odeslane.map(x => x.method + ' ' + x.url)));
  ok('a hlásí se to zpět', (provedeno.provedeno.vystaveno || []).length === 1,
    JSON.stringify(provedeno.provedeno));
  const telo = posty[0].telo;
  shoda('tělo nese povinná pole a daňový režim',
    [telo.store_id, telo.consigner_id, telo.size, telo.vat_mode],
    [ME.store.id, ME.consigner.id, 'S', 'bazar']);
  ok('cena na pultě je v haléřích a s provizí', telo.price_cents === 109000,
    '750 Kč cílovka → 1090 Kč na pultě → 109000 haléřů | ' + JSON.stringify(telo));
  ok('neznámý stav zboží je opatrně „used"', telo.condition === 'used', String(telo.condition));
  ok('a bez pokynu se nepublikuje', telo.publish === false, String(telo.publish));
  ok('idempotenční klíč má tvar UUID',
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(posty[0].klic || ''),
    String(posty[0].klic));
  const klicPrvni = posty[0].klic;
  await srovnat({ provest: true });
  ok('a je stejný pro totéž tělo',
    odeslane.filter(x => x.method === 'POST')[0].klic === klicPrvni, 'klíč se změnil');

  await srovnat({ provest: true, publikovat: true });
  ok('s publikovat: true jde kus rovnou do prodeje',
    odeslane.filter(x => x.method === 'POST')[0].telo.publish === true);

  /* Nikdy se nepřeceňuje — ani PATCH, ani nic jiného na existující kus. */
  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 999900)], zapisovyScenar);
  const bezPreceneni = await srovnat({ provest: true });
  shoda('u vystaveného kusu se cena nesahá',
    odeslane.filter(x => x.method !== 'GET').map(x => x.method + ' ' + x.url), []);
  ok('a nic k provedení nezbylo', /není co dělat/.test(bezPreceneni.poznamka || ''),
    bezPreceneni.poznamka);

  /* Jejich stupnice je new | used | vnds. Naše DS a „Nové se štítky"
     jsou new, všechno ostatní used — lepší stav, než o jakém víme, se
     tvrdit nebude. */
  for (const [nas, jejich] of [['DS', 'new'], ['nove-stitky', 'new'],
    ['pouzite-dobre', 'used'], ['poskozene', 'used']]) {
    scenarSeSkladem([{ id: 'c1', name: 'Kus', sku: 'C-1', size: '42', category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 1000, condition: nas }],
      [radekTricko('J-1', 'listed', 100000)], zapisovyScenar);
    await srovnat({ provest: true });
    const t = odeslane.filter(x => x.method === 'POST')[0];
    ok('stav zboží ' + nas + ' → ' + jejich, t && t.telo.condition === jejich,
      t && String(t.telo.condition));
  }
  /* Kus se vystavuje přes jejich katalog. Ověřeno ostrým pokusem:
     bez master_product_id nemá u nich ani fotku, ani SKU — a majitel
     je ručně listuje přes katalog. */
  ok('v těle je katalogové id', (function () {
    const t = odeslane.filter(x => x.method === 'POST' && /\/listings$/.test(x.url))[0];
    return t && t.telo.master_product_id === 'mp-c-1';
  })(), JSON.stringify(odeslane.filter(x => /\/listings$/.test(x.url))[0]));
  ok('a nic o vlastní značce a modelu', (function () {
    const t = odeslane.filter(x => x.method === 'POST' && /\/listings$/.test(x.url))[0];
    return t && !t.telo.custom_brand && !t.telo.custom_model && !t.telo.style_code;
  })(), JSON.stringify(odeslane.filter(x => /\/listings$/.test(x.url))[0]));

  /* Kus doma bez cílové ceny se nedá vystavit — ale rozhodně to není
     důvod stáhnout to, co za něj u nich visí. Našlo se to na
     skutečných datech: majitelovy SB Dunky ležely doma bez cílovky
     a plán je chtěl stáhnout z prodeje. */
  scenarSeSkladem(
    [{ id: 'bc', name: 'Kus bez ceny', sku: 'BC-1', size: '42', category: 'sneakers',
      saleState: 'stock', location: 'Doma' }],
    [{ id: 'BC-L', short_id: 'BC-L', sku: 'BC-1', size: '42', status: 'listed',
      price_cents: 500000, commission_rate_bp: 2500, created_at: '2026-08-01T00:00:00Z' }],
    zapisovyScenar);
  p = (await pika()).telo.plan;
  shoda('zapomenutá cílovka inzerát nestahuje', (p.stahnout || []).map(x => x.popis), []);
  shoda('a nic se nevystavuje', (p.vystavit || []).map(x => x.nazev), []);
  ok('jen se řekne, že cena chybí', (p.bez_cilove_ceny || []).length === 1,
    JSON.stringify(p.bez_cilove_ceny));

  sekce('13) Katalog');
  /* Ověřeno ostrým pokusem u nich: kus založený mimo katalog nemá ani
     fotku, ani SKU — a fotka prodává. Bez katalogového id se proto
     nevystavuje vůbec; prázdný inzerát je horší než žádný. */
  const kusSSku = [{ id: 'ks', name: 'Kus s SKU', sku: 'KS-1', size: '42', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 1000 }];
  scenarSeSkladem(kusSSku, [cizi], zapisovyScenar);
  p = (await pika()).telo.plan;
  ok('kus se spáruje podle SKU', (p.vystavit || []).length === 1
    && p.vystavit[0].katalog_id === 'mp-ks-1', JSON.stringify(p.vystavit));
  ok('a je vidět, podle čeho', p.vystavit[0]['spárováno_podle'] === 'SKU',
    JSON.stringify(p.vystavit[0]));

  // Bez SKU se hledá podle názvu
  katalogNajde = true;
  const kusBezSku = [{ id: 'kb', name: 'Kus bez SKU', size: 'L', category: 'obleceni',
    saleState: 'stock', location: 'Doma', targetPrice: 1000 }];
  scenarSeSkladem(kusBezSku, [cizi], zapisovyScenar);
  p = (await pika()).telo.plan;
  ok('kus bez SKU se najde podle názvu', (p.vystavit || []).length === 1
    && p.vystavit[0]['spárováno_podle'] === 'název', JSON.stringify(p.vystavit));

  /* Víc shod v katalogu = nejistota. Pověsit kus na cizí model by
     znamenalo prodávat něco jiného, než si majitel myslí. */
  katalogShod = 3;
  scenarSeSkladem(kusBezSku, [cizi], zapisovyScenar);
  p = (await pika()).telo.plan;
  shoda('při víc shodách se radši nevystaví',
    [(p.vystavit || []).length, (p.neni_v_katalogu || []).length], [0, 1]);
  katalogShod = 1;

  // Katalog kus nezná vůbec
  katalogNajde = false;
  scenarSeSkladem(kusSSku, [cizi], zapisovyScenar);
  p = (await pika()).telo.plan;
  shoda('co katalog nezná, se nevystaví',
    [(p.vystavit || []).length, (p.neni_v_katalogu || []).length], [0, 1]);
  const nic = await srovnat({ provest: true });
  shoda('a opravdu se nic nezaloží',
    odeslane.filter(x => x.method === 'POST' && /\/listings$/.test(x.url)).map(x => x.url), []);
  katalogNajde = true;

  sekce('14) Opatrný rozjezd');
  /* „Vystav zatím jeden kus a ukaž mi ho." Bez tohohle by první ostrý
     běh udělal celý plán najednou. */
  const triKusy = [
    { id: 'p1', name: 'Kus A', sku: 'A-1', size: '42', category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 1000 },
    { id: 'p2', name: 'Kus B', sku: 'B-2', size: '43', category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 2000 },
    { id: 'p3', name: 'Kus C', sku: 'C-3', size: '44', category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 3000 },
  ];
  // Jeden kus u nich visí navíc a ve skladu už není → chce se stáhnout
  const kStazeni = { id: 'S-1', short_id: 'S-1', sku: 'A-1', size: '99', status: 'listed',
    price_cents: 100000, commission_rate_bp: 2500, created_at: '2026-08-01T00:00:00Z' };
  const naSklade = triKusy.concat([{ id: 'p4', name: 'Kus A', sku: 'A-1', size: '99',
    category: 'sneakers', saleState: 'waiting', location: 'Doma', targetPrice: 1000 }]);

  scenarSeSkladem(naSklade, [kStazeni], zapisovyScenar);
  const plnyPlan = (await pika()).telo.plan;
  shoda('plán chce tři vystavit a jeden stáhnout',
    [(plnyPlan.vystavit || []).length, (plnyPlan.stahnout || []).length], [3, 1]);

  const jedenKus = await srovnat({ provest: true, publikovat: true, jen: 'vystavit', nejvyse: 1 });
  const zapsane = odeslane.filter(x => x.method === 'POST');
  ok('s nejvyse 1 odejde jediný zápis', zapsane.length === 1,
    JSON.stringify(zapsane.map(x => x.method + ' ' + x.url)));
  ok('a je to vystavení, ne stažení', /\/listings$/.test(zapsane[0].url), zapsane[0].url);
  ok('rovnou do prodeje, když se o to řekne', zapsane[0].telo.publish === true,
    JSON.stringify(zapsane[0].telo));
  ok('a řekne se, kolik zbývá', jedenKus.poznamka && /Zbývá 2/.test(jedenKus.poznamka),
    jedenKus.poznamka);

  await srovnat({ provest: true, jen: 'stahnout' });
  const jenStazeni = odeslane.filter(x => x.method === 'POST');
  ok('s jen: stahnout se nic nevystavuje', jenStazeni.length === 1
    && /\/withdraw$/.test(jenStazeni[0].url), JSON.stringify(jenStazeni.map(x => x.url)));

  /* Cílené stažení jednoho inzerátu — úklid po ruce, mimo plán. */
  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 100000)], zapisovyScenar);
  const nahledStazeni = await srovnat({ stahni: 'T-A' });
  shoda('bez provest se jen ukáže, co by se stáhlo',
    [nahledStazeni.stav, odeslane.filter(x => x.method === 'POST').length], ['nahled', 0]);
  const cileneStazeni = await srovnat({ stahni: 'T-A', provest: true });
  ok('s provest se stáhne právě ten jeden', cileneStazeni.stav === 'staženo',
    JSON.stringify(cileneStazeni));
  const poslane = odeslane.filter(x => x.method === 'POST');
  ok('a nic jiného neodejde', poslane.length === 1 && /T-A\/withdraw$/.test(poslane[0].url),
    JSON.stringify(poslane.map(x => x.url)));
  const neznamy = await srovnat({ stahni: 'NENI', provest: true });
  shoda('neznámé id se řekne, nic se nezkouší',
    [neznamy.stav, odeslane.filter(x => x.method === 'POST').length], ['nenalezeno', 0]);

  sekce('15) Když něco selže, přijde mail');
  /* Srovnání běží na pozadí. Bez zprávy by se o zaseknutém kusu
     majitel dozvěděl leda tak, že by si toho všiml v jejich portálu. */
  let posta = [];
  const MAIL_ENV = Object.assign({}, ENV, { RESEND_API_KEY: 'k', MAIL_KOMU: 'ja@sklad.cz' });
  scenarSeSkladem(DVOJCATA, [cizi], (url, init) => {
    odeslane.push({ url, method: (init && init.method) || 'GET' });
    return Response.json({ error: 'bad_request', detail: 'velikost nesedí' }, { status: 400 });
  });
  const puvodniFetchMail = global.fetch;
  global.fetch = async (vstup, init) => {
    const url = String(vstup && vstup.url ? vstup.url : vstup);
    if (url.includes('resend')) { posta.push(JSON.parse(init.body)); return Response.json({ id: 'm1' }); }
    return puvodniFetchMail(vstup, init);
  };
  async function srovnatSMailem(args, env) {
    odeslane = []; posta = [];
    const r = await bezLogu(() => worker.fetch(new Request(
      'https://sklad.mtkm.workers.dev/' + ENV.MCP_TOKEN + '/mcp',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'pika_srovnat', arguments: args || {} } }) }), env));
    const o = await r.json();
    try { return JSON.parse(o.result.content[0].text); } catch (e) { return null; }
  }
  const sPotizi = await srovnatSMailem({ provest: true }, MAIL_ENV);
  ok('s nastavenou poštou to náhled potvrdí', sPotizi.posta && sPotizi.posta.nastavena === true,
    JSON.stringify(sPotizi.posta));
  ok('potíž se vrátí ve výsledku', (sPotizi.potize || []).length === 1,
    JSON.stringify(sPotizi.potize));
  ok('a odejde mail', posta.length === 1, JSON.stringify(posta).slice(0, 200));
  ok('v předmětu je vidět, o co jde', /Pikastore/.test((posta[0] || {}).subject || ''),
    (posta[0] || {}).subject);
  ok('a v textu je i důvod', /velikost nesedí/.test((posta[0] || {}).text || ''),
    (posta[0] || {}).text);
  ok('hlásí se, komu to šlo', sPotizi.mail && sPotizi.mail.odeslano === true,
    JSON.stringify(sPotizi.mail));

  // Bez nastavené pošty se potíž nesmí ztratit
  const bezPosty = await srovnatSMailem({ provest: true }, ENV);
  ok('bez nastavené pošty potíž nezmizí', (bezPosty.potize || []).length === 1,
    JSON.stringify(bezPosty.potize));
  ok('a řekne se, že mail poslat nešel',
    bezPosty.mail && bezPosty.mail.odeslano === false && /RESEND/.test(bezPosty.mail.duvod || ''),
    JSON.stringify(bezPosty.mail));
  global.fetch = puvodniFetchMail;

  sekce('16) Pojistky');
  /* Hromadné stažení skoro vždycky znamená rozbité párování nebo
     neúplnou odpověď, ne že by se přes noc prodal celý sklad. */
  const mnoho = [];
  for (let i = 0; i < 12; i++) {
    mnoho.push({ id: 'M-' + i, short_id: 'M-' + i, sku: 'T-' + i, size: 'S', status: 'listed',
      price_cents: 100000, commission_rate_bp: 2500, created_at: '2026-08-01T00:00:00Z' });
  }
  const vseCeka = mnoho.map((m, i) => ({ id: 'w' + i, name: 'Kus ' + i, sku: 'T-' + i, size: 'S',
    category: 'obleceni', saleState: 'waiting', location: 'Doma', targetPrice: 750 }));
  scenarSeSkladem(vseCeka, mnoho, zapisovyScenar);
  const stopka = await srovnat({ provest: true });
  ok('hromadné stažení se zarazí', stopka.stav === 'nezapisovalo se', JSON.stringify(stopka.stav));
  ok('a řekne proč', /stropem/.test(stopka.duvod || ''), stopka.duvod);
  shoda('a opravdu nic neodešlo', odeslane.filter(x => x.method !== 'GET').map(x => x.url), []);

  // Bez ověřených podmínek se taky nezapisuje
  scenarSeSkladem(DVOJCATA, [cizi], zapisovyScenar);
  const puvodniPika = pikaOdpovedi;
  pikaOdpovedi = (url, init) => url.includes('consigner-terms/status')
    ? Response.json({ error: 'forbidden' }, { status: 403 }) : puvodniPika(url, init);
  const bezPodminekZapis = await srovnat({ provest: true });
  ok('neověřené podmínky zápis zastaví', bezPodminekZapis.stav === 'nezapisovalo se',
    JSON.stringify(bezPodminekZapis.stav));
  ok('a je z toho poznat proč', /podmínky/.test(bezPodminekZapis.duvod || ''),
    bezPodminekZapis.duvod);
  shoda('a nic se neodeslalo', odeslane.filter(x => x.method !== 'GET').map(x => x.url), []);

  odpovezSklad = puvodniSklad;

  sekce('17) Adresa je pod tokenem');
  const r404 = await bezLogu(() => worker.fetch(
    new Request('https://sklad.mtkm.workers.dev/spatny-token/pika'), ENV));
  ok('bez správného tokenu se nic neprozradí', r404.status === 404, String(r404.status));

  global.fetch = puvodniFetch;
  console.log('\n' + (selhalo ? selhalo + ' KONTROL SELHALO' : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
