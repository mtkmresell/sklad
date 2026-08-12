// Test: okno Nastavení — širší, tlačítka nástrojů stejně velká
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (cond || extra === undefined ? '' : ' | ' + extra));
  if (!cond) failures++;
}

async function measure(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => { localStorage.setItem('sklad_v3', JSON.stringify([])); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => {
    var modal = document.querySelector('#moSettings .modal');
    var btns = [...document.querySelectorAll('.tool-grid .btn-sec')];
    var r = el => el.getBoundingClientRect();
    return {
      modalW: Math.round(r(modal).width),
      modalOverflows: r(modal).width > document.documentElement.clientWidth,
      count: btns.length,
      widths: [...new Set(btns.map(b => Math.round(r(b).width)))],
      heights: [...new Set(btns.map(b => Math.round(r(b).height)))],
      cols: getComputedStyle(document.querySelector('.tool-grid')).gridTemplateColumns.split(' ').length,
      // nic nesmí přetéct z okna ven
      spill: btns.some(b => r(b).right > r(modal).right + 1 || r(b).left < r(modal).left - 1),
      labelsIntact: btns.map(b => b.textContent.trim()),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  await ctx.close();
  return { data, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

  // ── Desktop
  const d = await measure(browser, 1600, 1000);
  check('okno je výrazně širší než dřívějších 420 px', d.data.modalW >= 700, String(d.data.modalW));
  check('okno se vejde na obrazovku', !d.data.modalOverflows, String(d.data.modalW));
  check('všech 9 nástrojů vykresleno', d.data.count === 9, String(d.data.count));
  check('desktop: všechna tlačítka stejně široká', d.data.widths.length === 1, JSON.stringify(d.data.widths));
  check('desktop: všechna tlačítka stejně vysoká', d.data.heights.length === 1, JSON.stringify(d.data.heights));
  check('desktop: mřížka má 4 sloupce', d.data.cols === 4, String(d.data.cols));
  check('desktop: nic nepřetéká z okna', !d.data.spill, '');
  check('popisky zůstaly beze změny',
    JSON.stringify(d.data.labelsIntact) === JSON.stringify(['Správa platforem', 'Tabulky velikostí', 'Import', 'Export', 'Dropdowny', 'Retaileři & EU limit', 'Přepočítat kurzy ČNB', 'Databáze našeptávače', 'Údaje pro doklad']),
    JSON.stringify(d.data.labelsIntact));
  check('desktop: žádné JS chyby', d.errs.length === 0, JSON.stringify(d.errs.slice(0, 3)));

  // ── Mobil
  const m = await measure(browser, 390, 780);
  check('mobil: tlačítka stejně široká', m.data.widths.length === 1, JSON.stringify(m.data.widths));
  check('mobil: tlačítka stejně vysoká', m.data.heights.length === 1, JSON.stringify(m.data.heights));
  check('mobil: mřížka má 2 sloupce', m.data.cols === 2, String(m.data.cols));
  check('mobil: okno se vejde do šířky', !m.data.modalOverflows && m.data.pageOverflowX <= 0, JSON.stringify(m.data));
  check('mobil: nic nepřetéká z okna', !m.data.spill, '');
  check('mobil: žádné JS chyby', m.errs.length === 0, JSON.stringify(m.errs.slice(0, 3)));

  // ── Tablet (mezistav)
  const t = await measure(browser, 800, 900);
  check('tablet: tlačítka pořád stejně velká', t.data.widths.length === 1 && t.data.heights.length === 1, JSON.stringify([t.data.widths, t.data.heights]));
  check('tablet: okno se vejde', !t.data.modalOverflows && t.data.pageOverflowX <= 0, String(t.data.modalW));

  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
