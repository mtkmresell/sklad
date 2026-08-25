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

// Pevný okamžik: úterý 25. 8. 2026, 06:00 UTC = 08:00 v Praze (letní čas)
const RANO_LETO = Date.UTC(2026, 7, 25, 6, 0, 0);

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

// Sklad postavený tak, aby v daný den padly zvolené prahy
function nastavSklad(polozky) {
  DOKUMENTY = {
    data: { savedAt: '2026-08-24T09:30:00Z', itemsStock: polozky, archiveYears: [], items: [] },
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
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 7) } },
    { id: 'b', name: 'Jordan 4 Bred', sku: 'JD4', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 8) } },
  ]);
  let m = await cron(RANO_LETO);

  ok('na prahu se ozve', m.length === 1, JSON.stringify(m.map(x => x.subject)));
  ok('a je to ten správný kus', m[0] && /Dunk Low Panda/.test(m[0].text));
  ok('den před prahem ticho', m[0] && !/Jordan 4 Bred/.test(m[0].text), m[0] && m[0].text);
  ok('předmět říká, o co jde', m[0] && /1 inzerát vyprší, první za 7 dní/.test(m[0].subject), m[0] && m[0].subject);

  /* Tohle je jádro celé věci. Kdyby se z prahů stal rozsah („zbývá sedm
     dní a míň"), mail by chodil každé ráno až do vypršení — a takový
     mail se po týdnu přestane otevírat. Proto se prochází každý jeden
     den dopředu a hlídá se, že se ozvou právě tři z nich. */
  sekce('2) Ozve se jen v den prahu, ne po celou dobu');
  const kdySeOzve = [];
  for (let zbyva = 60; zbyva >= 0; zbyva--) {
    nastavSklad([
      { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
        platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, zbyva) } },
    ]);
    if ((await cron(RANO_LETO)).length) kdySeOzve.push(zbyva);
  }
  shoda('inzerát se ozve třikrát za život', kdySeOzve, [7, 3, 1]);

  const payoutDny = [];
  for (let ceka = 0; ceka <= 120; ceka++) {
    nastavSklad([
      { id: 'w', name: 'Yeezy Slide', saleState: 'waiting', saleDate: prodanoPred(RANO_LETO, ceka) },
    ]);
    if ((await cron(RANO_LETO)).length) payoutDny.push(ceka);
  }
  shoda('payout se ozve taky třikrát', payoutDny, [21, 45, 90]);

  sekce('3) Jeden inzerát, i když kusů je víc');
  nastavSklad([
    { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 3) } },
    { id: 'b', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 3) } },
  ]);
  m = await cron(RANO_LETO);
  const kolikRadku = (m[0].text.match(/• Dunk Low Panda/g) || []).length;
  ok('stejné SKU je jeden inzerát', kolikRadku === 1, 'řádků: ' + kolikRadku);

  sekce('3b) Čeština počítá po třech');
  const inzeraty = n => Array.from({ length: n }, (_, i) => ({
    id: 'i' + i, name: 'Kus ' + i, sku: 'SKU' + i, saleState: 'stock',
    platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 7) },
  }));
  nastavSklad(inzeraty(3));
  const tri = (await cron(RANO_LETO))[0].subject;
  nastavSklad(inzeraty(6));
  const sest = (await cron(RANO_LETO))[0].subject;
  ok('3 inzeráty, ne inzerátů', /3 inzeráty vyprší/.test(tri), tri);
  ok('6 inzerátů, ne inzeráty', /6 inzerátů vyprší/.test(sest), sest);

  /* ══════════════════════════════════════════════════════════════ */
  sekce('4) Čekání na payout');
  nastavSklad([
    { id: 'w1', name: 'Yeezy Slide', saleState: 'waiting', soldWhere: 'StockX',
      saleDate: prodanoPred(RANO_LETO, 21) },
    { id: 'w2', name: 'Sotva prodáno', saleState: 'waiting', saleDate: prodanoPred(RANO_LETO, 20) },
    // Český tvar data musí fungovat stejně jako ISO
    { id: 'w3', name: 'Starý prodej', saleState: 'waiting', saleDate: '27.5.2026' },
  ]);
  m = await cron(RANO_LETO);
  ok('na prahu 21 dní se ozve', m[0] && /Yeezy Slide/.test(m[0].text), m[0] && m[0].text);
  ok('o den dřív ne', m[0] && !/Sotva prodáno/.test(m[0].text));
  ok('české datum se čte taky', m[0] && /Starý prodej/.test(m[0].text), m[0] && m[0].text);
  ok('a je na prahu 90 dní', m[0] && /Bez vyplacení 90 dní/.test(m[0].text));
  ok('kde se prodalo je vidět', m[0] && /StockX/.test(m[0].text));

  /* ══════════════════════════════════════════════════════════════ */
  sekce('5) Měsíční souhrn jen prvního');
  const PRVNIHO = Date.UTC(2026, 8, 1, 6, 0, 0);  // 1. 9. 2026, 08:00 v Praze
  nastavSklad([
    { id: 's1', name: 'Na skladě', saleState: 'stock' },
    { id: 'w1', name: 'Čeká', saleState: 'waiting', saleDate: '2026-08-30' },
    { id: 'p1', name: 'Prodáno v srpnu', saleState: 'paid', payoutDate: '2026-08-14' },
    { id: 'p2', name: 'Prodáno v červenci', saleState: 'paid', payoutDate: '2026-07-14' },
    { id: 'bk', type: 'bulk', name: 'Balík', saleState: 'paid', payoutDate: '2026-08-20' },
  ]);
  const prvniho = await cron(PRVNIHO);
  const jindy = await cron(RANO_LETO);

  ok('prvního přijde souhrn', prvniho.length === 1, JSON.stringify(prvniho.map(x => x.subject)));
  ok('a je za minulý měsíc', prvniho[0] && /SOUHRN ZA SRPEN 2026/.test(prvniho[0].text), prvniho[0] && prvniho[0].text);
  ok('počítá jen srpnové prodeje', prvniho[0] && /prodáno kusů\s+1/.test(prvniho[0].text), prvniho[0] && prvniho[0].text);
  ok('hlavička balíku není kus', prvniho[0] && !/prodáno kusů\s+2/.test(prvniho[0].text));
  ok('jindy souhrn nechodí', jindy.length === 0);

  /* ══════════════════════════════════════════════════════════════ */
  sekce('6) Osmá ráno v Praze, ať je léto nebo zima');
  nastavSklad([
    { id: 'a', name: 'Dunk', sku: 'DD', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(Date.UTC(2026, 7, 25, 6), 7) } },
  ]);
  const leto8 = await cron(Date.UTC(2026, 7, 25, 6));   // léto: 06 UTC = 08 Praha
  const leto9 = await cron(Date.UTC(2026, 7, 25, 7));   // léto: 07 UTC = 09 Praha
  ok('v létě se pustí šestá UTC', leto8.length === 1);
  ok('a sedmá UTC už ne', leto9.length === 0);

  nastavSklad([
    { id: 'a', name: 'Dunk', sku: 'DD', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(Date.UTC(2026, 0, 15, 7), 7) } },
  ]);
  const zima7 = await cron(Date.UTC(2026, 0, 15, 7));   // zima: 07 UTC = 08 Praha
  const zima6 = await cron(Date.UTC(2026, 0, 15, 6));   // zima: 06 UTC = 07 Praha
  ok('v zimě se pustí sedmá UTC', zima7.length === 1);
  ok('a šestá UTC už ne', zima6.length === 0);

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
  ok('patička říká, proč tam částky nejsou', /Částky/.test(text), text);
  ok('CRM se ani nečte', !dotazy.some(u => u.includes('/crm/')), JSON.stringify(dotazy));
  ok('žádné jméno zákazníka', !/Petr Novák/.test(text));
  ok('odkaz na aplikaci tam je', /mtkmresell\.github\.io/.test(text));

  /* ══════════════════════════════════════════════════════════════ */
  sekce('8) Náhled a zkušební mail v prohlížeči');
  nastavSklad([
    { id: 'a', name: 'Dunk Low Panda', sku: 'DD1391', saleState: 'stock',
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 7) } },
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
      platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': inzeratZbyva(RANO_LETO, 7) } },
  ]);
  const tiche = await cron(RANO_LETO, bezPosty);
  const zaznamy = logy.slice();
  ok('cron bez pošty nespadne', tiche.length === 0);
  ok('ale zapíše proč', zaznamy.some(r => /RESEND_API_KEY/.test(r)), JSON.stringify(zaznamy));

  sekce('11) Když selže odeslání');
  const puvodniFetch = global.fetch;
  global.fetch = async function (url, opts) {
    if (String(url).includes('api.resend.com')) return odp(422, {}, 'domain not verified');
    return puvodniFetch(url, opts);
  };
  const spadlo = await cron(RANO_LETO);
  const zaznamy2 = logy.slice();
  global.fetch = puvodniFetch;
  ok('cron chybu spolkne', spadlo.length === 0);
  ok('a zapíše ji do logu', zaznamy2.some(r => /selhala/.test(r)), JSON.stringify(zaznamy2));

  /* ══════════════════════════════════════════════════════════════ */
  sekce('12) Ani tady se nikam nezapisuje');
  const doFirestore = volani.filter(v => /firestore\.googleapis\.com|identitytoolkit/.test(v.url));
  const zapisy = doFirestore.filter(v =>
    ['PATCH', 'PUT', 'DELETE'].includes(v.method) ||
    (v.method === 'POST' && !v.url.includes(':batchGet') && !v.url.includes('signIn')));
  shoda('žádný zápis do Firestore', zapisy.map(v => v.method + ' ' + v.url), []);

  vypis(selhalo ? '\n' + selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo'
    : '\nOK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})().catch(e => { console.log('ERROR: ' + (e && e.stack || e)); process.exit(1); });
