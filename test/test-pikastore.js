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

  function odpovezSklad(url) {
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
  }

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
  function scenarOk(strankaPo = 50) {
    return (url) => {
      if (url.endsWith('/me')) return Response.json(ME);
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

  sekce('6) Adresa je pod tokenem');
  const r404 = await bezLogu(() => worker.fetch(
    new Request('https://sklad.mtkm.workers.dev/spatny-token/pika'), ENV));
  ok('bez správného tokenu se nic neprozradí', r404.status === 404, String(r404.status));

  global.fetch = puvodniFetch;
  console.log('\n' + (selhalo ? selhalo + ' KONTROL SELHALO' : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
