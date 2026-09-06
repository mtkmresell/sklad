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
    updated_at: '2026-09-01T10:00:00.000Z' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', short_id: 'L-2', sku: 'BB-2', size: '45',
    condition: 'DS', status: 'listed', price_cents: 700000, payout_basis_cents: 600000,
    updated_at: '2026-09-01T10:00:00.000Z' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', short_id: 'L-3', sku: 'ZZ-9', size: '40',
    condition: 'DS', status: 'listed', price_cents: 100000, payout_basis_cents: null,
    updated_at: '2026-09-01T10:00:00.000Z' },
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
    return (url) => {
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
  const r = v.telo.rozdil || {};
  shoda('chybí u nich jen ty, co mají viset',
    (r.chybi_u_nich || []).map(x => x.nazev).sort(),
    ['Eurová cílovka', 'Osobní kousek']);
  ok('osobní kus se vystavuje taky', (r.chybi_u_nich || []).some(x => x.osobni === true),
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
  ok('co u nich visí navíc, se hlásí', (r.visi_navic || []).length === 1
    && r.visi_navic[0].id === 'L-3', JSON.stringify(r.visi_navic));
  ok('prodané se hlásí zvlášť', (r.prodano_u_nich || []).length === 1
    && r.prodano_u_nich[0].id === 'L-4', JSON.stringify(r.prodano_u_nich));
  ok('nic se u nich nezměnilo',
    volani.filter(x => x.url.includes('consignthem') && (x.init.method || 'GET') !== 'GET').length === 0,
    JSON.stringify(volani.filter(x => x.url.includes('consignthem')).map(x => (x.init.method || 'GET') + ' ' + x.url)));

  /* Nepodepsané podmínky obchodu shodí každý zápis na 409, zatímco
     čtení chodí dál — takže se to jinak zjistí až při prvním vystavení. */
  ok('je vidět, jestli jsou podepsané podmínky obchodu',
    v.telo.kdo && v.telo.kdo.podminky_obchodu && v.telo.kdo.podminky_obchodu.accepted === true,
    JSON.stringify(v.telo.kdo && v.telo.kdo.podminky_obchodu));

  pikaOdpovedi = scenarOk(50, Response.json({ error: 'forbidden' }, { status: 403 }));
  const bezPodminek = await pika();
  ok('a když se to nezjistí, náhled kvůli tomu nespadne',
    bezPodminek.stav === 200 && !!bezPodminek.telo.kdo.podminky_obchodu.nezjisteno,
    JSON.stringify(bezPodminek.telo.kdo && bezPodminek.telo.kdo.podminky_obchodu));
  pikaOdpovedi = scenarOk();
  v = await pika();

  sekce('2) Peníze');
  /* L-2 má na pultě 7 000 (zvednuto slevovou akcí), dohodnuto 6 000 —
     a ve skladu je cílovka 6 000. Kdo počítá z ceny na pultě, ohlásí
     rozdíl, který neexistuje, a hnal by se přeceňovat. */
  shoda('cena na pultě nedělá falešný rozdíl', (r.jina_cena || []).map(x => x.nazev), []);
  ok('spárované sedí obě', v.telo.ve_skladu && v.telo.ve_skladu.sedi === 2,
    JSON.stringify(v.telo.ve_skladu));
  const euro = (r.chybi_u_nich || []).find(x => x.nazev === 'Eurová cílovka');
  ok('eurová cílovka se přepočítá dnešním kurzem', euro && euro.cena_kc === 4750,
    '190 € × 25 = 4750 | ' + JSON.stringify(euro));
  ok('kurz je vidět', v.telo.ve_skladu && v.telo.ve_skladu.kurz_eur === 25,
    JSON.stringify(v.telo.ve_skladu));

  /* A když se dohodnutá cena od cílovky opravdu liší, musí to být vidět —
     a to částkou dohodnutou, ne tou na pultě. */
  pikaOdpovedi = (url) => {
    if (url.endsWith('/me')) return Response.json(ME);
    const zmeneny = VYPIS.map(x => x.short_id === 'L-2'
      ? Object.assign({}, x, { payout_basis_cents: 550000 }) : x);
    return Response.json({ data: zmeneny, page: 1, page_size: 50, total: zmeneny.length,
      server_time: '2026-09-03T09:00:00.000Z' });
  };
  const jinak = await pika();
  const uKomisare = (jinak.telo.rozdil.jina_cena || []).find(x => x.nazev === 'U komisáře');
  ok('skutečný rozdíl v ceně se ohlásí', !!uKomisare, JSON.stringify(jinak.telo.rozdil.jina_cena));
  ok('a bere se dohodnutá cena, ne cena na pultě',
    uKomisare && uKomisare.u_nich_kc === 5500,
    'payout_basis 550000 = 5500 Kč; 7000 by znamenalo počítání z price_cents | '
      + JSON.stringify(uKomisare));

  // Bez kurzu se eurová cena nehádá
  cnbOdpoved = () => new Response('nic', { status: 500 });
  pikaOdpovedi = scenarOk();
  const bezKurzu = await pika();
  ok('bez kurzu ČNB se eurová cena nehádá',
    (bezKurzu.telo.rozdil.bez_cilove_ceny || []).some(x => x.nazev === 'Eurová cílovka'),
    JSON.stringify(bezKurzu.telo.rozdil.bez_cilove_ceny));
  cnbOdpoved = () => new Response('03.09.2026 #170\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|25,000\n');

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
  ok('a je v něm i to, co u nich chybí',
    nNahled.data && Array.isArray(nNahled.data.rozdil.chybi_u_nich),
    JSON.stringify(nNahled.data && nNahled.data.rozdil).slice(0, 160));

  sekce('9) Adresa je pod tokenem');
  const r404 = await bezLogu(() => worker.fetch(
    new Request('https://sklad.mtkm.workers.dev/spatny-token/pika'), ENV));
  ok('bez správného tokenu se nic neprozradí', r404.status === 404, String(r404.status));

  global.fetch = puvodniFetch;
  console.log('\n' + (selhalo ? selhalo + ' KONTROL SELHALO' : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
