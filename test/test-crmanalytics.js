// Test: analytika zákazníků (B2C) a partnerů (B2B)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }
const norm = s => (s || '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ');

// Anna = opakovaná (3 nákupy), Bořek = jednorázový, Cyril = nikdy nenakoupil
const PRODEJE = [
  { id: 'a1', name: 'Dunk 42', size: 'EU 42 / US 8.5', category: 'sneakers', buyPrice: 2000, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 3500, profit: 1400, saleDate: '2026-01-10', payoutDate: '2026-01-12',
    linkedCustomerId: 'c-anna', buyerType: 'b2c', demandSource: 'instagram', soldWhere: 'Osobní odběr' },
  { id: 'a2', name: 'Jordan 42', size: 'EU 42 / US 8.5', category: 'sneakers', buyPrice: 3000, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 6000, profit: 2800, saleDate: '2026-03-10', payoutDate: '2026-03-11',
    linkedCustomerId: 'c-anna', buyerType: 'b2c', demandSource: 'opakovany', soldWhere: 'Osobní odběr' },
  { id: 'a3', name: 'ETB Pokémon', category: 'pokemon', buyPrice: 1200, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 1900, profit: 600, saleDate: '2026-05-10', payoutDate: '2026-05-11',
    linkedCustomerId: 'c-anna', buyerType: 'b2c', demandSource: 'opakovany', soldWhere: 'Osobní odběr' },
  { id: 'b1', name: 'Yeezy 44', size: 'EU 44 / US 10', category: 'sneakers', buyPrice: 4000, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 12000, profit: 7500, saleDate: '2026-02-01', payoutDate: '2026-02-02',
    linkedCustomerId: 'c-borek', buyerType: 'b2c', demandSource: 'doporuceni', soldWhere: 'Osobní odběr' },
  // Vrácený kus se nesmí počítat jako tržba
  { id: 'a4', name: 'Vrácené', category: 'sneakers', buyPrice: 900, buyCurrency: 'CZK',
    saleState: 'stock', sellPrice: null, linkedCustomerId: 'c-anna', buyerType: 'b2c', soldWhere: 'Footshop' },
  // B2B partner: pomalá platba + reklamace
  { id: 'p1', name: 'Balík bot', category: 'sneakers', buyPrice: 8000, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 14000, profit: 5200, saleDate: '2026-01-05', payoutDate: '2026-02-20',
    linkedCustomerId: 'pa-dan', buyerType: 'b2b', soldWhere: 'Velkoobchod' },
  { id: 'p2', name: 'LEGO set', category: 'jine', buyPrice: 3000, buyCurrency: 'CZK',
    saleState: 'waiting', sellPrice: 4500, profit: 1200, saleDate: '2026-06-01',
    linkedCustomerId: 'pa-dan', buyerType: 'b2b', soldWhere: 'Velkoobchod' },
];

const CRM = {
  customers: [
    { id: 'c-anna', name: 'Anna Nováková', status: 'vip', size_shoes_eu: '42', contacts: [] },
    { id: 'c-borek', name: 'Bořek Malý', status: 'bezny', size_shoes_eu: '44', contacts: [] },
    { id: 'c-cyril', name: 'Cyril Tichý', status: 'potencialni', size_shoes_eu: '42', contacts: [] },
  ],
  partners: [
    { id: 'pa-dan', name: 'Dan Resell s.r.o.', status: 'aktivni', contacts: [],
      contact_history: [{ date: '2026-02-25', type: 'reklamace', note: 'Reklamoval velikost' }] },
    { id: 'pa-eva', name: 'Eva Store', status: 'aktivni', contacts: [] },
  ],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript(d => {
    localStorage.setItem('sklad_v3', JSON.stringify(d.items));
    localStorage.setItem('sklad_crm', JSON.stringify(d.crm));
  }, { items: PRODEJE, crm: CRM });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ══════════════════════════════════════════════════════════════
  section('1) Napojení prodejů na zákazníky');
  const idx = await page.evaluate(() => {
    const m = crmSalesIndex('b2c');
    return {
      anna: { n: m['c-anna'].prodeje.length, trzby: m['c-anna'].trzby, zisk: m['c-anna'].zisk },
      borek: { n: m['c-borek'].prodeje.length, trzby: m['c-borek'].trzby },
      cyril: { n: m['c-cyril'].prodeje.length },
    };
  });
  check('opakovaná zákaznice má tři prodeje', idx.anna.n === 3, JSON.stringify(idx.anna));
  check('vrácený kus se nezapočítal', idx.anna.trzby === 3500 + 6000 + 1900, JSON.stringify(idx.anna));
  check('zisk se sečetl', idx.anna.zisk === 1400 + 2800 + 600, JSON.stringify(idx.anna));
  check('jednorázový má jeden', idx.borek.n === 1 && idx.borek.trzby === 12000, JSON.stringify(idx.borek));
  check('kdo nenakoupil, má nulu', idx.cyril.n === 0, JSON.stringify(idx.cyril));

  // ══════════════════════════════════════════════════════════════
  section('2) Cenová pásma a velikosti');
  const pomocne = await page.evaluate(() => ({
    pasma: [500, 1500, 3000, 7000, 25000].map(cenovePasmo),
    hranice: [cenovePasmo(1000), cenovePasmo(2500)],
    vel: [
      velikostKlic({ size: 'EU 42 / US 8.5' }),
      velikostKlic({ size: '44' }),
      velikostKlic({ size: '' }),
    ],
  }));
  check('pásma sedí', pomocne.pasma[0] === 'do 1 000' && pomocne.pasma[4] === 'nad 10 000', JSON.stringify(pomocne.pasma));
  check('hranice patří do vyššího pásma',
    pomocne.hranice[0] === '1 000 – 2 500' && pomocne.hranice[1] === '2 500 – 5 000', JSON.stringify(pomocne.hranice));
  check('velikost se vytáhne z „EU 42 / US 8.5"', pomocne.vel[0] === '42', JSON.stringify(pomocne.vel));
  check('holé číslo projde', pomocne.vel[1] === '44', JSON.stringify(pomocne.vel));
  check('prázdná velikost nevrací nesmysl', pomocne.vel[2] === '', JSON.stringify(pomocne.vel));

  // ══════════════════════════════════════════════════════════════
  section('3) B2C pohled');
  const b2c = await page.evaluate(async () => {
    switchTab('customers');
    await new Promise(r => setTimeout(r, 400));
    crmToggleAnalytics();
    await new Promise(r => setTimeout(r, 1600));   // ať doběhne count-up
    const box = document.getElementById('crmAnalytics');
    return {
      viditelne: box.style.display !== 'none',
      seznamSkryty: document.getElementById('crmList').style.display === 'none',
      text: box.textContent.replace(/\s+/g, ' '),
      nadpis: box.querySelector('span') ? box.querySelector('span').textContent : '',
    };
  });
  check('analytika se zobrazí', b2c.viditelne, String(b2c.viditelne));
  check('seznam se schová', b2c.seznamSkryty, String(b2c.seznamSkryty));
  check('nadpis říká, co to je', /Analytika zákazníků/.test(b2c.nadpis), b2c.nadpis);
  check('sekce opakovaných nákupů je tam', /Opakované nákupy/.test(b2c.text), b2c.text.slice(0, 200));
  check('je vidět, že jedna zákaznice je opakovaná', /3–5 nákupů\s*1 ×/.test(norm(b2c.text)), norm(b2c.text).slice(0, 500));
  check('žebříček nejlepších existuje', /Nejlepší zákazníci/.test(b2c.text));
  check('nejlepší je ten s nejvyššími tržbami', b2c.text.indexOf('Bořek Malý') < b2c.text.indexOf('Anna Nováková'),
    'Bořek=' + b2c.text.indexOf('Bořek Malý') + ' Anna=' + b2c.text.indexOf('Anna Nováková'));
  check('velikosti se počítají', /Velikosti/.test(b2c.text) && /EU 42/.test(b2c.text), b2c.text.slice(0, 300));
  check('zdroj poptávky se propsal', /Odkud přišla poptávka/.test(b2c.text) && /Opakovaný zákazník/.test(b2c.text));
  check('cenová pásma jsou vidět', /Cenová pásma/.test(b2c.text));

  const kpi = norm(b2c.text).slice(0, 400);
  check('KPI ukazuje 3 zákazníky a 2 nakupující',
    /Zákazníků\s*3/.test(kpi) && /nakoupilo\s*2/i.test(kpi), kpi);
  check('tržby se sečetly za oba nakupující (23 400)', /Tržby\s*23 400 Kč/.test(kpi), kpi);
  check('spočítaly se 4 prodané kusy', /Kusů prodáno\s*4/.test(kpi), kpi);

  // ══════════════════════════════════════════════════════════════
  section('4) B2B pohled je jiný');
  const b2b = await page.evaluate(async () => {
    crmSwitchMode('b2b');
    await new Promise(r => setTimeout(r, 500));
    const box = document.getElementById('crmAnalytics');
    return { text: box.textContent.replace(/\s+/g, ' ') };
  });
  check('nadpis je o partnerech', /Analytika partnerů/.test(b2b.text), b2b.text.slice(0, 120));
  check('hlavní je historie obchodů', /Historie obchodů/.test(b2b.text));
  check('spolehlivost placení je vidět', /Spolehlivost placení/.test(b2b.text));
  check('pomalá platba se spočítá (46 dní)', /46 dní/.test(norm(b2b.text)), norm(b2b.text).slice(0, 600));
  check('reklamace se propíše do stavu', /1× reklamace/.test(norm(b2b.text)), norm(b2b.text).slice(0, 700));
  check('nezaplacené kusy se hlídají', /Čeká na zaplacení/.test(b2b.text));
  check('B2C sekce se tu neukazují', !/Opakované nákupy/.test(b2b.text) && !/Velikosti/.test(b2b.text));

  // ══════════════════════════════════════════════════════════════
  section('5) Návrat zpět na seznam');
  const zpet = await page.evaluate(async () => {
    crmToggleAnalytics();
    await new Promise(r => setTimeout(r, 300));
    return {
      seznam: document.getElementById('crmList').style.display !== 'none',
      analytika: document.getElementById('crmAnalytics').style.display === 'none',
      popisTlacitka: document.getElementById('crmAnalyticsBtn').textContent,
    };
  });
  check('seznam je zpátky', zpet.seznam, JSON.stringify(zpet));
  check('analytika je schovaná', zpet.analytika, JSON.stringify(zpet));
  check('tlačítko se vrátilo do výchozího stavu', /Analytika/.test(zpet.popisTlacitka), zpet.popisTlacitka);

  // Prázdný stav nesmí spadnout
  const prazdno = await page.evaluate(async () => {
    const zaloha = customers.slice();
    customers.length = 0;
    crmSwitchMode('b2c');
    crmToggleAnalytics();
    await new Promise(r => setTimeout(r, 400));
    const t = document.getElementById('crmAnalytics').textContent;
    crmToggleAnalytics();
    customers.push.apply(customers, zaloha);
    return t;
  });
  check('bez zákazníků to nespadne a řekne to', /Zatím/.test(prazdno), prazdno.slice(0, 200));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
