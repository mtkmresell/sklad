// Test: Vybrat nepřestavuje tabulku a Hledat má animaci
// (VÝBĚR BEZ PŘESTAVBY TABULKY, HLEDÁNÍ — ANIMACE)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const d = (n) => new Date(Date.now() - n * DEN).toISOString().slice(0, 10);
const FOTKA = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const SEED = [];
for (let i = 0; i < 30; i++) SEED.push({ id: 's' + i, name: 'Nike Dunk ' + i, sku: 'DD' + i, size: '42', buyPrice: 2000 + i, buyDate: d(10),
  saleState: 'stock', category: 'sneakers', profile: 'business', targetPrice: i % 3 ? 3000 : undefined, invoiceUrl: i % 2 ? 'https://x.cz/f' : undefined,
  imgUrl: i < 3 ? FOTKA : undefined });
SEED.push({ id: 'w1', name: 'Ceka kus', buyPrice: 1000, buyDate: d(10), saleState: 'waiting', waitState: 'sent', soldWhere: 'Vinted', sellPrice: 1500, category: 'sneakers', profile: 'business' });
SEED.push({ id: 'b1', type: 'bulk', name: 'Balik', saleState: 'waiting', waitState: 'sent', soldWhere: 'Vinted', sellPrice: 5000, saleDate: d(3) });
SEED.push({ id: 'b1a', name: 'Kus v baliku', buyPrice: 1000, buyDate: d(10), saleState: 'waiting', bulkId: 'b1', category: 'sneakers', profile: 'business' });
SEED.push({ id: 'b1b', name: 'Kus v baliku 2', buyPrice: 1000, buyDate: d(10), saleState: 'waiting', bulkId: 'b1', category: 'sneakers', profile: 'business', invoiceUrl: 'https://x.cz/f' });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.addInitScript((s) => { if (!localStorage.getItem('sklad_v3')) localStorage.setItem('sklad_v3', JSON.stringify(s)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { viewMode = 'table'; activeProfile = 'all'; switchTab('stock'); renderItems();
    window.__render = 0; const r = renderItems; window.renderItems = function() { window.__render++; return r.apply(this, arguments); }; });
  await page.waitForTimeout(300);

  // Tabulka beze mezer mezi značkami a bez prázdných tříd — jinak stejná
  const norm = () => page.evaluate(() => document.querySelector('#itemsGrid table').outerHTML
    .replace(/>\s+</g, '><').replace(/ class=""/g, '').replace(/\s+>/g, '>'));
  const doklikni = async () => { await page.evaluate(() => document.getElementById('btnBulkMode').click()); await page.waitForTimeout(900); };
  const jakoRenderItems = async () => {
    const ted = await norm();
    const cerstve = await page.evaluate(() => { const t = tableHTML(getFiltered());
      const div = document.createElement('div'); div.innerHTML = t; return div.firstElementChild.outerHTML; });
    const c = cerstve.replace(/>\s+</g, '><').replace(/ class=""/g, '').replace(/\s+>/g, '>');
    let i = 0; while (i < ted.length && ted[i] === c[i]) i++;
    return { stejne: ted === c, ted: ted.slice(Math.max(0, i - 120), i + 160), c: c.slice(Math.max(0, i - 120), i + 160) };
  };

  for (const sekce of ['stock', 'waiting']) {
    section('1) ' + sekce + ': zapnutí výběru');
    await page.evaluate((s) => { switchTab(s); if (s === 'waiting') expandedBulks.add('b1'); }, sekce);
    await page.evaluate(() => renderItems());
    await page.waitForTimeout(300);
    const pred = await page.evaluate(() => { window.__render = 0; window.__img = document.querySelector('#itemsGrid img'); return document.querySelectorAll('#itemsGrid .chybi-roh').length; });
    const hned = await page.evaluate(() => { document.getElementById('btnBulkMode').click();
      return { text: document.getElementById('btnBulkMode').textContent, lista: document.getElementById('bulkBar').classList.contains('vis'), sloupec: !!document.querySelector('#itemsGrid .vyber-sl') }; });
    check('tlačítko se přepne okamžitě', /Zrušit/.test(hned.text), hned.text);
    check('lišta vyjede okamžitě', hned.lista);
    check('sloupec čeká, až se tlačítko vykreslí', !hned.sloupec);
    await page.waitForTimeout(900);
    const po = await page.evaluate(() => ({ render: window.__render, img: window.__img ? window.__img === document.querySelector('#itemsGrid img') : true,
      cb: document.querySelectorAll('#itemsGrid .bulk-cb-td input').length, rohy: document.querySelectorAll('#itemsGrid .chybi-roh').length,
      animace: document.querySelectorAll('#itemsGrid .vyber-vjezd').length }));
    check('tabulka se znovu nestavěla', po.render === 0, String(po.render));
    check('fotky zůstaly tytéž prvky (nenačítají se znovu)', po.img);
    check('zaškrtávátka jsou u kusů', po.cb > 0, String(po.cb));
    check('žádný roh se neztratil ani nezdvojil', po.rohy === pred, po.rohy + ' / ' + pred);
    check('po animaci nezůstaly pomocné třídy', po.animace === 0, String(po.animace));
    let srov = await jakoRenderItems();
    check('tabulka vypadá přesně jako postavená s výběrem', srov.stejne, srov.stejne ? '' : srov.ted.slice(0, 300) + '\n   ≠ ' + srov.c.slice(0, 300));
    if (sekce === 'stock') {
      const roh = await page.evaluate(() => { const tr = document.querySelector('#itemsGrid tr[data-id="s0"]'); const r = tr.querySelector('.chybi-roh'); return !!r && r.closest('td') === tr.firstElementChild; });
      check('roh sedí v první buňce (zaškrtávátku)', roh);
    }

    section('2) ' + sekce + ': zaškrtnutí a vypnutí');
    const cb = await page.evaluate(() => { const td = document.querySelector('#itemsGrid .bulk-cb-td'); td.click(); return { id: td.dataset.id, ok: td.querySelector('input').checked, vybrano: bulkSelected.has(td.dataset.id) }; });
    check('klik na zaškrtávátko vybere kus', cb.ok && cb.vybrano, JSON.stringify(cb));
    await doklikni();
    const vyp = await page.evaluate(() => ({ render: window.__render, sl: document.querySelectorAll('#itemsGrid .vyber-sl').length, rohy: document.querySelectorAll('#itemsGrid .chybi-roh').length, text: document.getElementById('btnBulkMode').textContent }));
    check('vypnutí sloupec odebere', vyp.sl === 0, String(vyp.sl));
    check('a tabulku taky nestaví znovu', vyp.render === 0, String(vyp.render));
    check('rohy se vrátily, žádný nezmizel', vyp.rohy === pred, vyp.rohy + ' / ' + pred);
    check('tlačítko je zpátky „Vybrat"', vyp.text === 'Vybrat', vyp.text);
    srov = await jakoRenderItems();
    check('tabulka vypadá přesně jako postavená bez výběru', srov.stejne, srov.stejne ? '' : srov.ted.slice(0, 300) + '\n   ≠ ' + srov.c.slice(0, 300));
  }

  section('3) Rychlé dvojí kliknutí');
  await page.evaluate(() => { switchTab('stock'); renderItems(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.getElementById('btnBulkMode'); b.click(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => { const b = document.getElementById('btnBulkMode'); b.click(); b.click(); });
  await page.waitForTimeout(900);
  const dvoji = await page.evaluate(() => ({ mode: bulkMode, sl: document.querySelectorAll('#itemsGrid thead .vyber-sl').length,
    radky: [...document.querySelectorAll('#itemsGrid tbody tr')].every(tr => tr.firstElementChild.classList.contains('vyber-sl')),
    odjezd: document.querySelectorAll('#itemsGrid .vyber-odjezd').length }));
  check('po vyp-zap je výběr zapnutý a sloupec právě jeden', dvoji.mode && dvoji.sl === 1 && dvoji.radky, JSON.stringify(dvoji));
  check('zaškrtávátka nezůstala schovaná', dvoji.odjezd === 0, String(dvoji.odjezd));
  await doklikni();

  section('4) Shift-výběr rozsahu nepřestavuje tabulku');
  await doklikni();
  const rozsah = await page.evaluate(() => { window.__render = 0;
    const tds = document.querySelectorAll('#itemsGrid .bulk-cb-td'); tds[0].click();
    tds[4].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    return { render: window.__render, vybrano: bulkSelected.size, zaskrtnuto: document.querySelectorAll('#itemsGrid .bulk-cb-td input:checked').length }; });
  check('rozsah vybere pět kusů', rozsah.vybrano === 5 && rozsah.zaskrtnuto === 5, JSON.stringify(rozsah));
  check('a tabulka se nestavěla znovu', rozsah.render === 0, String(rozsah.render));
  await doklikni();

  section('5) Karty a Prodáno se nerozbijí');
  await page.evaluate(() => { viewMode = 'cards'; renderItems(); });
  await doklikni();
  check('v kartách výběr jde zapnout bez chyby', await page.evaluate(() => bulkMode && !!document.querySelector('#itemsGrid .item-card')));
  await doklikni();
  await page.evaluate(() => { viewMode = 'table'; switchTab('sold'); });
  await doklikni(); await doklikni();
  check('v Prodáno taky', await page.evaluate(() => !bulkMode));
  await page.evaluate(() => { switchTab('stock'); });

  section('6) Hledat ve všech sekcích — animace');
  const gs = await page.evaluate(() => { openGlobalSearch(); const ov = document.getElementById('_globalSearchOverlay');
    return { tridy: ov.className, panel: getComputedStyle(ov.querySelector('.gs-panel')).animationName, pozadi: getComputedStyle(ov).animationName,
      fokus: document.activeElement && document.activeElement.id }; });
  check('panel má vjezd', gs.panel === 'gsPanel', gs.panel);
  check('pozadí se roztmívá', gs.pozadi === 'gsPozadi', gs.pozadi);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const zav = await page.evaluate(() => { const ov = document.getElementById('_globalSearchOverlay');
    return { je: !!ov, odchod: ov && ov.classList.contains('gs-odchod'), klik: ov && getComputedStyle(ov).pointerEvents }; });
  check('Escape spustí odjezd', zav.je && zav.odchod, JSON.stringify(zav));
  check('zavírající se okno nechytá kliky', zav.klik === 'none', String(zav.klik));
  const znovu = await page.evaluate(() => { openGlobalSearch(); const v = document.querySelectorAll('#_globalSearchOverlay');
    return { pocet: v.length, odchod: v[0] && v[0].classList.contains('gs-odchod') }; });
  check('otevření během odjezdu dá nové okno, ne to zavírající', znovu.pocet === 1 && !znovu.odchod, JSON.stringify(znovu));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('po odjezdu okno zmizí', await page.evaluate(() => !document.getElementById('_globalSearchOverlay')));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
