// Test: na mobilu jde dorolovat i u krátkého seznamu (Na skladě, Čeká)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const datum = (dnu) => new Date(Date.now() - dnu * DEN).toISOString().slice(0, 10);
/* Šest čekajících a šest kusů na skladě — přesně ten počet, který se na
   obrazovku nevejde, ale je ho málo na to, aby rolování „chytlo" samo. */
const SEED = [];
for (let i = 0; i < 6; i++) {
  SEED.push({ id: 'w' + i, name: 'Čekající ' + i, category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'waiting', waitState: 'sent', sellPrice: 2000, profit: 1000, saleDate: datum(2),
    soldWhere: 'Vinted', dateAdded: Date.now() - i * 1000, buyDate: datum(20), tags: [] });
  SEED.push({ id: 's' + i, name: 'Skladový ' + i, category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'stock', location: 'Doma', dateAdded: Date.now() - i * 1000, buyDate: datum(10), tags: [] });
}

async function otevri(browser, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

  // ══════════════════════════════════════════════════════════════
  const m = await otevri(browser, { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });
  const page = m.page;
  await page.evaluate(() => { viewMode = 'table'; });

  /* Na mobilu musí rolovat celá stránka. Dřív rolovalo jen .main pod
     hlavičkou, statistikami a filtry — zbyly mu dvě stovky pixelů a tah
     prstem kdekoli jinde táhl body, které rolovat nejde: stránka se jen
     pružně natáhla a po puštění prstu skočila zpátky. */
  const zkus = (tab) => page.evaluate(async (tab) => {
    switchTab(tab); renderItems();
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 300));
    const radky = [...document.querySelectorAll('tbody tr[data-id]')].filter(r => r.offsetParent);
    const posl = radky[radky.length - 1];
    const se = document.scrollingElement;
    const out = { radku: radky.length, vyska: innerHeight, sirka: innerWidth,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      doc: se.scrollHeight, poslDole: posl ? Math.round(posl.getBoundingClientRect().bottom) : null };
    // Dorolovat na konec a chvíli počkat — skrývání panelů nesmí rolování vrátit
    posl.scrollIntoView({ block: 'end' });
    await new Promise(r => setTimeout(r, 120));
    window.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 600));
    out.y = Math.round(scrollY);
    out.poslDolePo = Math.round(posl.getBoundingClientRect().bottom);
    const hdr = document.querySelector('header');
    out.hlavicka = hdr ? Math.round(hdr.getBoundingClientRect().top) : null;
    return out;
  }, tab);

  for (const [tab, nazev] of [['waiting', 'Čeká'], ['stock', 'Na skladě']]) {
    section('Mobil — ' + nazev);
    const s = await zkus(tab);
    check('seznam má šest řádků', s.radku === 6, JSON.stringify(s));
    check('poslední řádek je pod spodním okrajem — je co rolovat', s.poslDole > s.vyska, JSON.stringify(s));
    check('stránka je delší než obrazovka — rolovat jde', s.doc > s.vyska, JSON.stringify(s));
    check('body si rolování nebere pro sebe', s.bodyOverflow !== 'hidden', JSON.stringify(s));
    check('po dorolování zůstává stránka dole, neskočí zpět', s.y > 0, JSON.stringify(s));
    check('poslední řádek je vidět', s.poslDolePo <= s.vyska + 1, JSON.stringify(s));
    check('hlavička zůstává přilepená nahoře', s.hlavicka !== null && Math.abs(s.hlavicka) <= 1, JSON.stringify(s));
    check('stránka se neoddálila do šířky', s.sirka === 390, JSON.stringify(s));
  }

  section('Mobil — tlačítka v hlavičce');
  const tl = await page.evaluate(() => {
    const r = document.querySelector('.header-right').getBoundingClientRect();
    return { prava: Math.round(r.right), sirka: innerWidth };
  });
  check('hlavička nepřetéká přes pravý okraj', tl.prava <= tl.sirka, JSON.stringify(tl));
  check('žádné JS chyby (mobil)', m.errs.length === 0, JSON.stringify(m.errs.slice(0, 3)));
  await m.ctx.close();

  // ══════════════════════════════════════════════════════════════
  section('Počítač — rozvržení zůstává');
  const d = await otevri(browser, { viewport: { width: 1400, height: 900 } });
  const pc = await d.page.evaluate(async () => {
    viewMode = 'table'; switchTab('waiting'); renderItems();
    await new Promise(r => setTimeout(r, 300));
    const main = document.querySelector('.main');
    return { body: getComputedStyle(document.body).overflowY, main: getComputedStyle(main).overflowY,
      doc: document.scrollingElement.scrollHeight, vyska: innerHeight };
  });
  check('na počítači roluje jen obsah, ne stránka', pc.body === 'hidden' && pc.main === 'auto', JSON.stringify(pc));
  check('stránka sama nepřetéká', pc.doc <= pc.vyska, JSON.stringify(pc));
  check('žádné JS chyby (počítač)', d.errs.length === 0, JSON.stringify(d.errs.slice(0, 3)));
  await d.ctx.close();

  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
