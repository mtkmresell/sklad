// Test: rozbalovací nabídky na mobilu — ťuknutí vybírá, tah prstem ne
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SEED = [{ id: 'i1', name: 'Kus', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  saleState: 'stock', location: 'Doma', dateAdded: Date.now(), buyDate: '2026-01-01', tags: [] }];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  /* Zkušební nabídka se třiceti místy, vložená stejnou cestou jako každý
     jiný select v aplikaci. Stojí pevně u spodního okraje — tam, kde na
     mobilu bývá filtr, pod kterým už není místo. */
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'zkHost';
    host.style.cssText = 'position:fixed;left:10px;bottom:20px;z-index:5000;';
    const sel = document.createElement('select');
    sel.id = 'zkSelect';
    sel.innerHTML = '<option value="">Všude</option>'
      + Array.from({ length: 30 }, (_, i) => '<option value="m' + i + '">Místo ' + i + '</option>').join('');
    host.appendChild(sel);
    document.body.appendChild(host);
    initCustomSelect(sel);
  });

  // Dotyk se skládá ručně — Playwright umí jen ťuknutí, ne tah s přehmátnutím
  const dotyk = (cil, dy, mezitimRoluj) => page.evaluate(async ({ cil, dy, mezitimRoluj }) => {
    const el = typeof cil === 'string' ? document.querySelector(cil) : null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const t0 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));
    if (mezitimRoluj) document.querySelector('#zkHost .cs-drop').scrollTop += mezitimRoluj;
    const t1 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y + dy });
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t1], bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 150));
  }, { cil, dy, mezitimRoluj });

  const stav = () => page.evaluate(() => {
    const drop = document.querySelector('#zkHost .cs-drop');
    const r = drop.getBoundingClientRect();
    return { otevreno: drop.classList.contains('open'), hodnota: document.getElementById('zkSelect').value,
      horni: Math.round(r.top), dolni: Math.round(r.bottom), vyska: innerHeight,
      nahoru: drop.classList.contains('cs-nahoru'), scroll: drop.scrollTop,
      prelevani: getComputedStyle(drop).overscrollBehaviorY };
  });

  // ══════════════════════════════════════════════════════════════
  section('1) Ťuknutí na tlačítko nabídku otevře');
  await dotyk('#zkHost .cs-btn', 0);
  let s = await stav();
  check('nabídka je otevřená', s.otevreno, JSON.stringify(s));

  // ══════════════════════════════════════════════════════════════
  section('2) Nabídka se vejde na obrazovku');
  check('celá je vidět — nepřetéká pod spodní okraj', s.dolni <= s.vyska && s.horni >= 0, JSON.stringify(s));
  check('dole místo není, tak se otevřela nahoru', s.nahoru, JSON.stringify(s));
  check('rolování se nepřelévá do stránky', s.prelevani === 'contain', JSON.stringify(s));

  // ══════════════════════════════════════════════════════════════
  section('3) Tah prstem nic nevybere');
  // Prst na 6. položce, tah o 60 px — jako při rolování
  await dotyk('#zkHost .cs-opt:nth-child(6)', -60);
  s = await stav();
  check('po tahu nic vybrané není', s.hodnota === '', JSON.stringify(s));
  check('a nabídka zůstala otevřená', s.otevreno, JSON.stringify(s));

  /* Přehmátnutí: prst se zvedne na místě, ale pod ním se nabídka mezitím
     odrolovala (setrvačnost). Přesně tady se dřív vybíralo místo prodeje. */
  await dotyk('#zkHost .cs-opt:nth-child(8)', 0, 80);
  s = await stav();
  check('zvednutý prst po rolování nic nevybere', s.hodnota === '', JSON.stringify(s));
  check('nabídka je pořád otevřená', s.otevreno, JSON.stringify(s));

  // Dá se dojet až na konec seznamu
  const konec = await page.evaluate(() => {
    const drop = document.querySelector('#zkHost .cs-drop');
    drop.scrollTop = drop.scrollHeight;
    const posl = drop.querySelector('.cs-opt:last-child').getBoundingClientRect();
    const r = drop.getBoundingClientRect();
    return { posledniVidet: posl.bottom <= r.bottom + 1 && posl.bottom <= innerHeight };
  });
  check('poslední položka jde odrolovat do zorného pole', konec.posledniVidet, JSON.stringify(konec));

  // ══════════════════════════════════════════════════════════════
  section('4) Ťuknutí vybírá');
  await dotyk('#zkHost .cs-opt:last-child', 3);
  s = await stav();
  check('ťuknutí vybralo poslední místo', s.hodnota === 'm29', JSON.stringify(s));
  check('a nabídka se zavřela', !s.otevreno, JSON.stringify(s));

  // Rolování stránky přes tlačítko nabídku neotevře
  await dotyk('#zkHost .cs-btn', -50);
  check('tah přes tlačítko nabídku neotevře', !(await stav()).otevreno);

  // ══════════════════════════════════════════════════════════════
  section('5) Skutečný filtr Listing ve skladu');
  const filtr = await page.evaluate(async () => {
    switchTab('stock');
    await new Promise(r => setTimeout(r, 300));
    const sel = document.getElementById('filterListingStatus');
    const wrap = sel && sel.closest('.cs-wrap');
    return { prosel: !!(sel && sel._csInited && wrap) };
  });
  check('filtr Nalistováno/Nenalistováno jde přes vlastní nabídku', filtr.prosel, JSON.stringify(filtr));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
