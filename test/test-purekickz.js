// Test: druhý komisní prodej (Purekickz).
//
// Pravidla chování skladu jsou stejná jako u Pikastore a schválně se
// sdílejí — skupiny, velikosti, názvy i důvody, proč kus zůstat stranou.
// Druhá kopie těch pravidel by se s tou první dřív nebo později rozešla,
// a právě to tenhle test hlídá: co platí u jednoho komisionáře, musí
// platit i u druhého.
//
// Vlastní je jen jejich API: klíč v hlavičce, cena je rovnou payout
// v korunách a nový kus se zakládá přímo přes SKU.

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
  MCP_TOKEN: 'tajny-token-do-adresy', PUREKICKZ_TOKEN: 'pk_live_tajny_klic',
};

// Jejich řádek tak, jak ho popisuje jejich dokumentace
const radek = (o) => Object.assign({
  id: '3f9c1b7e-4d21-4c0a-9f2b-88d1c0e4a512', sku: 'DV0831-001', brand: 'Nike',
  name: 'Dunk Low Panda', size: '42', payout: 4500, quantity: 1, status: 'listed',
}, o || {});

(async function () {
  const { default: worker } = await import(path.resolve(__dirname, '..', 'konektor', 'worker.js'));
  const puvodniFetch = global.fetch;
  const puvodniLog = console.log, puvodniErr = console.error;

  let volani = [];
  let pkOdpovedi = null;
  let polozkySkladu = [];

  global.fetch = async (vstup, init) => {
    const url = String(vstup && vstup.url ? vstup.url : vstup);
    volani.push({ url, method: (init && init.method) || 'GET', init: init || {} });
    if (url.includes('cnb.cz')) {
      return new Response('03.09.2026 #170\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|25,000\n');
    }
    if (url.includes('consignor-api')) return pkOdpovedi(url, init || {});
    if (url.includes('identitytoolkit')) return Response.json({ idToken: 't', localId: 'u1' });
    if (url.includes(':batchGet')) {
      return Response.json([{ found: dok('users/u1/sklad/data', {
        savedAt: '2026-09-08T06:00:00.000Z', items: polozkySkladu }) }]);
    }
    if (url.includes('/sklad?') || url.endsWith('/sklad')) {
      return Response.json({ documents: [{ name: 'projects/x/databases/(default)/documents/users/u1/sklad/data' }] });
    }
    return Response.json({});
  };

  async function bezLogu(fn) {
    console.log = () => {}; console.error = () => {};
    try { return await fn(); } finally { console.log = puvodniLog; console.error = puvodniErr; }
  }

  // Výchozí, zdravý scénář: /me projde, /listings vrátí zadané řádky
  function scenar(radky, extra) {
    pkOdpovedi = (url, init) => {
      if (url.endsWith('/me')) {
        return Response.json({ consignor: { name: 'Michal', id: 7 }, read_only: false });
      }
      if (url.includes('/listings')) {
        if (extra) { const o = extra(url, init); if (o) return o; }
        const q = new URL(url).searchParams;
        const offset = Number(q.get('offset') || 0);
        const limit = Number(q.get('limit') || 100);
        return Response.json({ total: radky.length, listings: radky.slice(offset, offset + limit) });
      }
      return Response.json({});
    };
  }

  async function nahled(env = ENV) {
    volani = [];
    const r = await bezLogu(() => worker.fetch(
      new Request('https://sklad.mtkm.workers.dev/' + env.MCP_TOKEN + '/pk'), env));
    return { stav: r.status, telo: await r.json() };
  }

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('1) Přihlášení klíčem v hlavičce');
  polozkySkladu = [{ id: '1', name: 'Dunk Low Panda', sku: 'DV0831-001', size: '42',
    category: 'sneakers', saleState: 'stock', location: 'Doma', targetPrice: 4500 }];
  scenar([radek()]);
  let v = await nahled();
  ok('náhled projde', v.stav === 200 && v.telo.stav === 'ok', JSON.stringify(v.telo).slice(0, 200));
  const hlavicky = volani.filter(x => x.url.includes('consignor-api'))
    .map(x => (x.init.headers || {})['X-API-Key']);
  ok('klíč jde v hlavičce X-API-Key', hlavicky.length > 0 && hlavicky.every(h => h === ENV.PUREKICKZ_TOKEN),
    JSON.stringify(hlavicky));
  /* Klíč v adrese by skončil v logu proxy i v historii prohlížeče —
     patří do hlavičky a nikam jinam. */
  ok('a nikde v adrese', !volani.some(x => x.url.includes('pk_live')),
    JSON.stringify(volani.map(x => x.url)));

  const bezKlice = Object.assign({}, ENV); delete bezKlice.PUREKICKZ_TOKEN;
  v = await nahled(bezKlice);
  ok('bez klíče se řekne, co doplnit', v.telo.duvod === 'nenastaveno'
    && /PUREKICKZ_TOKEN/.test(v.telo.chyba || ''), JSON.stringify(v.telo));
  ok('a na jejich API se vůbec nesáhne',
    !volani.some(x => x.url.includes('consignor-api')), JSON.stringify(volani.map(x => x.url)));

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('2) Co u nich sedí a co chybí');
  scenar([radek()]);
  v = await nahled();
  let p = v.telo.plan;
  shoda('spárovaný kus se neřeší',
    [(p.vystavit || []).length, (p.stahnout || []).length, (p.visi_navic_nezname || []).length],
    [0, 0, 0]);

  // Kus doma, u nich nic → vystavit
  scenar([]);
  v = await nahled();
  p = v.telo.plan;
  ok('kus, který u nich chybí, se má vystavit', (p.vystavit || []).length === 1,
    JSON.stringify(p.vystavit));
  ok('a je vidět, co za něj přijde', p.vystavit[0].dostanes_kc === 4500,
    JSON.stringify(p.vystavit[0]));

  /* Kus, který sklad zná, ale k prodeji už není (prodal se jinde),
     musí z komise pryč — jinak by ho někdo koupil a majitel by ho neměl
     čím dodat. Kus, o kterém sklad nikdy nevěděl, je něco jiného: toho
     se to nedotkne (viz sekce 8). */
  polozkySkladu = [{ id: '1', name: 'Dunk Low Panda', sku: 'DV0831-001', size: '42',
    category: 'sneakers', saleState: 'waiting', location: 'Doma', targetPrice: 4500 }];
  scenar([radek()]);
  v = await nahled();
  p = v.telo.plan;
  shoda('co doma není, se stáhne', (p.stahnout || []).map(x => x.duvod),
    ['ve skladu už není k prodeji']);
  ok('a nese jejich id na smazání',
    !!p.stahnout[0] && p.stahnout[0].id === '3f9c1b7e-4d21-4c0a-9f2b-88d1c0e4a512',
    JSON.stringify(p.stahnout[0]));

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('3) Cena je rovnou payout');
  /* U nich se posílá výplata, ne cena na pultě — poplatek i webovou cenu
     si dopočítají sami. Odpadá tím provize i koncovka 90; na cenu, za
     kterou to visí, konektor nevidí a nemá ji co počítat. */
  polozkySkladu = [{ id: '1', name: 'Kus', sku: 'AA-1', size: '42', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 4321 }];
  scenar([]);
  v = await nahled();
  ok('posílá se cílová cena beze změny', v.telo.plan.vystavit[0].dostanes_kc === 4321,
    JSON.stringify(v.telo.plan.vystavit[0]));

  // Eurová cílovka se přepočítá dnešním kurzem
  polozkySkladu = [{ id: '1', name: 'Kus', sku: 'AA-1', size: '42', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 5000, targetCurrency: 'EUR',
    targetPriceEur: 200 }];
  v = await nahled();
  ok('eurová cílovka se přepočítá dnešním kurzem',
    v.telo.plan.vystavit[0].dostanes_kc === 5000, JSON.stringify(v.telo.plan.vystavit[0]));

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('4) Zakládá se přes SKU');
  /* Kus bez SKU tudy založit nejde a hádat model podle názvu by
     znamenalo pověsit ho na cizí zboží. Radši se nevystaví. */
  polozkySkladu = [{ id: '1', name: 'Kus bez SKU', size: 'L', category: 'obleceni',
    saleState: 'stock', location: 'Doma', targetPrice: 1000 }];
  scenar([]);
  v = await nahled();
  shoda('bez SKU se nevystaví, jen se řekne',
    [(v.telo.plan.vystavit || []).length, (v.telo.plan.bez_sku || []).map(x => x.nazev)],
    [0, ['Kus bez SKU']]);

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('5) Stejná pravidla jako u Pikastore');
  /* Tohle je celý smysl sdílených funkcí: co platí u jednoho
     komisionáře, musí platit i u druhého. */
  const zaklad = { id: '1', name: 'Kus', sku: 'AA-1', size: '42', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 1000 };
  const pripady = [
    ['poškozený kus se nevystavuje', { condition: 'poskozene' }, 'nevystavuje_se'],
    ['kus na cestě taky ne', { location: 'Na cestě' }, 'nevystavuje_se'],
    ['ani ten, co se bude vracet', { location: 'Bude vráceno' }, 'nevystavuje_se'],
    ['bez cílové ceny taky ne', { targetPrice: undefined }, 'bez_cilove_ceny'],
  ];
  for (const [popis, zmena, kam] of pripady) {
    polozkySkladu = [Object.assign({}, zaklad, zmena)];
    scenar([]);
    v = await nahled();
    p = v.telo.plan;
    ok(popis, (p.vystavit || []).length === 0 && (p[kam] || []).length === 1,
      'vystavit=' + (p.vystavit || []).length + ' ' + kam + '=' + ((p[kam] || []).length));
  }
  // A nic z toho není důvod stáhnout, co za kus u nich visí
  for (const [popis, zmena] of pripady) {
    polozkySkladu = [Object.assign({}, zaklad, zmena)];
    scenar([radek({ sku: 'AA-1', size: '42' })]);
    v = await nahled();
    ok('a nestahuje se kvůli tomu (' + popis + ')',
      (v.telo.plan.stahnout || []).length === 0, JSON.stringify(v.telo.plan.stahnout));
  }
  // Ale kus, který už majitelův není, se stáhnout musí
  polozkySkladu = [Object.assign({}, zaklad, { location: 'Vráceno' })];
  scenar([radek({ sku: 'AA-1', size: '42' })]);
  v = await nahled();
  shoda('vrácený kus se stáhne', (v.telo.plan.stahnout || []).length, 1);

  // Velikosti se srovnávají stejně jako u Pikastore
  polozkySkladu = [Object.assign({}, zaklad, { size: '42' })];
  scenar([radek({ sku: 'AA-1', size: 'EU42' })]);
  v = await nahled();
  shoda('EU42 u nich je naše 42',
    [(v.telo.plan.vystavit || []).length, (v.telo.plan.stahnout || []).length], [0, 0]);

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('6) Jeden inzerát na model a velikost');
  /* Majitel listuje jeden kus, i když jich má víc — tak to dělal ručně
     a chce to tak dál. Na počtu kusů v jejich inzerátu proto nezáleží;
     rozhoduje jen to, jestli tam nějaký činný je. */
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' }), Object.assign({}, zaklad, { id: 'b' })];
  scenar([]);
  v = await nahled();
  shoda('ze dvou stejných kusů se vystaví jeden', (v.telo.plan.vystavit || []).length, 1);
  scenar([radek({ sku: 'AA-1', size: '42', quantity: 1 })]);
  v = await nahled();
  shoda('a když jeden visí, druhý se nepřidává',
    [(v.telo.plan.vystavit || []).length, (v.telo.plan.stahnout || []).length], [0, 0]);
  // Tři kusy doma, jeden inzerát u nich — pořád se nic nepřidává
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' }), Object.assign({}, zaklad, { id: 'b' }),
    Object.assign({}, zaklad, { id: 'c' })];
  scenar([radek({ sku: 'AA-1', size: '42', quantity: 1 })]);
  v = await nahled();
  shoda('tři kusy doma a jeden inzerát u nich znamená nic nedělat',
    [(v.telo.plan.vystavit || []).length, (v.telo.plan.stahnout || []).length], [0, 0]);
  // Kolik kusů inzerát nese, je jen informace do výpisu
  polozkySkladu = [];
  scenar([radek({ sku: 'CIZI-9', size: '44', quantity: 3 })]);
  v = await nahled();
  shoda('počet kusů se ve výpisu ukáže',
    (v.telo.plan.visi_navic_nezname || []).map(x => x.kusu), [3]);

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('7) Prodej u nich');
  /* Prodaný kus, o kterém sklad ještě neví, brzdí vystavování — jinak
     by se vystavil znovu kus, který majitel fyzicky nemá. */
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' })];
  scenar([radek({ sku: 'AA-1', size: '42', status: 'sold',
    updated_at: new Date(Date.now() - 3600000).toISOString() })]);
  v = await nahled();
  p = v.telo.plan;
  shoda('čerstvý prodej brzdí vystavování',
    [(p.vystavit || []).length, (p.ceka_na_sklad || []).length], [0, 1]);
  ok('a prodej se hlásí', (p.prodano_u_nich || []).length === 1, JSON.stringify(p.prodano_u_nich));
  ok('prodaný inzerát se nestahuje',
    (p.stahnout || []).length === 0, JSON.stringify(p.stahnout));

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('8) Co u nich visí a sklad o tom neví');
  polozkySkladu = [];
  scenar([radek({ sku: 'CIZI-1', size: '44' })]);
  v = await nahled();
  ok('cizí inzerát se jen ohlásí', (v.telo.plan.visi_navic_nezname || []).length === 1,
    JSON.stringify(v.telo.plan.visi_navic_nezname));
  ok('a nestahuje se', (v.telo.plan.stahnout || []).length === 0,
    JSON.stringify(v.telo.plan.stahnout));

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('9) Odpověď se čte opatrně');
  /* Jejich dokumentace stavy nevyjmenovává. Neznámý stav nesmí nic
     shodit ani nic strhnout — jen se ohlásí, ať se pravidla dopíšou
     podle faktů. */
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' })];
  scenar([radek({ sku: 'AA-1', size: '42', status: 'reserved', novePole: 'neco' })]);
  v = await nahled();
  ok('neznámý stav nic neshodí', v.telo.stav === 'ok', JSON.stringify(v.telo).slice(0, 150));
  ok('a je vidět, že se objevil',
    (v.telo.u_nich.stavy_mimo_ocekavani || []).indexOf('reserved') !== -1,
    JSON.stringify(v.telo.u_nich.stavy_mimo_ocekavani));
  ok('vypíšou se i jména polí',
    (v.telo.u_nich.pole_v_odpovedi || []).indexOf('novePole') !== -1,
    JSON.stringify(v.telo.u_nich.pole_v_odpovedi));
  ok('kus s neznámým stavem se nestahuje', (v.telo.plan.stahnout || []).length === 0,
    JSON.stringify(v.telo.plan.stahnout));

  // Změněný tvar odpovědi se pozná, místo aby se tvářil jako prázdný sklad
  polozkySkladu = [];
  scenar([], () => Response.json({ total: 1, items: [radek()] }));
  v = await nahled();
  ok('chybějící pole `listings` se pozná', /listings/.test(v.telo.chyba || ''),
    JSON.stringify(v.telo));

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('10) Chyby jejich API');
  const chyby = [
    [401, 'token', /klíč nebere/],
    [403, 'token', /nemá právo/],
  ];
  for (const [stav, kod, vzor] of chyby) {
    scenar([], () => Response.json({ error: 'x' }, { status: stav }));
    v = await nahled();
    ok('HTTP ' + stav + ' se pozná', (v.telo.duvod === kod) && vzor.test(v.telo.chyba || ''),
      JSON.stringify(v.telo));
  }
  /* Překročený limit (60 za minutu) není chyba klíče — čeká se, kolik
     řeknou, a když je to moc, nechá se to na příští běh. */
  scenar([], () => Response.json({ error: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': '600' } }));
  v = await nahled();
  ok('překročený limit se nezamění za neplatný klíč', v.telo.duvod === 'zahlceno',
    JSON.stringify(v.telo));

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('11) Zatím se nic nezapisuje');
  /* Zápisy se dopíšou, až bude z ostrých dat jisté, co jejich odpověď
     doopravdy nese. Do té doby nesmí odejít nic jiného než GET. */
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' })];
  scenar([]);
  await nahled();
  shoda('na jejich API jdou jen GETy',
    volani.filter(x => x.url.includes('consignor-api') && x.method !== 'GET')
      .map(x => x.method + ' ' + x.url), []);

  // Adresa je pod tokenem
  const r404 = await bezLogu(() => worker.fetch(
    new Request('https://sklad.mtkm.workers.dev/spatny-token/pk'), ENV));
  ok('bez správného tokenu se nic neprozradí', r404.status === 404, String(r404.status));

  global.fetch = puvodniFetch;
  console.log('\n' + (selhalo ? selhalo + ' KONTROL SELHALO' : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
