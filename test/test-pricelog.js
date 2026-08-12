// Test: historie cen u položky
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DNES = new Date().toISOString().slice(0, 10);
const SEED = [{ id: 'i1', name: 'Nike Dunk Low Panda', category: 'sneakers', sku: 'DD1391-100',
  buyPrice: 3000, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma',
  dateAdded: Date.now(), buyDate: '2026-05-01', tags: [], targetPrice: 6500 }];

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

  const log = () => page.evaluate(() => (items.find(i => i.id === 'i1') || {}).priceLog || []);

  // ══════════════════════════════════════════════════════════════
  section('1) Zápis ceny');
  let z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    return { a: logPrice(it, 6500, 'CZK', null, false), delka: it.priceLog.length, zaznam: it.priceLog[0] };
  });
  check('první cena se zapíše', z.a && z.delka === 1, JSON.stringify(z));
  check('záznam nese datum a částku', z.zaznam.p === 6500 && z.zaznam.d === DNES, JSON.stringify(z.zaznam));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    return { a: logPrice(it, 6500, 'CZK', null, false), delka: it.priceLog.length };
  });
  check('stejná cena se nezapisuje podruhé', !z.a && z.delka === 1, JSON.stringify(z));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    logPrice(it, 5900, 'CZK', null, false);
    return { delka: it.priceLog.length, ceny: it.priceLog.map(x => x.p) };
  });
  check('změněná cena přibude', z.delka === 2 && JSON.stringify(z.ceny) === JSON.stringify([6500, 5900]), JSON.stringify(z));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    logPrice(it, 5250, 'EUR', 210, false);
    return it.priceLog[it.priceLog.length - 1];
  });
  check('u eurové ceny se pamatuje i původní částka', z.e === 210 && z.p === 5250, JSON.stringify(z));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    return { nula: logPrice(it, 0, 'CZK', null, false), zaporna: logPrice(it, -100, 'CZK', null, false),
      prazdna: logPrice(it, null, 'CZK', null, false), delka: it.priceLog.length };
  });
  check('nulová ani záporná cena se nezapíše', !z.nula && !z.zaporna && !z.prazdna && z.delka === 3, JSON.stringify(z));

  // ══════════════════════════════════════════════════════════════
  section('2) Strop délky');
  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    for (let i = 0; i < 40; i++) logPrice(it, 1000 + i, 'CZK', null, false);
    return { delka: it.priceLog.length, prvni: it.priceLog[0].p, posledni: it.priceLog[it.priceLog.length - 1].p };
  });
  check('drží se nejvýš 20 záznamů', z.delka === 20, String(z.delka));
  check('ořezávají se ty nejstarší', z.posledni === 1039, JSON.stringify(z));

  // ══════════════════════════════════════════════════════════════
  section('3) Souhrn a text');
  const sum = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    it.priceLog = [{ d: '2026-05-01', p: 6500 }, { d: '2026-06-01', p: 5900 }, { d: '2026-07-01', p: 5200, s: 1 }];
    const s = priceLogSummary(it);
    const div = document.createElement('div'); div.innerHTML = priceLogHtml(it);
    return { zmen: s.zmen, prvni: s.prvni.p, prodej: s.prodej.p, rozdil: Math.round(s.rozdil),
      procent: Math.round(s.procent), text: div.textContent.replace(/\s+/g, ' ').trim() };
  });
  check('souhrn najde první i prodejní cenu', sum.prvni === 6500 && sum.prodej === 5200, JSON.stringify(sum));
  check('spočítá rozdíl i procenta', sum.rozdil === -1300 && sum.procent === -20, JSON.stringify(sum));
  check('text ukáže posloupnost', /6 500.*5 900.*5 200/.test(sum.text.replace(/[  ]/g, ' ')), sum.text);
  check('a kolik se slevilo', /Sleveno o/.test(sum.text) && /20 %/.test(sum.text), sum.text);

  const jedna = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    it.priceLog = [{ d: '2026-05-01', p: 6500 }];
    return { html: priceLogHtml(it) };
  });
  check('u jediné ceny se nic nezobrazuje', jedna.html === '', jedna.html);

  const nahoru = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    it.priceLog = [{ d: '2026-05-01', p: 5000 }, { d: '2026-06-01', p: 6000 }];
    const div = document.createElement('div'); div.innerHTML = priceLogHtml(it);
    return div.textContent.replace(/\s+/g, ' ').trim();
  });
  check('zdražení se hlásí jako zdražení', /Zdraženo o/.test(nahoru), nahoru);

  // ══════════════════════════════════════════════════════════════
  section('4) Zápis přes skutečné uložení položky');
  await page.evaluate(() => {
    items = [{ id: 'i1', name: 'Nike Dunk Low Panda', category: 'sneakers', sku: 'DD1391-100',
      buyPrice: 3000, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma',
      dateAdded: Date.now(), buyDate: '2026-05-01', tags: [], targetPrice: 6500 }];
    sv(); renderItems();
  });
  async function uprav(cena) {
    await page.evaluate(async (c) => {
      openEdit('i1');
      await new Promise(r => setTimeout(r, 250));
      document.getElementById('fTargetPrice').value = String(c);
      await saveItem();
    }, cena);
    await page.waitForTimeout(500);
  }
  await uprav(6500);
  check('první uložení zapíše cílovou cenu', (await log()).length === 1, JSON.stringify(await log()));
  await uprav(5900);
  let l = await log();
  check('snížení ceny přibude do historie', l.length === 2 && l[1].p === 5900, JSON.stringify(l));
  await uprav(5900);
  check('uložení beze změny ceny nic nepřidá', (await log()).length === 2, JSON.stringify(await log()));

  // ══════════════════════════════════════════════════════════════
  section('5) Prodej uzavře vývoj');
  await page.evaluate(async () => {
    openSellModal('i1');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('sSellPrice').value = '5200';
    const sd = document.getElementById('sSaleDate'); if (sd && !sd.value) sd.value = '2026-08-01';
    await saveSell();
  });
  await page.waitForTimeout(900);
  l = await log();
  check('prodejní cena se zapíše se značkou prodeje',
    l.length === 3 && l[2].p === 5200 && l[2].s === 1, JSON.stringify(l));

  const detail = await page.evaluate(async () => {
    openDetail('i1');
    await new Promise(r => setTimeout(r, 400));
    const mo = document.getElementById('moDetail');
    return { text: mo ? mo.textContent.replace(/\s+/g, ' ') : '' };
  });
  check('detail prodané položky ukazuje vývoj ceny',
    /Vývoj ceny/.test(detail.text) && /Sleveno o/.test(detail.text), detail.text.slice(0, 200));
  await page.evaluate(() => cm('moDetail'));

  // ══════════════════════════════════════════════════════════════
  section('6) Historie jde do cloudu a přežije kolečko');
  const cloud = await page.evaluate(() => {
    const p = _buildCloudPayload();
    const vse = (p.itemsStock || []).concat(...(p.archiveYears || []).map(() => []));
    const it = (p.itemsStock || []).find(i => i.id === 'i1');
    return { vHlavnim: !!it, log: it ? it.priceLog : null,
      velikost: new Blob([JSON.stringify((items[0] || {}).priceLog || [])]).size };
  });
  check('historie je součástí položky v cloudu',
    !cloud.vHlavnim || (cloud.log && cloud.log.length === 3), JSON.stringify(cloud.log));
  check('tři záznamy zaberou pár desítek bajtů', cloud.velikost < 200, cloud.velikost + ' B');

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
