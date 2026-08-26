// Upozornění e-mailem z konektoru (konektor/worker.js).
//
// Firestore i pošta jsou podstrčené, čas taky — jinak by test platil
// jen v den, kdy se píše. Worker se volá přímo jako funkce, nic se
// nikam nenasazuje a nic neodchází ven.
//
// Hlídá se hlavně to, na čem celá věc stojí: že se každá věc ozve
// právě v den svého prahu a jinak je ticho. Upozornění, které chodí
// pořád, se přestane číst — a pak je k ničemu i to důležité.

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
const DEN = 86400000;

// Pevný okamžik: úterý 25. 8. 2026, 08:00 UTC = 10:00 v Praze (letní čas)
const RANO_LETO = Date.UTC(2026, 7, 25, 8, 0, 0);

let DOKUMENTY = {};
let volani = [];
let posta = [];
let logy = [];

function odp(status, telo, jakoText) {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => telo,
    text: async () => (jakoText !== undefined ? jakoText : JSON.stringify(telo)),
  };
}

global.fetch = async function (url, opts = {}) {
  const a = String(url);
  volani.push({ url: a, method: (opts.method || 'GET').toUpperCase(), telo: opts.body });
  if (a.includes('signInWithPassword')) return odp(200, { idToken: 'TOKEN', localId: 'ctecka1' });
  if (a.includes('api.resend.com')) {
    posta.push(JSON.parse(opts.body));
    return odp(200, { id: 'mail_1' });
  }
  if (a.includes(':batchGet')) {
    return odp(200, JSON.parse(opts.body).documents.map(n => {
      const id = n.split('/').pop();
      return DOKUMENTY[id] ? { found: dok(n, DOKUMENTY[id]) } : { missing: n };
    }));
  }
  if (a.includes('/crm/main')) {
    return odp(200, dok('crm/main', { customers: [{ id: 'c1', name: 'Petr Novák', phone: '777123456' }], partners: [] }));
  }
  if (a.includes('/sklad')) {
    return odp(200, { documents: Object.keys(DOKUMENTY).map(id => ({ name: KOL + '/' + id, fields: {} })) });
  }
  return odp(404, {});
};

const ENV = {
  SKLAD_EMAIL: 'ctecka@sklad.local', SKLAD_HESLO: 'tajne', SKLAD_UID: UID,
  MCP_TOKEN: 'tajnytokentajnytokentajnytoken12',
  RESEND_API_KEY: 're_test', MAIL_KOMU: 'majitel@example.com',
};

// Sklad postavený tak, aby v daný den padly zvolené prahy.
// platGroups jde do cloudu jako text (syncSettings, shape 'text') — tady
// schválně taky, ať se testuje i to rozbalení.
function nastavSklad(polozky, skupiny) {
  DOKUMENTY = {
    data: {
      savedAt: '2026-08-24T09:30:00Z', itemsStock: polozky, archiveYears: [], items: [],
      platGroups: JSON.stringify(skupiny || {
        platforms: ['StockX'], eshopy: ['Sneakerstore'], local: ['Bazoš.cz', 'Vinted'],
      }),
    },
  };
}
// Kdy se musel inzerát zaškrtnout, aby dnes zbývalo `zbyva` dní z šedesáti
const inzeratZbyva = (ted, zbyva) => ted - (60 - zbyva) * DEN;
// Datum prodeje tak, aby dnes čekal `dnu` dní (v ISO tvaru)
function prodanoPred(ted, dnu) {
  return new Date(ted - dnu * DEN).toISOString().slice(0, 10);
}

(async function () {
  const puvodniNow = Date.now;
  const puvodniLog = console.log, puvodniErr = console.error;
  const vypis = (...a) => puvodniLog(...a);

  const { default: worker } = await import(path.resolve(__dirname, '..', 'konektor', 'worker.js'));

  /* Worker si do logu píše schválně — cron bez logu je němý. Tady se ten
     log zachytává místo vypisování, ať se dá kontrolovat a ať se nemíchá
     do výpisu testu. */
  async function bezLogu(fn) {
    logy = [];
    console.log = (...a) => { logy.push(String(a[0])); };
    console.error = (...a) => { logy.push(String(a[0])); };
    try { return await fn(); } finally { console.log = puvodniLog; console.error = puvodniErr; }
  }

  // Spustí denní obhlídku v zadaném okamžiku a vrátí, co odešlo
  async function cron(ted, env = ENV) {
    posta = []; volani = [];
    Date.now = () => ted;
    try { await bezLogu(() => worker.scheduled({}, env, {})); } finally { Date.now = puvodniNow; }
    return posta;
  }
  async function get(cesta, ted = RANO_LETO, env = ENV) {
    posta = []; volani = [];
    Date.now = () => ted;
    try {
      const r = await bezLogu(() =>
        worker.fetch(new Request('https://sklad.workers.dev' + cesta, { method: 'GET' }), env));
      return { status: r.status, telo: await r.json().catch(() => null) };
    } finally { Date.now = puvodniNow; }
  }

  /* ══════════════════════════════════════════════════════════════ */
  sekce('1) Inzeráty na Bazoši');
  nastavSklad([
    { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) } },
    { id: 'b', name: 'Jordan 4 Bred', sku: 'JD4', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 1) } },
  ]);
  let m = await cron(RANO_LETO);

  ok('v den vypršení se ozve', m.length === 1, JSON.stringify(m.map(x => x.subject)));
  ok('a je to ten správný kus', m[0] && /Dunk Low Panda/.test(m[0].text));
  ok('den předem ještě ticho', m[0] && !/Jordan 4 Bred/.test(m[0].text), m[0] && m[0].text);
  ok('předmět mluví v minulém čase', m[0] && /1 inzerát vypršel/.test(m[0].subject), m[0] && m[0].subject);
  ok('řekne, co s tím', m[0] && /nahoď je znovu z archivu/.test(m[0].text), m[0] && m[0].text);

  /* Tohle je jádro celé věci. Kdyby se z prahu stal rozsah, mail by chodil
     každé ráno — a takový se po týdnu přestane otevírat. Proto se prochází
     každý jeden den života inzerátu a hlídá se, že se ozve právě jednou.

     Dopředu se schválně nehlásí: Bazoš inzerát archivuje a nahodí se
     jedním kliknutím, takže před vypršením není co dělat. */
  sekce('2) Ozve se jen v den vypršení, ne po celou dobu');
  const kdySeOzve = [];
  for (let zbyva = 60; zbyva >= 0; zbyva--) {
    nastavSklad([
      { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
        platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, zbyva) } },
    ]);
    if ((await cron(RANO_LETO)).length) kdySeOzve.push(zbyva);
  }
  shoda('inzerát se ozve jednou za život', kdySeOzve, [0]);

  sekce('3) Jeden inzerát, i když kusů je víc');
  nastavSklad([
    { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) } },
    { id: 'b', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) } },
  ]);
  m = await cron(RANO_LETO);
  const kolikRadku = (m[0].text.match(/• Dunk Low Panda/g) || []).length;
  ok('stejné SKU je jeden inzerát', kolikRadku === 1, 'řádků: ' + kolikRadku);

  sekce('3b) Čeština počítá po třech');
  const inzeraty = n => Array.from({ length: n }, (_, i) => ({
    id: 'i' + i, name: 'Kus ' + i, sku: 'SKU' + i, saleState: 'stock',
    platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) },
  }));
  nastavSklad(inzeraty(3));
  const tri = (await cron(RANO_LETO))[0].subject;
  nastavSklad(inzeraty(6));
  const sest = (await cron(RANO_LETO))[0].subject;
  ok('3 inzeráty, ne inzerátů', /3 inzeráty vypršely/.test(tri), tri);
  ok('6 inzerátů, ne inzeráty', /6 inzerátů vypršelo/.test(sest), sest);

  /* ══════════════════════════════════════════════════════════════ */
  /* Payout se ozve poprvé v den, kdy měly peníze podle nastavení dorazit,
     a pak jednou týdně dál — dokud se to nevyřeší. Lhůtu si aplikace drží
     u každé platformy zvlášť, tak se bere odtamtud. */
  sekce('4) Payout: poprvé ve lhůtě, pak po týdnech');
  const kdyPayout = async (kde, skupiny) => {
    const dny = [];
    for (let ceka = 0; ceka <= 60; ceka++) {
      nastavSklad([
        { id: 'w', name: 'Yeezy Slide', saleState: 'waiting', soldWhere: kde,
          saleDate: prodanoPred(RANO_LETO, ceka) },
      ], skupiny);
      if ((await cron(RANO_LETO)).length) dny.push(ceka);
    }
    return dny;
  };
  const NASTAVENI = {
    platforms: ['StockX'], eshopy: ['Sneakerstore'], local: ['Bazoš.cz'],
    payoutDays: { 'Sneakerstore': 30 },
  };
  shoda('eshop s vlastní lhůtou 30 dní', await kdyPayout('Sneakerstore', NASTAVENI),
    [30, 37, 44, 51, 58]);
  shoda('StockX bere výchozí 7 dní pro skupinu', await kdyPayout('StockX', NASTAVENI),
    [7, 14, 21, 28, 35, 42, 49, 56]);
  shoda('místní prodej výchozí 3 dny', await kdyPayout('Bazoš.cz', NASTAVENI),
    [3, 10, 17, 24, 31, 38, 45, 52, 59]);
  shoda('neznámé místo padá na 14 dní', await kdyPayout('Neznámý bazar', NASTAVENI),
    [14, 21, 28, 35, 42, 49, 56]);

  sekce('4b) Co je ve zprávě o payoutu vidět');
  nastavSklad([
    { id: 'w1', name: 'Yeezy Slide', saleState: 'waiting', soldWhere: 'StockX',
      saleDate: prodanoPred(RANO_LETO, 7) },
    { id: 'w2', name: 'Sotva prodáno', saleState: 'waiting', soldWhere: 'StockX',
      saleDate: prodanoPred(RANO_LETO, 6) },
    // Český tvar data musí fungovat stejně jako ISO
    { id: 'w3', name: 'Starý prodej', saleState: 'waiting', soldWhere: 'StockX',
      saleDate: '11.8.2026' },
  ], NASTAVENI);
  m = await cron(RANO_LETO);
  ok('v den lhůty se ozve', m[0] && /Yeezy Slide/.test(m[0].text), m[0] && m[0].text);
  ok('a řekne, že lhůta vyprší dnes', m[0] && /lhůta 7 dní vyprší dnes/.test(m[0].text), m[0] && m[0].text);
  ok('o den dřív ne', m[0] && !/Sotva prodáno/.test(m[0].text));
  ok('české datum se čte taky', m[0] && /Starý prodej/.test(m[0].text), m[0] && m[0].text);
  ok('u zpožděného je o kolik', m[0] && /o 7 dní přes lhůtu 7 dní/.test(m[0].text), m[0] && m[0].text);
  ok('nejhorší je nahoře', m[0] && m[0].text.indexOf('Starý prodej') < m[0].text.indexOf('Yeezy Slide'));
  ok('předmět zmíní zpoždění', m[0] && /nejdéle o 7 dní přes lhůtu/.test(m[0].subject), m[0] && m[0].subject);
  ok('kde se prodalo je vidět', m[0] && /StockX/.test(m[0].text));

  /* ══════════════════════════════════════════════════════════════ */
  sekce('4c) Zásilka dlouho na cestě');
  /* Tentýž kus hlásí i payout — čeká na peníze jako každý jiný prodej.
     Test se proto ptá výslovně na blok o zásilkách, ne jen na to, že
     nějaký mail odešel. */
  const kdyZasilka = async (extra) => {
    const dny = [];
    for (let na = 0; na <= 30; na++) {
      nastavSklad([Object.assign({
        id: 'z', name: 'Yeezy Slide', saleState: 'waiting', waitState: 'sent',
        trackingNum: 'CP123456789CZ', trackingCarrier: 'Zásilkovna',
        sentAt: prodanoPred(RANO_LETO, na), saleDate: prodanoPred(RANO_LETO, na),
      }, extra || {})]);
      const m = await cron(RANO_LETO);
      if (m[0] && /DLOUHO NA CESTĚ/.test(m[0].text)) dny.push(na);
    }
    return dny;
  };
  shoda('po pěti dnech, pak po týdnech', await kdyZasilka(), [5, 12, 19, 26]);
  shoda('bez sledovacího čísla mlčí', await kdyZasilka({ trackingNum: '' }), []);
  shoda('dokud není odesláno, taky mlčí', await kdyZasilka({ waitState: 'sending' }), []);

  // Staré kusy sentAt nemají — počítá se od data prodeje
  shoda('bez sentAt se bere datum prodeje', await kdyZasilka({ sentAt: undefined }), [5, 12, 19, 26]);

  nastavSklad([
    { id: 'z', name: 'Yeezy Slide', saleState: 'waiting', waitState: 'sent',
      trackingNum: 'CP123456789CZ', trackingCarrier: 'Zásilkovna',
      sentAt: prodanoPred(RANO_LETO, 5) },
  ]);
  const zas = (await cron(RANO_LETO))[0] || {};
  ok('je vidět dopravce i číslo', /Zásilkovna/.test(zas.text || '') && /CP123456789CZ/.test(zas.text || ''), zas.text);
  ok('a jak dlouho už jede', /uběhlo 5 dní od odeslání/.test(zas.text || ''), zas.text);
  ok('poradí, co dělat', /kontaktuj zákazníka nebo zahaj reklamaci/.test(zas.text || ''), zas.text);

  /* Sledovací číslo je v aplikaci proklikové, v mailu má být taky —
     jinak by se muselo ručně přepisovat do stránky dopravce. */
  nastavSklad([
    { id: 'z', name: 'Yeezy Slide', saleState: 'waiting', waitState: 'sent',
      trackingNum: 'CP123456789CZ', trackingCarrier: 'Zásilkovna',
      trackingUrl: 'https://tracking.packeta.com/cs/?id=CP123456789CZ',
      sentAt: prodanoPred(RANO_LETO, 5) },
  ]);
  const sOdkazem = (await cron(RANO_LETO))[0] || {};
  ok('číslo je v HTML odkaz',
    /<a href="https:\/\/tracking\.packeta\.com[^"]*"[^>]*>CP123456789CZ<\/a>/.test(sOdkazem.html || ''),
    (sOdkazem.html || '').slice(0, 100));
  ok('v prostém textu zůstane jen číslo',
    /CP123456789CZ/.test(sOdkazem.text || '') && !/tracking\.packeta/.test(sOdkazem.text || ''),
    sOdkazem.text);

  // Adresa od uživatele nesmí do odkazu propašovat cokoli
  nastavSklad([
    { id: 'z', name: 'Yeezy Slide', saleState: 'waiting', waitState: 'sent',
      trackingNum: 'X1', trackingCarrier: 'DPD',
      trackingUrl: 'javascript:alert(1)', sentAt: prodanoPred(RANO_LETO, 5) },
  ]);
  const zakernyOdkaz = (await cron(RANO_LETO))[0] || {};
  ok('javascript: se odkazem nestane', !/javascript:/.test(zakernyOdkaz.html || ''),
    (zakernyOdkaz.html || '').slice(0, 100));
  ok('ale číslo je pořád vidět', /X1/.test(zakernyOdkaz.html || ''));

  /* ══════════════════════════════════════════════════════════════ */
  /* Pondělní obhlídka schválně porušuje pravidlo „okamžik, ne stav" —
     je to připomínka rituálu, o kterou majitel stál. Ale i ta musí
     mlčet, když není co projít. */
  sekce('4d) Pondělní obhlídka');
  const SKLAD_PONDELI = [
    { id: 'a', name: 'Nikde nevystavený kus', saleState: 'stock', platforms: [], buyDate: '2026-05-01' },
    { id: 'b', name: 'V komisi u Sneakerstore', saleState: 'stock', platforms: ['Sneakerstore'], buyDate: '2026-07-01' },
    { id: 'c', name: 'Na Bazoši', saleState: 'stock', platforms: ['Bazoš.cz'], buyDate: '2026-08-01' },
  ];
  const PONDELI = Date.UTC(2026, 7, 24, 8);   // pondělí 24. 8. 2026, 10:00 v Praze
  const UTERY = Date.UTC(2026, 7, 25, 8);     // úterý

  nastavSklad(SKLAD_PONDELI);
  const vPondeli = (await cron(PONDELI))[0] || {};
  const vUtery = await cron(UTERY);

  ok('v pondělí přijde', !!vPondeli.text, JSON.stringify(vPondeli.subject));
  ok('v úterý ne', vUtery.length === 0, JSON.stringify(vUtery.map(x => x.subject)));
  ok('vypíše nevystavené', /Nikde nevystavený kus/.test(vPondeli.text || ''), vPondeli.text);
  ok('i komisní', /V komisi u Sneakerstore/.test(vPondeli.text || ''), vPondeli.text);
  ok('ale ne to, co běžně inzeruje', !/Na Bazoši/.test(vPondeli.text || ''), vPondeli.text);
  ok('řekne, jak dlouho leží', /na skladě \d+ dní/.test(vPondeli.text || ''), vPondeli.text);

  nastavSklad([{ id: 'c', name: 'Na Bazoši', saleState: 'stock', platforms: ['Bazoš.cz'] }]);
  ok('když není co projít, mlčí i v pondělí', (await cron(PONDELI)).length === 0);

  // Dlouhý výčet by zprávu nafoukl a stejně by se nečetl
  nastavSklad(Array.from({ length: 20 }, (_, i) => ({
    id: 'x' + i, name: 'Kus ' + i, saleState: 'stock', platforms: [], buyDate: '2026-05-01',
  })));
  const dlouhy = (await cron(PONDELI))[0] || {};
  ok('dlouhý seznam se zkrátí', /a další 12 kusů/.test(dlouhy.text || ''), dlouhy.text);
  ok('ale počet je vidět celý', /Nikde nevystaveno \(20\)/.test(dlouhy.text || ''), dlouhy.text);

  /* ══════════════════════════════════════════════════════════════ */
  /* Report je jediná zpráva, ve které smí být peníze a čísla ze CRM.
     Čísla proto sedí na korunu — kdyby se rozešla s aplikací, ukazoval
     by report něco jiného než obrazovka, což je horší než žádný report. */
  sekce('5) Měsíční report');
  const PRVNIHO = Date.UTC(2026, 8, 1, 8, 0, 0);  // 1. 9. 2026, 10:00 v Praze
  // Pevné mezery v číslech se v testu normalizují
  const cist = s => String(s || '').replace(/ /g, ' ');

  const SRPEN = [
    // Kus v Kč: 3000 − 1000 − 200 = 1800
    { id: 'p1', name: 'Dunk Panda', category: 'sneakers', soldWhere: 'StockX',
      saleState: 'paid', payoutDate: '2026-08-14', buyDate: '2026-07-15',
      buyPrice: 1000, sellPrice: 3000, extraCosts: 200 },
    // Kus v EUR s uloženými kurzy: 200×25 − 100×25 = 2500
    { id: 'p2', name: 'Jordan 4', category: 'sneakers', soldWhere: 'Vinted',
      saleState: 'paid', payoutDate: '2026-08-20', buyDate: '2026-08-10',
      buyPrice: 100, buyCurrency: 'EUR', buyRateEur: 25,
      sellPrice: 200, sellPriceOrig: 200, sellCurrency: 'EUR', payoutRateEur: 25 },
    // Balík: peníze nese hlavička, kusy se počítají z členů
    { id: 'bk', type: 'bulk', name: 'Balík LEGO', saleState: 'paid',
      payoutDate: '2026-08-25', sellPrice: 10000, totalBuyPrice: 6000, profit: 4000 },
    { id: 'bm1', name: 'LEGO 1', bulkId: 'bk', saleState: 'paid', payoutDate: '2026-08-25', sellPrice: 0 },
    { id: 'bm2', name: 'LEGO 2', bulkId: 'bk', saleState: 'paid', payoutDate: '2026-08-25', sellPrice: 0 },
    // Červenec — jen pro srovnání, do srpna se nesmí připočíst
    { id: 'p0', name: 'Starý prodej', category: 'lego', soldWhere: 'StockX',
      saleState: 'paid', payoutDate: '2026-07-14', buyPrice: 1000, sellPrice: 2000 },
    // Sklad k dnešku
    { id: 's1', name: 'Leží na skladě', saleState: 'stock', buyPrice: 5000, buyDate: '2025-09-01' },
    { id: 'w1', name: 'Čeká', saleState: 'waiting', saleDate: '2026-08-30' },
  ];
  nastavSklad(SRPEN);
  const rep = (await cron(PRVNIHO))[0] || {};
  const t = cist(rep.text);

  ok('prvního přijde', !!rep.text, JSON.stringify(rep.subject));
  ok('a je za minulý měsíc', /REPORT ZA SRPEN 2026/.test(t), t.slice(0, 200));
  ok('jindy nechodí', (await cron(RANO_LETO)).length === 0);

  // tržba 3000 + 5000 + 10000 = 18 000; náklady 1200 + 2500 + 6000 = 9 700
  ok('tržba sedí', /tržba\s+18 000 Kč/.test(t), t);
  ok('náklady sedí', /náklady\s+9 700 Kč/.test(t), t);
  ok('zisk sedí', /zisk\s+8 300 Kč/.test(t), t);
  ok('kusy počítají členy balíku, ne hlavičku', /prodáno kusů\s+4/.test(t), t);
  ok('marže se počítá z tržby', /marže\s+46,1 %/.test(t), t);
  ok('ROI se počítá z nákladů', /ROI\s+85,6 %/.test(t), t);
  ok('zisk na kus', /zisk na kus\s+2 075 Kč/.test(t), t);
  ok('červenec se nepřipočítal', !/20 000 Kč/.test(t), t);
  ok('předmět nese zisk', /zisk 8 300 Kč/.test(cist(rep.subject)), rep.subject);

  ok('srovnává s minulým měsícem', /proti červenci/.test(t), t);
  ok('i s průměrem', /proti průměru/.test(t), t);
  ok('rozpad podle místa prodeje', /Kde se prodávalo/.test(t) && /StockX/.test(t), t);
  ok('rozpad podle kategorie', /Podle kategorie/.test(t) && /sneakers/.test(t), t);
  ok('nejlepší obchod', /▲ Balík LEGO/.test(t), t);
  ok('nejhorší obchod', /▼ Dunk Panda/.test(t), t);
  ok('stav skladu k dnešku', /na skladě\s+1/.test(t) && /vázáno v nákupu\s+5 000 Kč/.test(t), t);
  ok('a jak dlouho nejstarší leží', /nejdéle leží\s+\d+ dní/.test(t), t);

  /* Report je jediná zpráva s penězi, takže musí mít i jinou patičku.
     Ta běžná tvrdí, že částky ve zprávě nejsou — pod reportem plným
     korun by to byla lež. */
  ok('patička u reportu mluví o kurzech', /kurzů uložených/.test(t), t.slice(-300));
  ok('a běžná zpráva ji nemá', !/kurzů uložených/.test(cist(m[0] && m[0].text)), m[0] && m[0].text);

  // Řádky s čísly nemají příponu — nesmí za nimi zůstat „undefined"
  ok('žádné undefined v hodnotách', !/undefined/.test(t), t);
  ok('ani v předmětu', !/undefined|·\s*·/.test(rep.subject || ''), rep.subject);

  /* Aplikace si u prodaného kusu uloží spočítaný zisk a report ho má
     převzít, ne přepočítávat. Kdyby si počítal po svém, ukazoval by
     u kusů s doplatky nebo ručně upravenou cenou jiné číslo než
     obrazovka — a člověk by nevěděl, kterému věřit. */
  sekce('5a) Uložený zisk má přednost před dopočítaným');
  nastavSklad([
    { id: 'ul', name: 'Ručně upravený', category: 'sneakers', soldWhere: 'StockX',
      saleState: 'paid', payoutDate: '2026-08-14', buyDate: '2026-07-01',
      buyPrice: 1000, sellPrice: 3000, extraCosts: 0,
      // Dopočtem by vyšlo 2000, ale aplikace si uložila tohle
      profit: 2222, profitRateEur: 25 },
  ]);
  const ulozeny = cist(((await cron(PRVNIHO))[0] || {}).text);
  ok('bere se uložené číslo', /zisk\s+2 222 Kč/.test(ulozeny), ulozeny.slice(0, 400));
  ok('a ne dopočítané', !/zisk\s+2 000 Kč/.test(ulozeny), ulozeny.slice(0, 400));

  sekce('5b) Kurz, který chybí, se přizná');
  nastavSklad(SRPEN.concat([{
    id: 'bezkurzu', name: 'EUR bez kurzu', saleState: 'paid', payoutDate: '2026-08-11',
    buyPrice: 100, buyCurrency: 'EUR', sellPrice: 200, sellPriceOrig: 200, sellCurrency: 'EUR',
  }]));
  const nepresny = cist(((await cron(PRVNIHO))[0] || {}).text);
  ok('řekne, kolika kusů se to týká', /U 1 kusu chybí uložený kurz/.test(nepresny), nepresny.slice(0, 400));
  ok('i jakým kurzem počítal', /kurzem 25/.test(nepresny), nepresny.slice(0, 400));

  /* Barva má říct, jestli je číslo dobré nebo špatné. Nesmí ale zůstat
     jediným nositelem té informace: barvoslepý ji nepřečte a prostý text
     zprávy žádné barvy nemá. U každého obarveného čísla proto musí být
     i znaménko, šipka nebo slovo. */
  sekce('5d) Barvy v číslech');
  nastavSklad(SRPEN);
  const barvy = (await cron(PRVNIHO))[0] || {};
  ok('zisk je zeleně', /#c8ff00[^>]*>8 300 Kč/.test(cist(barvy.html)), '');
  // Obojí směr musí být slovem — kdyby značku nesl jen jeden, zůstala by
  // u druhého barva jako jediná stopa
  ok('co je nad obvyklým, je i napsané',
    /▲ nad obvyklým/.test(cist(barvy.text)), cist(barvy.text).slice(0, 500));
  ok('a co pod obvyklým taky',
    /▼ pod obvyklým/.test(cist(barvy.text)), cist(barvy.text).slice(0, 500));
  ok('rozpad má proužek podle podílu', /width:100%/.test(barvy.html || ''));
  ok('a ten nejmenší je kratší', /width:([1-9]|[1-9]\d)%/.test(barvy.html || ''));

  // Ztrátový měsíc musí být na první pohled poznat
  nastavSklad([
    { id: 'z1', name: 'Prodělek', category: 'sneakers', soldWhere: 'Vinted',
      saleState: 'paid', payoutDate: '2026-08-10', buyDate: '2026-06-01',
      buyPrice: 5000, sellPrice: 3000, extraCosts: 0 },
  ]);
  const ztrata = (await cron(PRVNIHO))[0] || {};
  ok('ztráta je červeně', /#ff4444/.test(ztrata.html || ''), '');
  ok('a řekne se to i slovem', /ztráta/.test(cist(ztrata.text)), cist(ztrata.text).slice(0, 400));
  ok('záporné číslo si nese znaménko', /-2 000 Kč/.test(cist(ztrata.text)), cist(ztrata.text).slice(0, 400));

  sekce('5c) Zákazníci: jen počty, a jen prvního');
  nastavSklad(SRPEN);
  const sCrm = await cron(PRVNIHO);
  const dotazyPrvniho = volani.map(v => v.url);
  ok('prvního se CRM přečte', dotazyPrvniho.some(u => u.includes('/crm/')), JSON.stringify(dotazyPrvniho));
  ok('do zprávy jde počet', /noví zákazníci\s+\d/.test(cist(sCrm[0].text)), sCrm[0].text);
  ok('ale žádné jméno', !/Petr Novák/.test(sCrm[0].text || ''), sCrm[0].text);
  ok('ani telefon', !/777123456/.test(sCrm[0].text || ''));

  /* ══════════════════════════════════════════════════════════════ */
  sekce('6) Desátá v Praze, ať je léto nebo zima');
  nastavSklad([
    { id: 'a', name: 'Dunk', sku: 'DD', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(Date.UTC(2026, 7, 25, 8), 0) } },
  ]);
  const leto8 = await cron(Date.UTC(2026, 7, 25, 8));   // léto: 08 UTC = 10 Praha
  const leto9 = await cron(Date.UTC(2026, 7, 25, 9));   // léto: 09 UTC = 11 Praha
  ok('v létě se pustí osmá UTC', leto8.length === 1);
  ok('a devátá UTC už ne', leto9.length === 0);

  nastavSklad([
    { id: 'a', name: 'Dunk', sku: 'DD', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(Date.UTC(2026, 0, 15, 9), 0) } },
  ]);
  const zima7 = await cron(Date.UTC(2026, 0, 15, 9));   // zima: 09 UTC = 10 Praha
  const zima6 = await cron(Date.UTC(2026, 0, 15, 8));   // zima: 08 UTC = 09 Praha
  ok('v zimě se pustí devátá UTC', zima7.length === 1);
  ok('a osmá UTC už ne', zima6.length === 0);

  /* ══════════════════════════════════════════════════════════════ */
  /* Mail odchází ve dvou podobách naráz. Kdyby chyběla textová, uvidí
     prázdno každý, kdo si HTML nezobrazuje; kdyby se skládaly zvlášť,
     rozejdou se. Obě proto vznikají z týchž dat. */
  sekce('6b) HTML i text v jednom mailu');
  nastavSklad([
    { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) } },
  ]);
  m = await cron(RANO_LETO);
  const mail = m[0] || {};
  ok('posílá se text', typeof mail.text === 'string' && mail.text.length > 0);
  ok('posílá se i HTML', typeof mail.html === 'string' && mail.html.length > 0);
  ok('HTML je celý dokument', /^<!doctype html>/i.test(mail.html || ''), (mail.html || '').slice(0, 40));
  ok('má barvu akcentu z aplikace', /#c8ff00/.test(mail.html || ''));
  ok('drží tmavé pozadí i v tmavém režimu klienta',
    /color-scheme/.test(mail.html || '') && /#0f0f0f/.test(mail.html || ''));
  ok('položka je v obou podobách',
    /Dunk Low Panda/.test(mail.text || '') && /Dunk Low Panda/.test(mail.html || ''));
  ok('žádné neposazené vykreslení nezůstalo', !/undefined|\[object/.test(mail.html || ''));

  /* Názvy položek si píše uživatel a jdou rovnou do HTML. Ostrá závorka
     v názvu by jinak rozhodila značky — a v horším případě do mailu
     propašovala cokoli dalšího. */
  sekce('6c) Název položky nemůže rozbít HTML');
  nastavSklad([
    { id: 'a', name: 'Dunk <script>zle()</script> & "spol"', sku: 'X1', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) } },
  ]);
  const zakerny = (await cron(RANO_LETO))[0] || {};
  ok('značka se nepropíše', !/<script>/.test(zakerny.html || ''), (zakerny.html || '').slice(0, 200));
  ok('ale text zůstane čitelný', /&lt;script&gt;/.test(zakerny.html || ''));
  ok('ampersand i uvozovky ošetřeny', /&amp;/.test(zakerny.html || '') && /&quot;spol&quot;/.test(zakerny.html || ''));
  ok('v prostém textu se nemění nic', /<script>zle\(\)<\/script> & "spol"/.test(zakerny.text || ''));

  /* ══════════════════════════════════════════════════════════════ */
  sekce('7) Co ve zprávě nesmí být');
  nastavSklad([
    { id: 'w1', name: 'Yeezy Slide', saleState: 'waiting', soldWhere: 'StockX',
      saleDate: prodanoPred(RANO_LETO, 21), sellPrice: 2600, buyPrice: 1800,
      buyCurrency: 'EUR', linkedCustomerId: 'c1' },
  ]);
  m = await cron(RANO_LETO);
  const dotazy = volani.map(v => v.url);

  const text = m[0] ? m[0].text : '';
  // Patička o penězích mluví — vysvětluje, proč ve zprávě žádné nejsou.
  // Kontroluje se tedy tělo nad ní, ne celý mail.
  const telo = text.split('— — —')[0];
  ok('žádné částky', !/\b(2600|1800)\b/.test(telo), telo);
  ok('žádná měna', !/\b(CZK|EUR|Kč)\b/.test(telo), telo);
  // Běžné upozornění nemá co vysvětlovat, tak patička nic nevysvětluje
  ok('patička je krátká', /Poslal konektor skladu\.\s*$/m.test(text), text.slice(-200));
  ok('CRM se ani nečte', !dotazy.some(u => u.includes('/crm/')), JSON.stringify(dotazy));
  ok('žádné jméno zákazníka', !/Petr Novák/.test(text));
  ok('odkaz na aplikaci tam je', /mtkmresell\.github\.io/.test(text));

  /* ══════════════════════════════════════════════════════════════ */
  sekce('8) Náhled a zkušební mail v prohlížeči');
  nastavSklad([
    { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) } },
  ]);
  const nahled = await get('/' + ENV.MCP_TOKEN + '/nahled');
  ok('náhled odpoví', nahled.status === 200, String(nahled.status));
  ok('a ukáže, co by přišlo', nahled.telo && nahled.telo.poslalo_by_se === true, JSON.stringify(nahled.telo));
  ok('ale nic neodešle', posta.length === 0, JSON.stringify(posta));

  nastavSklad([{ id: 'x', name: 'Nic zajímavého', saleState: 'stock' }]);
  const tichy = await get('/' + ENV.MCP_TOKEN + '/nahled');
  ok('v tichý den to řekne', tichy.telo && tichy.telo.poslalo_by_se === false, JSON.stringify(tichy.telo));

  const zkouska = await get('/' + ENV.MCP_TOKEN + '/test-mail');
  ok('zkušební mail odejde i v tichý den', posta.length === 1, JSON.stringify(posta));
  ok('a hlásí komu', zkouska.telo && zkouska.telo.komu === 'majitel@example.com', JSON.stringify(zkouska.telo));

  /* Výpis, který uživatel uvidí, když si adresu otevře v prohlížeči.
     Je to jediná zpětná vazba, kterou z konektoru bez Clauda dostane,
     tak musí říct pravdu i o poště — ne jen o čtení skladu. */
  sekce('8b) Výpis v prohlížeči hlásí i stav pošty');
  const sPostou = await get('/' + ENV.MCP_TOKEN + '/mcp');
  ok('konektor se hlásí jako běžící', sPostou.telo && sPostou.telo.stav === 'ok', JSON.stringify(sPostou.telo));
  ok('a řekne, že pošta je nastavená',
    sPostou.telo && /jsou nastavená/.test(sPostou.telo.upozorneni || ''), JSON.stringify(sPostou.telo));

  const bezPostyEnv = Object.assign({}, ENV);
  delete bezPostyEnv.MAIL_KOMU;
  const bezPostyVypis = await get('/' + ENV.MCP_TOKEN + '/mcp', RANO_LETO, bezPostyEnv);
  ok('bez pošty konektor pořád běží', bezPostyVypis.telo && bezPostyVypis.telo.stav === 'ok', JSON.stringify(bezPostyVypis.telo));
  ok('ale přizná, že upozornění neběží',
    bezPostyVypis.telo && /MAIL_KOMU/.test(bezPostyVypis.telo.upozorneni || ''), JSON.stringify(bezPostyVypis.telo));

  sekce('9) Zámek platí i na nové adresy');
  const zly1 = await get('/spatnytokenspatnytokenspatnytok1/nahled');
  const zly2 = await get('/spatnytokenspatnytokenspatnytok1/test-mail');
  ok('náhled bez tokenu 404', zly1.status === 404, String(zly1.status));
  ok('zkušební mail bez tokenu 404', zly2.status === 404, String(zly2.status));

  sekce('10) Když chybí nastavení pošty');
  const bezPosty = Object.assign({}, ENV);
  delete bezPosty.RESEND_API_KEY;
  const chybi = await get('/' + ENV.MCP_TOKEN + '/test-mail', RANO_LETO, bezPosty);
  ok('řekne, co chybí', chybi.telo && chybi.telo.chybi.includes('RESEND_API_KEY'), JSON.stringify(chybi.telo));
  ok('a nic neposílá', posta.length === 0);

  nastavSklad([
    { id: 'a', name: 'Dunk', sku: 'DD', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 0) } },
  ]);
  const tiche = await cron(RANO_LETO, bezPosty);
  const zaznamy = logy.slice();
  ok('cron bez pošty nespadne', tiche.length === 0);
  ok('ale zapíše proč', zaznamy.some(r => /RESEND_API_KEY/.test(r)), JSON.stringify(zaznamy));

  sekce('11) Když selže odeslání');
  const puvodniFetch = global.fetch;
  const postaOdmita = (stav, telo) => {
    global.fetch = async function (url, opts) {
      if (String(url).includes('api.resend.com')) return odp(stav, {}, JSON.stringify(telo));
      return puvodniFetch(url, opts);
    };
  };

  postaOdmita(422, { message: 'domain is not verified' });
  const spadlo = await cron(RANO_LETO);
  const zaznamy2 = logy.slice();
  ok('cron chybu spolkne', spadlo.length === 0);
  ok('a zapíše ji do logu', zaznamy2.some(r => /selhala/.test(r)), JSON.stringify(zaznamy2));

  /* Hlášky z pošty chodí anglicky a zabalené v JSONu. Kdo si otevře
     /test-mail v prohlížeči, potřebuje vidět větu, ne změť zpětných
     lomítek — a hlavně potřebuje vědět, co s tím. */
  sekce('11b) Chyba pošty se dá přečíst');
  postaOdmita(403, {
    statusCode: 403, name: 'validation_error',
    message: 'You can only send testing emails to your own email address (sklad@example.com).',
  });
  const zamitnuto = await get('/' + ENV.MCP_TOKEN + '/test-mail');
  global.fetch = puvodniFetch;

  ok('vrátí se chyba', zamitnuto.telo && zamitnuto.telo.stav === 'chyba', JSON.stringify(zamitnuto.telo));
  ok('je v ní věta od pošty, ne celý JSON',
    zamitnuto.telo && /only send testing emails/.test(zamitnuto.telo.chyba || '')
      && !/statusCode/.test(zamitnuto.telo.chyba || ''), JSON.stringify(zamitnuto.telo));
  ok('a rada, co s tím',
    zamitnuto.telo && /MAIL_KOMU/.test(zamitnuto.telo.rada || ''), JSON.stringify(zamitnuto.telo));

  /* ══════════════════════════════════════════════════════════════ */
  /* Lhůty payoutu jsou na dvou místech: aplikace je používá pro odhad
     cashflow, konektor pro upomínky. Kdyby se rozešly, mail by upomínal
     proti jiným číslům, než jaká má uživatel na obrazovce.

     Porovnává se znění konstant v obou souborech. Celý algoritmus to
     neověří — na to by se musel spustit prohlížeč — ale chytne to ten
     případ, který opravdu hrozí: že někdo změní čísla v aplikaci
     a na konektor zapomene. */
  sekce('12) Lhůty souhlasí s aplikací');
  const fs = require('fs');
  const app = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const wrk = fs.readFileSync(path.resolve(__dirname, '..', 'konektor', 'worker.js'), 'utf8');

  const cisla = (zdroj, jmeno) => {
    const m = new RegExp(jmeno + '\\s*=\\s*\\{([^}]*)\\}').exec(zdroj);
    if (!m) return null;
    const out = {};
    for (const kus of m[1].split(',')) {
      const p = /([A-Za-z_]+)\s*:\s*(\d+)/.exec(kus);
      if (p) out[p[1]] = +p[2];
    }
    return out;
  };
  const vApp = cisla(app, 'DEFAULT_PAYOUT_DAYS');
  const vKonektoru = cisla(wrk, 'VYCHOZI_PAYOUT_SKUPIN');
  ok('aplikace ta čísla pořád má', !!vApp, String(vApp));
  shoda('výchozí lhůty skupin sedí', vKonektoru, vApp);

  // Poslední záchrana, když platforma není nikde: v aplikaci je to holé
  // `return 14` na konci getPayoutDays, v konektoru pojmenovaná konstanta
  const teloFn = /function getPayoutDays[\s\S]*?\n\}/.exec(app);
  const zalohaApp = teloFn && [...teloFn[0].matchAll(/return\s+(\d+);/g)].pop();
  const zalohaWrk = /VYCHOZI_PAYOUT\s*=\s*(\d+)/.exec(wrk);
  ok('getPayoutDays v aplikaci pořád je', !!zalohaApp, teloFn && teloFn[0].slice(0, 80));
  shoda('i poslední záchrana sedí',
    zalohaWrk && zalohaWrk[1], zalohaApp && zalohaApp[1]);

  /* ══════════════════════════════════════════════════════════════ */
  sekce('13) Ani tady se nikam nezapisuje');
  const doFirestore = volani.filter(v => /firestore\.googleapis\.com|identitytoolkit/.test(v.url));
  const zapisy = doFirestore.filter(v =>
    ['PATCH', 'PUT', 'DELETE'].includes(v.method) ||
    (v.method === 'POST' && !v.url.includes(':batchGet') && !v.url.includes('signIn')));
  shoda('žádný zápis do Firestore', zapisy.map(v => v.method + ' ' + v.url), []);

  vypis(selhalo ? '\n' + selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo'
    : '\nOK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})().catch(e => { console.log('ERROR: ' + (e && e.stack || e)); process.exit(1); });
