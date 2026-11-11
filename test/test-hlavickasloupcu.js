// Test: plovoucí hlavička sloupců (klon thead) se při rolování lepí
// k horní hraně seznamu a nezakryje nic nad ním — pruh pohledu účetního,
// proužek o staré kopii dat (majitel, 11. 11. 2026)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const datum = (dnu) => new Date(Date.now() - dnu * DEN).toISOString().slice(0, 10);
const SEED = [];
for (let i = 0; i < 60; i++) {
  SEED.push({ id: 's' + i, name: 'Skladový ' + i, category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'stock', location: 'Doma', dateAdded: Date.now() - i * 1000, buyDate: datum(10), tags: [] });
}
// Prodáno: dva měsíce po třiceti prodejích
for (let i = 0; i < 60; i++) {
  const m = i < 30 ? '2026-10' : '2026-09';
  SEED.push({ id: 'p' + i, name: 'Prodaný ' + i, category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 2000, profit: 1000, soldWhere: 'Vinted', saleDate: m + '-0' + (1 + i % 9),
    payoutDate: m + '-1' + (i % 9), dateAdded: Date.now() - i * 1000, buyDate: '2026-08-01', tags: [] });
}

async function otevri(browser, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { viewMode = 'table'; switchTab('stock'); renderItems(); });
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

// Odroluje (na počítači .main, na mobilu stránku) a vrátí polohy
const odroluj = (page, mobil) => page.evaluate(async (mobil) => {
  const main = document.querySelector('.main');
  for (let y = 0; y <= 900; y += 150) {   // po kouscích, ať se panely schovají jako při kolečku
    if (mobil) { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); }
    else { main.scrollTop = y; main.dispatchEvent(new Event('scroll')); }
    await new Promise(r => setTimeout(r, 60));
  }
  await new Promise(r => setTimeout(r, 600));   // doběhne animace schovávání
  const k = document.getElementById('theadClone');
  const r = (el) => el ? el.getBoundingClientRect() : null;
  const lista = document.getElementById('uctetniLista'), pruh = document.getElementById('stareDataPruh');
  return {
    klon: k && getComputedStyle(k).display !== 'none' ? Math.round(r(k).top) : null,
    main: Math.round(r(main).top),
    hlavicka: Math.round(r(document.querySelector('header')).bottom),
    lista: lista && lista.offsetParent ? Math.round(r(lista).bottom) : null,
    pruh: pruh && pruh.offsetParent ? Math.round(r(pruh).bottom) : null,
  };
}, mobil);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

  section('Počítač — majitel');
  let o = await otevri(browser, { viewport: { width: 1400, height: 800 } });
  let p = await odroluj(o.page, false);
  check('klon se po odrolování ukáže', p.klon !== null, JSON.stringify(p));
  check('klon sedí na horní hraně seznamu', p.klon !== null && Math.abs(p.klon - p.main) <= 1, JSON.stringify(p));
  check('klon nezajede pod hlavičku', p.klon !== null && p.klon >= p.hlavicka - 1, JSON.stringify(p));

  section('Počítač — proužek o staré kopii dat');
  await o.page.evaluate(() => {
    document.querySelector('.main').scrollTop = 0;
    const pr = document.getElementById('stareDataPruh'); pr.textContent = 'Data z kopie'; pr.style.display = '';
  });
  await o.page.waitForTimeout(400);
  p = await odroluj(o.page, false);
  check('klon nezakryje proužek', p.klon !== null && p.pruh !== null && p.klon >= p.pruh - 1, JSON.stringify(p));
  check('žádné chyby', o.errs.length === 0, o.errs.join(' | '));
  await o.ctx.close();

  section('Počítač — pohled účetního');
  o = await otevri(browser, { viewport: { width: 1400, height: 800 } });
  await o.page.evaluate(() => { document.body.classList.add('uctetni'); _vykresliUctetniListu(); renderItems(); });
  await o.page.waitForTimeout(300);
  p = await odroluj(o.page, false);
  check('pruh účetního je pořád vidět', p.lista !== null && p.lista > p.hlavicka, JSON.stringify(p));
  check('klon se ukáže', p.klon !== null, JSON.stringify(p));
  check('klon sedí pod pruhem účetního, nezakrývá ho', p.klon !== null && p.klon >= p.lista - 1, JSON.stringify(p));
  check('a sedí na hraně seznamu', p.klon !== null && Math.abs(p.klon - p.main) <= 1, JSON.stringify(p));
  if (process.env.SNIMEK) await o.page.screenshot({ path: process.env.SNIMEK + '/ucetni-rolovani.png', clip: { x: 0, y: 0, width: 1400, height: 200 } });
  check('žádné chyby', o.errs.length === 0, o.errs.join(' | '));
  await o.ctx.close();

  /* Prodáno: pruh měsíce a hlavička jeho tabulky se lepí nahoru */
  const prodano = async (page, mobil, y) => page.evaluate(async (a) => {
    switchTab('sold'); soldViewMode = 'table'; renderSoldView();
    await new Promise(r => setTimeout(r, 200));
    const main = document.querySelector('.main');
    if (a.mobil) { window.scrollTo(0, a.y); window.dispatchEvent(new Event('scroll')); }
    else { main.scrollTop = a.y; main.dispatchEvent(new Event('scroll')); }
    await new Promise(r => setTimeout(r, 600));
    const vid = [...document.querySelectorAll('.sold-mesic-hl')].map(h => h.getBoundingClientRect());
    const ths = [...document.querySelectorAll('.sold-tab thead th:first-child')].map(t => t.getBoundingClientRect());
    const hore = a.mobil ? document.querySelector('header').getBoundingClientRect().bottom : main.getBoundingClientRect().top;
    // který pruh je přilepený: ten, jehož skupina sahá přes horní hranu
    const sk = [...document.querySelectorAll('.sold-mesic')].findIndex(g => { const r = g.getBoundingClientRect(); return r.top < hore + 1 && r.bottom > hore + 120; });
    return { hore: Math.round(hore), sk, hl: sk >= 0 ? Math.round(vid[sk].top) : null, hlDole: sk >= 0 ? Math.round(vid[sk].bottom) : null,
      th: sk >= 0 ? Math.round(ths[sk].top) : null, text: sk >= 0 ? document.querySelectorAll('.sold-mesic-hl')[sk].textContent.slice(0, 20) : '' };
  }, { mobil, y });

  section('Prodáno — počítač');
  o = await otevri(browser, { viewport: { width: 1400, height: 800 } });
  for (const [y, popis] of [[600, 'první měsíc'], [1700, 'druhý měsíc']]) {
    p = await prodano(o.page, false, y);
    check(popis + ': pruh měsíce je přilepený nahoře', p.sk >= 0 && Math.abs(p.hl - p.hore) <= 1, JSON.stringify(p));
    check(popis + ': hlavička sloupců hned pod ním', p.sk >= 0 && p.th >= p.hlDole && p.th - p.hlDole <= 10, JSON.stringify(p));
  }
  if (process.env.SNIMEK) await o.page.screenshot({ path: process.env.SNIMEK + '/prodano-lepeni.png', clip: { x: 0, y: 0, width: 1400, height: 260 } });
  check('žádné chyby', o.errs.length === 0, o.errs.join(' | '));
  await o.ctx.close();

  section('Prodáno — mobil');
  o = await otevri(browser, { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });
  p = await prodano(o.page, true, 900);
  check('pruh měsíce visí pod přilepenou hlavičkou', p.sk >= 0 && Math.abs(p.hl - p.hore) <= 1, JSON.stringify(p));
  check('hlavička sloupců hned pod ním', p.sk >= 0 && p.th >= p.hlDole && p.th - p.hlDole <= 10, JSON.stringify(p));
  check('žádné chyby', o.errs.length === 0, o.errs.join(' | '));
  await o.ctx.close();

  section('Mobil — roluje celá stránka');
  o = await otevri(browser, { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });
  p = await odroluj(o.page, true);
  check('klon se ukáže', p.klon !== null, JSON.stringify(p));
  check('klon visí pod přilepenou hlavičkou', p.klon !== null && Math.abs(p.klon - p.hlavicka) <= 1, JSON.stringify(p));
  check('žádné chyby', o.errs.length === 0, o.errs.join(' | '));
  await o.ctx.close();

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAIL' : '\nOK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
