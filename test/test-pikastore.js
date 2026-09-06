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
  shoda('cena na pultě nedělá falešný rozdíl', (r.precenit || []).map(x => x.nazev), []);
  ok('spárované sedí obě', v.telo.ve_skladu && v.telo.ve_skladu.sedi === 2,
    JSON.stringify(v.telo.ve_skladu));
  const euro = (r.vystavit || []).find(x => x.nazev === 'Eurová cílovka');
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
  const uKomisare = (jinak.telo.plan.precenit || []).find(x => x.nazev === 'U komisáře');
  ok('skutečný rozdíl v ceně se ohlásí', !!uKomisare, JSON.stringify(jinak.telo.plan.precenit));
  ok('a bere se dohodnutá cena, ne cena na pultě',
    uKomisare && uKomisare.z_kc === 5500,
    'payout_basis 550000 = 5500 Kč; 7000 by znamenalo počítání z price_cents | '
      + JSON.stringify(uKomisare));

  // Bez kurzu se eurová cena nehádá
  cnbOdpoved = () => new Response('nic', { status: 500 });
  pikaOdpovedi = scenarOk();
  const bezKurzu = await pika();
  ok('bez kurzu ČNB se eurová cena nehádá',
    (bezKurzu.telo.plan.bez_cilove_ceny || []).some(x => x.nazev === 'Eurová cílovka'),
    JSON.stringify(bezKurzu.telo.plan.bez_cilove_ceny));
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
  ok('a je v něm plán, co vystavit',
    nNahled.data && Array.isArray(nNahled.data.plan.vystavit),
    JSON.stringify(nNahled.data && nNahled.data.plan).slice(0, 160));

  sekce('9) Počty místo identity');
  /* Dvě stejná trička ve velikosti S se od sebe v jejich odpovědi
     nedají odlišit — nic, čím by se dala nést naše identita, tam není.
     Proto se srovnávají počty ve skupině (SKU/název + velikost). */
  const DVOJCATA = [
    { id: 'a', name: 'Tričko', sku: 'T-1', size: 'S', category: 'obleceni',
      saleState: 'stock', location: 'Doma', targetPrice: 500 },
    { id: 'b', name: 'Tričko', sku: 'T-1', size: 'S', category: 'obleceni',
      saleState: 'stock', location: 'Doma', targetPrice: 500 },
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
    status: stav, price_cents: cena, payout_basis_cents: null, created_at: '2026-08-01T00:00:00Z' });

  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 50000)]);
  let p = (await pika()).telo.plan;
  ok('chybí-li jeden ze dvou, vystaví se jeden', (p.vystavit || []).length === 1,
    JSON.stringify(p.vystavit));
  shoda('a nic se nestahuje', (p.stahnout || []).map(x => x.popis), []);

  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 50000), radekTricko('T-B', 'listed', 50000)]);
  p = (await pika()).telo.plan;
  shoda('když sedí počty, nedělá se nic', [(p.vystavit || []).length, (p.stahnout || []).length,
    (p.precenit || []).length], [0, 0, 0]);

  // Jeden se prodal jinde → majitel ho dá do Čeká → u nich má zůstat jeden
  const jedenCeka = [DVOJCATA[0], Object.assign({}, DVOJCATA[1], { saleState: 'waiting' })];
  scenarSeSkladem(jedenCeka, [radekTricko('T-A', 'listed', 50000), radekTricko('T-B', 'listed', 50000)]);
  p = (await pika()).telo.plan;
  ok('přesun do Čeká stáhne právě jeden kus', (p.stahnout || []).length === 1,
    JSON.stringify(p.stahnout));

  /* Prodej u nich se vyřeší sám: jejich řádek je `sold`, majitel kus
     posune do Čeká — a rozdíl vyjde nula. O stažení se nežádá. */
  scenarSeSkladem(jedenCeka, [radekTricko('T-A', 'listed', 50000), radekTricko('T-B', 'sold', 50000)]);
  p = (await pika()).telo.plan;
  shoda('prodej u nich nevyvolá žádný úkon',
    [(p.vystavit || []).length, (p.stahnout || []).length], [0, 0]);
  ok('a je vidět, že se u nich prodalo', (p.prodano_u_nich || []).length === 1,
    JSON.stringify(p.prodano_u_nich));

  // Návrat z Čeká na sklad: radši vrátit stažený kus než zakládat nový
  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 50000), radekTricko('T-B', 'withdrawn', 50000)]);
  p = (await pika()).telo.plan;
  shoda('návrat na sklad vrátí stažený kus, nezaloží nový',
    [(p.vratit_do_prodeje || []).length, (p.vystavit || []).length], [1, 0]);

  // Cizí kus, o kterém sklad neví, se hlásí, ale nesahá se na něj
  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 50000), radekTricko('T-B', 'listed', 50000),
    { id: 'X-1', short_id: 'X-1', sku: 'CIZI-9', size: '44', status: 'listed', price_cents: 10000 }]);
  p = (await pika()).telo.plan;
  shoda('cizí vystavení se nestahuje', (p.stahnout || []).map(x => x.popis), []);
  ok('jen se ohlásí', (p.visi_navic_nezname || []).length === 1
    && p.visi_navic_nezname[0].id === 'X-1', JSON.stringify(p.visi_navic_nezname));

  sekce('10) Zápisy');
  let odeslane = [];
  const zapisovyScenar = (url, init) => {
    odeslane.push({ url, method: (init && init.method) || 'GET',
      telo: init && init.body ? JSON.parse(init.body) : null,
      klic: init && init.headers && init.headers['Idempotency-Key'] });
    if (/\/withdraw$|\/activate$/.test(url)) return Response.json({ ok: true });
    if (url.match(/\/listings\/[^/?]+$/)) return Response.json({ id: 'x', status: 'listed' });
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

  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 50000)], zapisovyScenar);
  const jenPlan = await srovnat({});
  shoda('bez provest se nic neodešle', odeslane.filter(x => x.method !== 'GET').map(x => x.url), []);
  ok('a je vidět, že se to teprve provede', /provest/.test(jenPlan.poznamka || ''), jenPlan.poznamka);

  const provedeno = await srovnat({ provest: true });
  const posty = odeslane.filter(x => x.method === 'POST');
  ok('vystavení odešlo', posty.length === 1 && /\/listings$/.test(posty[0].url),
    JSON.stringify(posty.map(x => x.method + ' ' + x.url)));
  ok('a hlásí se to zpět', (provedeno.provedeno.vystaveno || []).length === 1,
    JSON.stringify(provedeno.provedeno));
  const telo = posty[0].telo;
  shoda('tělo nese povinná pole a daňový režim',
    [telo.store_id, telo.consigner_id, telo.size, telo.vat_mode],
    [ME.store.id, ME.consigner.id, 'S', 'bazar']);
  ok('cena je v haléřích', telo.price_cents === 50000, JSON.stringify(telo));
  ok('neznámý stav zboží je opatrně „used"', telo.condition === 'used', String(telo.condition));
  ok('a bez pokynu se nepublikuje', telo.publish === false, String(telo.publish));

  /* Jejich stupnice je new | used | vnds. Naše DS a „Nové se štítky"
     jsou new, všechno ostatní used — lepší stav, než o jakém víme, se
     tvrdit nebude. */
  for (const [nas, jejich] of [['DS', 'new'], ['nove-stitky', 'new'],
    ['pouzite-dobre', 'used'], ['poskozene', 'used']]) {
    scenarSeSkladem([{ id: 'c1', name: 'Kus', sku: 'C-1', size: '42', category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 1000, condition: nas }],
      [], zapisovyScenar);
    await srovnat({ provest: true });
    const t = odeslane.filter(x => x.method === 'POST')[0];
    ok('stav zboží ' + nas + ' → ' + jejich, t && t.telo.condition === jejich,
      t && String(t.telo.condition));
  }
  ok('a značka s modelem se posílají u kusu bez katalogu',
    (function () {
      const t = odeslane.filter(x => x.method === 'POST')[0];
      return t && t.telo.custom_model === 'Kus' && t.telo.style_code === 'C-1';
    })(), JSON.stringify(odeslane.filter(x => x.method === 'POST')[0]));

  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 50000)], zapisovyScenar);
  await srovnat({ provest: true });
  ok('idempotenční klíč má tvar UUID',
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(posty[0].klic || ''),
    String(posty[0].klic));

  // Týž plán podruhé musí dát týž klíč — jinak by opakování založilo duplikát
  const klicPrvni = posty[0].klic;
  await srovnat({ provest: true });
  ok('a je stejný pro totéž tělo',
    odeslane.filter(x => x.method === 'POST')[0].klic === klicPrvni, 'klíč se změnil');

  // Publikovat se dá, ale jen na pokyn
  await srovnat({ provest: true, publikovat: true });
  ok('s publikovat: true jde kus rovnou do prodeje',
    odeslane.filter(x => x.method === 'POST')[0].telo.publish === true);

  sekce('11) Pojistky');
  /* Hromadné stažení skoro vždycky znamená rozbité párování nebo
     neúplnou odpověď, ne že by se přes noc prodal celý sklad. */
  const mnoho = [];
  for (let i = 0; i < 12; i++) mnoho.push(radekTricko('M-' + i, 'listed', 50000));
  scenarSeSkladem([], mnoho.map(x => x), zapisovyScenar);
  // sklad zná model (jsou v něm dvojčata), ale nic nemá viset
  scenarSeSkladem(DVOJCATA.map(x => Object.assign({}, x, { saleState: 'waiting' })), mnoho, zapisovyScenar);
  const stopka = await srovnat({ provest: true });
  ok('hromadné stažení se zarazí', stopka.stav === 'nezapisovalo se', JSON.stringify(stopka.stav));
  ok('a řekne proč', /stropem/.test(stopka.duvod || ''), stopka.duvod);
  shoda('a opravdu nic neodešlo', odeslane.filter(x => x.method !== 'GET').map(x => x.url), []);

  // Bez ověřených podmínek se taky nezapisuje
  scenarSeSkladem(DVOJCATA, [radekTricko('T-A', 'listed', 50000)], zapisovyScenar);
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

  sekce('12) Adresa je pod tokenem');
  const r404 = await bezLogu(() => worker.fetch(
    new Request('https://sklad.mtkm.workers.dev/spatny-token/pika'), ENV));
  ok('bez správného tokenu se nic neprozradí', r404.status === 404, String(r404.status));

  global.fetch = puvodniFetch;
  console.log('\n' + (selhalo ? selhalo + ' KONTROL SELHALO' : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
