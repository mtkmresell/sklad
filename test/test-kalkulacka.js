// Test: kalkulačka marže z nákupní ceny a kopírování prodejní ceny z detailu
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const datum = (dnu) => new Date(Date.now() - dnu * DEN).toISOString().slice(0, 10);
const SEED = [
  { id: 'sk1', name: 'Kus na skladě', category: 'sneakers', buyPrice: 3200, buyCurrency: 'CZK',
    saleState: 'stock', location: 'Doma', dateAdded: Date.now(), buyDate: datum(10), tags: [] },
  { id: 'sk2', name: 'Eurový kus', category: 'sneakers', buyPrice: 140, buyCurrency: 'EUR',
    saleState: 'stock', location: 'Doma', dateAdded: Date.now(), buyDate: datum(12), tags: [] },
  { id: 'ck1', name: 'Čekající kus', category: 'sneakers', buyPrice: 2000, buyCurrency: 'CZK',
    saleState: 'waiting', waitState: 'sent', sellPrice: 4500, profit: 2500, saleDate: datum(2),
    soldWhere: 'Vinted', dateAdded: Date.now(), buyDate: datum(30), tags: [] },
  { id: 'ce1', name: 'Eurový prodej', category: 'sneakers', buyPrice: 2000, buyCurrency: 'CZK',
    saleState: 'waiting', waitState: 'sent', sellPrice: 5125, sellPriceOrig: 205.5, sellCurrency: 'EUR',
    profit: 3125, saleDate: datum(2), soldWhere: 'Vinted', dateAdded: Date.now(), buyDate: datum(30), tags: [] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const stav = () => page.evaluate(() => ({
    calc: document.getElementById('moCalc').style.display !== 'none',
    buy: document.getElementById('calcBuy').value,
    cur: document.getElementById('calcBuyCur').value,
    fokus: document.activeElement ? document.activeElement.id : '',
    detail: document.getElementById('moDetail').classList.contains('open'),
    calcOpen: document.body.classList.contains('calc-open'),
  }));
  const zavriVse = () => page.evaluate(() => {
    const c = document.getElementById('moCalc');
    if (c.style.display !== 'none') toggleCalc();
    document.getElementById('calcBuy').value = '';
    cm('moDetail');
  });
  const klikniNakup = (tab, id) => page.evaluate(async ({ tab, id }) => {
    switchTab(tab); renderItems();
    await new Promise(r => setTimeout(r, 300));
    const td = document.querySelector('tr[data-id="' + id + '"] .td-buy');
    if (!td) return false;
    td.click();
    await new Promise(r => setTimeout(r, 300));
    return true;
  }, { tab, id });

  // ══════════════════════════════════════════════════════════════
  section('1) Klik na nákupní cenu kusu na skladě otevře kalkulačku');
  await page.evaluate(() => { viewMode = 'table'; });
  check('buňka s nákupní cenou se našla', await klikniNakup('stock', 'sk1'));
  let s = await stav();
  check('kalkulačka je otevřená', s.calc, JSON.stringify(s));
  check('nákupní cena je předvyplněná', s.buy === '3200' && s.cur === 'CZK', JSON.stringify(s));
  check('fokus je na prodejní ceně — stačí ji dopsat', s.fokus === 'calcSell', JSON.stringify(s));
  check('a detail položky se neotevřel', !s.detail, JSON.stringify(s));

  // Druhý klik na jiný kus kalkulačku nezavře, jen přepíše nákup
  await klikniNakup('stock', 'sk2');
  s = await stav();
  check('další klik ji nechá otevřenou a vloží nový nákup',
    s.calc && s.buy === '140' && s.cur === 'EUR', JSON.stringify(s));

  // ══════════════════════════════════════════════════════════════
  section('2) Escape kalkulačku zavře');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  s = await stav();
  check('po Escapu je zavřená', !s.calc, JSON.stringify(s));
  check('a nákupní ceny v seznamu přestaly být klikatelné pro kalkulačku', !s.calcOpen, JSON.stringify(s));
  const tlacitko = await page.evaluate(() => document.getElementById('btnCalc').classList.contains('active'));
  check('tlačítko kalkulačky v hlavičce zhaslo', !tlacitko);

  // Escape bez otevřené kalkulačky ji neotevře
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Escape bez kalkulačky ji neotevře', !(await stav()).calc);

  // ══════════════════════════════════════════════════════════════
  section('3) U čekajícího kusu se kalkulačka sama neotvírá');
  await zavriVse();
  await klikniNakup('waiting', 'ck1');
  s = await stav();
  check('kalkulačka zůstala zavřená', !s.calc, JSON.stringify(s));
  check('klik otevřel detail jako dřív', s.detail, JSON.stringify(s));
  await zavriVse();

  // Otevřená kalkulačka ale nákup převezme odkudkoli — jako dosud
  await page.evaluate(() => toggleCalc());
  await klikniNakup('waiting', 'ck1');
  s = await stav();
  check('otevřená kalkulačka převezme nákup i z Čeká', s.calc && s.buy === '2000', JSON.stringify(s));
  await zavriVse();

  // ══════════════════════════════════════════════════════════════
  section('4) Kartové zobrazení');
  const karta = await page.evaluate(async () => {
    switchTab('stock'); setView('grid'); renderItems();
    await new Promise(r => setTimeout(r, 300));
    const el = document.querySelector('[data-id="sk1"] .pv-buy');
    if (!el) return null;
    el.click();
    await new Promise(r => setTimeout(r, 300));
    return { calc: document.getElementById('moCalc').style.display !== 'none',
      buy: document.getElementById('calcBuy').value };
  });
  check('na kartě klik na nákup kalkulačku otevře', karta && karta.calc && karta.buy === '3200', JSON.stringify(karta));
  await zavriVse();
  await page.evaluate(() => { setView('table'); });

  // ══════════════════════════════════════════════════════════════
  section('5) Prodejní cena se z detailu kopíruje jako holé číslo');
  const kopie = (id) => page.evaluate(async (id) => {
    openDetail(id);
    await new Promise(r => setTimeout(r, 300));
    const td = [...document.querySelectorAll('#moDetail td')].find(t => t.textContent.trim() === 'Prodejní cena');
    const span = td && td.nextElementSibling.querySelector('[data-action="copytext"]');
    const out = span ? { text: decodeURIComponent(span.dataset.text), vidim: span.textContent.trim() } : null;
    cm('moDetail');
    return out;
  }, id);
  let k = await kopie('ck1');
  check('u korunového prodeje jde zkopírovat', !!k, JSON.stringify(k));
  check('a kopíruje se jen číslo, bez měny a mezer', k && k.text === '4500', JSON.stringify(k));
  check('na obrazovce zůstává cena s měnou', k && /Kč/.test(k.vidim), JSON.stringify(k));
  k = await kopie('ce1');
  check('u eurového prodeje eura, ne přepočet, s desetinnou čárkou', k && k.text === '205,5', JSON.stringify(k));

  // Klik zkopíruje do schránky skutečně jen číslo
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const schranka = await page.evaluate(async () => {
    openDetail('ck1');
    await new Promise(r => setTimeout(r, 300));
    const td = [...document.querySelectorAll('#moDetail td')].find(t => t.textContent.trim() === 'Prodejní cena');
    td.nextElementSibling.querySelector('[data-action="copytext"]').click();
    await new Promise(r => setTimeout(r, 300));
    const txt = await navigator.clipboard.readText();
    cm('moDetail');
    return txt;
  });
  check('ve schránce je 4500', schranka === '4500', JSON.stringify(schranka));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
