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
  sekce('8b) Kus, který u nich možná visí pod jiným názvem');
  /* Všechny čtyři dvojice jsou ze skutečných dat. Jejich ručně založené
     inzeráty nemají SKU, takže se párují jedině podle názvu — a ten se
     liší o jediné slovo. Bez téhle pojistky by se čtyři z jedenadvaceti
     kusů založily podruhé vedle inzerátu, který už u nich visel. */
  /* Dvojice, které se liší jen slovem uvnitř názvu. „x" u spolupráce se
     přeskakuje, takže ty dva se spárují doopravdy (a při prodeji jinde
     se i stáhnou); „SE" a „Low" nezná nikdo, ty se jen odmítnou
     vystavit. Obojí je správně, jen jinak silné. */
  const spareno = [
    ['Jordan 5 Retro A Ma Maniére Dusk', "A Ma Maniére x Air Jordan 5 Retro 'Dusk'", '42'],
    ['adidas Samba OG JJJJound Tobacco', "JJJJound x adidas Samba OG 'Tobacco'", '38 2/3'],
  ];
  for (const [nas, jejich, vel] of spareno) {
    polozkySkladu = [{ id: 'x1', name: nas, sku: 'S-1', size: vel, category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 5000 }];
    scenar([radek({ id: 'jejich-1', sku: null, name: jejich, size: vel })]);
    v = await nahled();
    p = v.telo.plan;
    shoda('spáruje se doopravdy: ' + nas.slice(0, 26) + '…',
      [(p.vystavit || []).length, (p.mozna_uz_visi || []).length,
        (p.visi_navic_nezname || []).length], [0, 0, 0]);
  }

  const dvojice = [
    ['Air Jordan 3 Retro Craft Ivory', "Air Jordan 3 Retro SE Craft 'Ivory'", '43'],
    ['Nike Air Force 1 Low \'07 LV8 40th Anniversary Sail Malachite',
      "Nike Air Force 1 '07 LV8 '40th Anniversary - Sail Malachite'", '38.5'],
  ];
  for (const [nas, jejich, vel] of dvojice) {
    polozkySkladu = [{ id: 'x1', name: nas, sku: 'S-1', size: vel, category: 'sneakers',
      saleState: 'stock', location: 'Doma', targetPrice: 5000 }];
    scenar([radek({ id: 'jejich-1', sku: null, name: jejich, size: vel })]);
    v = await nahled();
    p = v.telo.plan;
    ok('nezaloží se podruhé: ' + nas.slice(0, 28) + '…',
      (p.vystavit || []).length === 0 && (p.mozna_uz_visi || []).length === 1,
      'vystavit=' + (p.vystavit || []).length + ' mozna=' + ((p.mozna_uz_visi || []).length));
  }
  ok('a je vidět, o který jejich inzerát jde',
    (v.telo.plan.mozna_uz_visi[0] || {}).jejich_id === 'jejich-1',
    JSON.stringify(v.telo.plan.mozna_uz_visi));

  /* Samostatné „x" u spolupráce se přeskakuje, takže tyhle dva názvy
     jsou po očištění shodné — kus se spáruje doopravdy, ne jen odmítne
     vystavit. Teprve tím se jejich inzerát začne chovat jako majitelův:
     když kus prodá jinde, stáhne se. */
  polozkySkladu = [{ id: 'x1', name: 'adidas Samba OG JJJJound Tobacco', sku: 'S-1',
    size: '38 2/3', category: 'sneakers', saleState: 'waiting', location: 'Doma',
    targetPrice: 3000 }];
  scenar([radek({ id: 'spolupr', sku: null, name: "JJJJound x adidas Samba OG 'Tobacco'",
    size: '38 2/3' })]);
  v = await nahled();
  shoda('spolupráce s „x" se spáruje a při prodeji jinde se stáhne',
    (v.telo.plan.stahnout || []).map(x => x.id), ['spolupr']);

  /* Ale velikosti se to dotknout nesmí — „XL" ani „2X" nejsou spolupráce. */
  polozkySkladu = [{ id: 'x2', name: 'Tričko XL', sku: 'T-9', size: 'XL',
    category: 'obleceni', saleState: 'stock', location: 'Doma', targetPrice: 500 }];
  scenar([radek({ id: 'jine', sku: null, name: 'Tričko', size: 'XL' })]);
  v = await nahled();
  ok('„XL" v názvu zůstává', (v.telo.plan.mozna_uz_visi || []).length === 0
    && (v.telo.plan.vystavit || []).length === 1,
    JSON.stringify(v.telo.plan.vystavit) + JSON.stringify(v.telo.plan.mozna_uz_visi));

  /* Jiná velikost je jiný kus — ta se vystavit má, i když se název
     podobá. Bez tohohle by pojistka spolkla celou řadu velikostí. */
  polozkySkladu = [{ id: 'x1', name: 'Air Jordan 3 Retro Craft Ivory', sku: 'S-1', size: '44',
    category: 'sneakers', saleState: 'stock', location: 'Doma', targetPrice: 5000 }];
  scenar([radek({ id: 'jejich-1', sku: null, name: "Air Jordan 3 Retro SE Craft 'Ivory'", size: '43' })]);
  v = await nahled();
  shoda('jiná velikost se vystaví normálně',
    [(v.telo.plan.vystavit || []).length, (v.telo.plan.mozna_uz_visi || []).length], [1, 0]);

  /* Krátký název sedí na půlku skladu — od tří slov výš, jinak by
     „Nike Dunk" zablokoval všechno. */
  polozkySkladu = [{ id: 'x1', name: 'Nike Dunk', sku: 'S-1', size: '42', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 5000 }];
  scenar([radek({ id: 'jejich-1', sku: null, name: 'Nike Dunk Low Panda', size: '42' })]);
  v = await nahled();
  shoda('krátký název pojistku nespustí',
    [(v.telo.plan.vystavit || []).length, (v.telo.plan.mozna_uz_visi || []).length], [1, 0]);

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('8c) Stav approved');
  /* Ostrá data: sedmnáct inzerátů ve stavu `approved`, který jejich
     dokumentace vůbec neuvádí. Kus, který u nich čeká na vystavení,
     se nesmí založit podruhé — a když se prodá jinde, musí jít pryč
     stejně jako vystavený. */
  polozkySkladu = [{ id: 'ap', name: 'Kus', sku: 'AP-1', size: '42', category: 'sneakers',
    saleState: 'stock', location: 'Doma', targetPrice: 1000 }];
  scenar([radek({ sku: 'AP-1', size: '42', status: 'approved' })]);
  v = await nahled();
  shoda('approved se nezakládá podruhé',
    [(v.telo.plan.vystavit || []).length, (v.telo.plan.stahnout || []).length], [0, 0]);
  polozkySkladu = [{ id: 'ap', name: 'Kus', sku: 'AP-1', size: '42', category: 'sneakers',
    saleState: 'waiting', location: 'Doma', targetPrice: 1000 }];
  scenar([radek({ sku: 'AP-1', size: '42', status: 'approved' })]);
  v = await nahled();
  shoda('a když se kus prodá jinde, jde pryč taky',
    (v.telo.plan.stahnout || []).map(x => x.stav), ['approved']);

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
  sekce('11) Bez pokynu se nic nezapisuje');
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' })];
  scenar([]);
  await nahled();
  shoda('náhled posílá jen GETy',
    volani.filter(x => x.url.includes('consignor-api') && x.method !== 'GET')
      .map(x => x.method + ' ' + x.url), []);

  async function srovnat(args, env = ENV) {
    volani = [];
    const r = await bezLogu(() => worker.fetch(new Request(
      'https://sklad.mtkm.workers.dev/' + env.MCP_TOKEN + '/mcp',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'pk_srovnat', arguments: args || {} } }) }), env));
    const o = await r.json();
    let telo = null;
    try { telo = JSON.parse(o.result.content[0].text); } catch (e) {}
    return { telo, zapisy: volani.filter(x => x.url.includes('consignor-api') && x.method !== 'GET') };
  }

  let z = await srovnat({});
  shoda('a bez provest taky', z.zapisy.map(x => x.method), []);
  ok('jen se řekne, že se to teprve provede', /provest/.test((z.telo || {}).poznamka || ''),
    (z.telo || {}).poznamka);

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('12) Vystavení a stažení');
  z = await srovnat({ provest: true });
  shoda('nový kus jde POSTem na /listings', z.zapisy.map(x => x.method), ['POST']);
  /* Odpověď nesmí vedle seznamu provedených úkonů tvrdit, že se nic
     nezměnilo — přesně to dělala po prvním ostrém stažení. */
  ok('a odpověď netvrdí, že se nic nezměnilo',
    !/nic se u nich nezměnilo/.test((z.telo || {}).poznamka || ''), (z.telo || {}).poznamka);
  const telo = JSON.parse(z.zapisy[0].init.body || '{}');
  shoda('a nese jen to, co jejich API čeká',
    Object.keys(telo).sort(), ['payout', 'quantity', 'size', 'sku']);
  /* Cena je payout: co majitel chce dostat. Poplatky si k tomu
     připočítají sami — nepočítá se z ní, ale přičítá se k ní. */
  shoda('cena je cílovka beze změny a kus jeden',
    [telo.payout, telo.quantity, telo.sku, telo.size], [1000, 1, 'AA-1', '42']);
  ok('a hlásí se to zpět', ((z.telo.provedeno || {}).vystaveno || []).length === 1,
    JSON.stringify(z.telo.provedeno));

  /* Stažení je u nich DELETE, ne zvláštní sloveso. */
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a', saleState: 'waiting' })];
  scenar([radek({ id: 'ke-smazani', sku: 'AA-1', size: '42' })]);
  z = await srovnat({ provest: true });
  shoda('stažení jde DELETEm na konkrétní id',
    z.zapisy.map(x => x.method + ' ' + x.url.split('/consignor-api')[1]),
    ['DELETE /listings/ke-smazani']);

  /* Stahuje se první: kus, který se prodal, nemá u nich viset ani
     o minutu déle, než musí — druhý kupec je horší než pozdní inzerát. */
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' }),
    { id: 'b', name: 'Jiný kus', sku: 'BB-1', size: '43', category: 'sneakers',
      saleState: 'waiting', location: 'Doma', targetPrice: 2000 }];
  scenar([radek({ id: 'pryc', sku: 'BB-1', size: '43' })]);
  z = await srovnat({ provest: true });
  shoda('stažení jde před vystavením', z.zapisy.map(x => x.method), ['DELETE', 'POST']);

  // Opatrný rozjezd
  const petKusu = [];
  for (let i = 0; i < 5; i++) {
    petKusu.push({ id: 'k' + i, name: 'Kus ' + i, sku: 'K-' + i, size: '42',
      category: 'sneakers', saleState: 'stock', location: 'Doma', targetPrice: 1000 });
  }
  polozkySkladu = petKusu;
  scenar([]);
  z = await srovnat({ provest: true, nejvyse: 2 });
  shoda('nejvyse omezí, kolik se toho udělá', z.zapisy.length, 2);
  ok('a řekne se, kolik zbývá', /Zbývá 3/.test(z.telo.poznamka || ''), z.telo.poznamka);
  z = await srovnat({ provest: true, jen: 'stahnout' });
  shoda('jen: stahnout nic nevystaví', z.zapisy.length, 0);

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('13) Pojistka proti hromadnému stažení');
  /* Dvanáct kusů ke stažení naráz obvykle znamená rozbité párování nebo
     neúplnou odpověď, ne že by se přes noc prodal celý sklad. */
  const mnoho = [], jejichMnoho = [];
  for (let i = 0; i < 12; i++) {
    mnoho.push({ id: 'm' + i, name: 'Kus ' + i, sku: 'M-' + i, size: '42',
      category: 'sneakers', saleState: 'waiting', location: 'Doma', targetPrice: 1000 });
    jejichMnoho.push(radek({ id: 'jm' + i, sku: 'M-' + i, size: '42' }));
  }
  polozkySkladu = mnoho;
  scenar(jejichMnoho);
  z = await srovnat({ provest: true });
  shoda('hromadné stažení se zarazí a nic neodejde',
    [(z.telo || {}).stav, z.zapisy.length], ['nezapisovalo se', 0]);
  ok('a řekne proč', /stropem/.test((z.telo || {}).duvod || ''), (z.telo || {}).duvod);

  /* ══════════════════════════════════════════════════════════════════ */
  sekce('14) Automatický běh (cron)');
  /* Nikdo se u toho nedívá, takže platí totéž co u Pikastore: nižší
     strop zápisů a mail pokaždé, když se něco změnilo nebo nepovedlo. */
  const CRON_ENV = Object.assign({}, ENV, { RESEND_API_KEY: 'k', MAIL_KOMU: 'ja@sklad.cz' });
  const UTERY = Date.parse('2026-09-08T13:00:00Z');   // v Praze 15:00, není pondělí
  const PONDELI = Date.parse('2026-09-07T13:00:00Z');
  let posta = [];
  const fetchPredCronem = global.fetch;
  global.fetch = async (vstup, init) => {
    const url = String(vstup && vstup.url ? vstup.url : vstup);
    if (url.includes('resend')) { posta.push(JSON.parse(init.body)); return Response.json({ id: 'm1' }); }
    return fetchPredCronem(vstup, init);
  };
  const puvodniNow = Date.now;
  async function cron(ted = UTERY, env = CRON_ENV) {
    volani = []; posta = [];
    Date.now = () => ted;
    try { await bezLogu(() => worker.scheduled({ cron: '0 */3 * * *' }, env, {})); }
    finally { Date.now = puvodniNow; }
    return { zapisy: volani.filter(x => x.url.includes('consignor-api') && x.method !== 'GET'), posta };
  }

  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' })];
  scenar([]);
  let c = await cron();
  shoda('cron vystaví, co má viset', c.zapisy.map(x => x.method), ['POST']);
  ok('a o změně přijde mail', c.posta.length === 1
    && /vystaveno: Kus/.test((c.posta[0] || {}).text || ''), JSON.stringify(c.posta).slice(0, 200));

  // Srovnaný sklad: nic se neděje a mail nechodí
  scenar([radek({ sku: 'AA-1', size: '42' })]);
  c = await cron();
  shoda('srovnaný sklad neudělá nic a mlčí', [c.zapisy.length, c.posta.length], [0, 0]);

  /* Kus bez SKU se tudy vystavit nedá a musí se nahodit ručně. Je to
     stav, ne okamžik — chodí proto jen v pondělí, jinak by se ta
     připomínka po týdnu přestala číst. */
  polozkySkladu = [{ id: 'ns', name: 'Kus bez SKU', size: 'L', category: 'obleceni',
    saleState: 'stock', location: 'Doma', targetPrice: 1000 }];
  scenar([]);
  c = await cron(UTERY);
  shoda('v úterý se kus bez SKU nepřipomíná', [c.zapisy.length, c.posta.length], [0, 0]);
  c = await cron(PONDELI);
  ok('v pondělí ano', c.posta.length === 1
    && /Kus bez SKU/.test((c.posta[0] || {}).text || ''), JSON.stringify(c.posta).slice(0, 250));
  ok('a je z mailu jasné, že se má nahodit ručně',
    /ručně/.test((c.posta[0] || {}).text || ''), (c.posta[0] || {}).text);

  // Potíž se musí ozvat
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' })];
  scenar([], (url, init) => ((init && init.method) === 'POST'
    ? Response.json({ detail: 'cena mimo rozsah' }, { status: 400 }) : null));
  c = await cron();
  ok('o potíži přijde mail', c.posta.length === 1
    && /cena mimo rozsah/.test((c.posta[0] || {}).text || ''), JSON.stringify(c.posta).slice(0, 250));

  /* Automatický běh má nižší strop než ruční — u ručního si plán majitel
     přečte a zarazí ho, u automatického se nedívá nikdo. */
  const patnact = [];
  for (let i = 0; i < 15; i++) {
    patnact.push({ id: 'c' + i, name: 'Kus ' + i, sku: 'C-' + i, size: '42',
      category: 'sneakers', saleState: 'stock', location: 'Doma', targetPrice: 1000 });
  }
  polozkySkladu = patnact;
  scenar([]);
  c = await cron();
  shoda('víc než strop se v jednom automatickém běhu nezapíše', c.zapisy.length, 10);

  // Bez klíče ke komisi se cron o Purekickz vůbec nepokouší
  const bezPk = Object.assign({}, CRON_ENV); delete bezPk.PUREKICKZ_TOKEN;
  scenar([]);
  c = await cron(UTERY, bezPk);
  shoda('bez klíče cron mlčí', [c.zapisy.length, c.posta.length], [0, 0]);

  /* Pád jednoho komisionáře nesmí umlčet druhého ani ranní obhlídku —
     jsou to nezávislé věci a běží po sobě. */
  polozkySkladu = [Object.assign({}, zaklad, { id: 'a' })];
  scenar([], () => Response.json({ error: 'server_error' }, { status: 500 }));
  let vyletelo = null;
  volani = []; posta = [];
  Date.now = () => UTERY;
  try { await bezLogu(() => worker.scheduled({ cron: '0 */3 * * *' }, CRON_ENV, {})); }
  catch (e) { vyletelo = String((e && e.message) || e); }
  finally { Date.now = puvodniNow; }
  ok('pád komise nevyletí z cronu ven', vyletelo === null, vyletelo);
  ok('a ozve se mailem', posta.some(x => /Purekickz/.test(x.subject || '')),
    JSON.stringify(posta.map(x => x.subject)));
  global.fetch = fetchPredCronem;

  // Adresa je pod tokenem
  const r404 = await bezLogu(() => worker.fetch(
    new Request('https://sklad.mtkm.workers.dev/spatny-token/pk'), ENV));
  ok('bez správného tokenu se nic neprozradí', r404.status === 404, String(r404.status));

  global.fetch = puvodniFetch;
  console.log('\n' + (selhalo ? selhalo + ' KONTROL SELHALO' : 'OK (' + proslo + ' kontrol)'));
  process.exit(selhalo ? 1 : 0);
})();
