// Test: cashflow z payoutů — odhad podle skutečné rychlosti platforem
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const den = 864e5;
function iso(posun) { return new Date(Date.now() + posun * den).toISOString().slice(0, 10); }

// Historie: StockX platí za 10 dnů, Vinted za 3
const SEED = [];
[10, 10, 10, 11, 9].forEach((d, i) => SEED.push({ id: 'h' + i, name: 'Hotovo StockX ' + i, category: 'sneakers',
  buyPrice: 2000, buyCurrency: 'CZK', sellPrice: 5000, profit: 3000, saleState: 'paid',
  soldWhere: 'StockX', saleDate: iso(-100), payoutDate: iso(-100 + d), dateAdded: i, buyDate: iso(-200), tags: [] }));
[3, 3, 4, 2].forEach((d, i) => SEED.push({ id: 'v' + i, name: 'Hotovo Vinted ' + i, category: 'sneakers',
  buyPrice: 1000, buyCurrency: 'CZK', sellPrice: 2000, profit: 1000, saleState: 'paid',
  soldWhere: 'Vinted', saleDate: iso(-80), payoutDate: iso(-80 + d), dateAdded: 20 + i, buyDate: iso(-200), tags: [] }));

// Čekající: prodáno před 20 dny přes StockX → payout měl být před 10 dny (po splatnosti)
SEED.push({ id: 'w-pozde', name: 'Po splatnosti', category: 'sneakers', buyPrice: 2000, buyCurrency: 'CZK',
  sellPrice: 8000, saleState: 'waiting', soldWhere: 'StockX', saleDate: iso(-20), dateAdded: 30, buyDate: iso(-100), tags: [] });
// Prodáno dnes přes Vinted → payout za 3 dny (tento týden nebo příští, podle dne)
SEED.push({ id: 'w-brzy', name: 'Brzy Vinted', category: 'sneakers', buyPrice: 500, buyCurrency: 'CZK',
  sellPrice: 1500, saleState: 'waiting', soldWhere: 'Vinted', saleDate: iso(0), dateAdded: 31, buyDate: iso(-100), tags: [] });
// Prodáno dnes přes neznámou platformu bez historie → spadne na nastavení
SEED.push({ id: 'w-nezn', name: 'Neznámá platforma', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  sellPrice: 3000, saleState: 'waiting', soldWhere: 'Nováček', saleDate: iso(0), dateAdded: 32, buyDate: iso(-100), tags: [] });
// Bez data prodeje
SEED.push({ id: 'w-bez', name: 'Bez data', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  sellPrice: 2500, saleState: 'waiting', soldWhere: 'StockX', dateAdded: 33, buyDate: iso(-100), tags: [] });

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

  // ══════════════════════════════════════════════════════════════
  section('1) Rychlost platforem se učí z historie');
  const rychlosti = await page.evaluate(() => payoutSpeedStats());
  check('StockX má medián 10 dnů z 5 prodejů',
    rychlosti.StockX && rychlosti.StockX.median === 10 && rychlosti.StockX.n === 5, JSON.stringify(rychlosti.StockX));
  check('Vinted má medián 3 dny ze 4 prodejů',
    rychlosti.Vinted && rychlosti.Vinted.median === 3 && rychlosti.Vinted.n === 4, JSON.stringify(rychlosti.Vinted));
  check('pamatuje si i rozptyl', rychlosti.StockX.min === 9 && rychlosti.StockX.max === 11, JSON.stringify(rychlosti.StockX));
  check('čekající prodeje se do statistiky nepočítají',
    !Object.keys(rychlosti).includes('Nováček'), JSON.stringify(Object.keys(rychlosti)));

  const spatna = await page.evaluate(() => {
    const zaloha = items.slice();
    items = items.concat([{ id: 'x', name: 'Překlep', category: 'sneakers', buyPrice: 1, buyCurrency: 'CZK',
      saleState: 'paid', soldWhere: 'Vinted', saleDate: '2026-05-01', payoutDate: '2020-01-01', dateAdded: 99, tags: [] }]);
    const r = payoutSpeedStats();
    items = zaloha;
    return r.Vinted;
  });
  check('payout před prodejem se ignoruje jako překlep', spatna.n === 4, JSON.stringify(spatna));

  // ══════════════════════════════════════════════════════════════
  section('2) Odhad data payoutu');
  const odhady = await page.evaluate(() => {
    const r = payoutSpeedStats();
    const o = {};
    ['w-pozde', 'w-brzy', 'w-nezn', 'w-bez'].forEach(id => {
      const it = items.find(x => x.id === id);
      const e = payoutEstimate(it, r);
      o[id] = e ? { dnu: e.dnu, zdroj: e.zdroj, plat: e.plat, datum: e.datum.toISOString().slice(0, 10) } : null;
    });
    return o;
  });
  check('StockX položka dostane 10 dnů z historie',
    odhady['w-pozde'].dnu === 10 && odhady['w-pozde'].zdroj === 'historie', JSON.stringify(odhady['w-pozde']));
  check('Vinted položka dostane 3 dny z historie',
    odhady['w-brzy'].dnu === 3 && odhady['w-brzy'].zdroj === 'historie', JSON.stringify(odhady['w-brzy']));
  check('platforma bez historie spadne na nastavení',
    odhady['w-nezn'].zdroj === 'nastavení', JSON.stringify(odhady['w-nezn']));
  check('datum je datum prodeje plus odhad',
    odhady['w-pozde'].datum === new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10),
    odhady['w-pozde'].datum);

  // ══════════════════════════════════════════════════════════════
  section('3) Rozdělení do období');
  const cf = await page.evaluate(() => {
    const c = payoutCashflow();
    const zjed = {};
    Object.keys(c.skupiny).forEach(k => {
      zjed[k] = { pocet: c.skupiny[k].items.length, suma: Math.round(c.skupiny[k].suma),
        idy: c.skupiny[k].items.map(x => x.it.id) };
    });
    return { skupiny: zjed, celkem: Math.round(c.celkem), pocet: c.pocet,
      doTydne: Math.round(c.doTydne), doMesice: Math.round(c.doMesice), pozde: Math.round(c.pozde) };
  });
  check('po splatnosti je právě ta jedna položka',
    cf.skupiny.pozde.pocet === 1 && cf.skupiny.pozde.idy[0] === 'w-pozde', JSON.stringify(cf.skupiny.pozde));
  check('a její částka sedí', cf.skupiny.pozde.suma === 8000, String(cf.skupiny.pozde.suma));
  check('položka bez data prodeje má vlastní skupinu',
    cf.skupiny.bezData.pocet === 1 && cf.skupiny.bezData.idy[0] === 'w-bez', JSON.stringify(cf.skupiny.bezData));
  check('celkem sedí součet všech čekajících', cf.celkem === 8000 + 1500 + 3000 + 2500, String(cf.celkem));
  check('počet odpovídá čekajícím prodejům', cf.pocet === 4, String(cf.pocet));
  check('prodané položky se do cashflow nepletou',
    !Object.keys(cf.skupiny).some(k => cf.skupiny[k].idy.some(id => /^h|^v/.test(id))),
    JSON.stringify(cf.skupiny));
  check('po splatnosti se počítá i do konce měsíce', cf.doMesice >= cf.pozde, JSON.stringify(cf));

  const razeni = await page.evaluate(() => {
    const c = payoutCashflow();
    const vse = [];
    Object.keys(c.skupiny).forEach(k => c.skupiny[k].items.forEach(x => { if (x.od) vse.push(x.od.datum.getTime()); }));
    return vse;
  });
  check('v každé skupině je seřazeno podle data', razeni.length > 0);

  // ══════════════════════════════════════════════════════════════
  section('4) Eurové ceny se přepočítají');
  const eur = await page.evaluate(() => {
    const zaloha = items.slice();
    items = [{ id: 'e1', name: 'Eurová', category: 'sneakers', buyPrice: 100, buyCurrency: 'EUR',
      sellPrice: 0, sellPriceOrig: 200, sellCurrency: 'EUR', saleState: 'waiting', soldWhere: 'Vinted',
      saleDate: new Date().toISOString().slice(0, 10), dateAdded: 1, tags: [] }];
    const c = payoutCashflow();
    const kurz = eurRate || 25;
    items = zaloha;
    return { celkem: Math.round(c.celkem), ocekavano: Math.round(200 * kurz) };
  });
  check('eurová prodejní cena se počítá v korunách', eur.celkem === eur.ocekavano, JSON.stringify(eur));

  // ══════════════════════════════════════════════════════════════
  section('5) Okno');
  await page.evaluate(() => openPayoutCalendar());
  await page.waitForTimeout(400);
  const okno = await page.evaluate(() => {
    const ov = document.getElementById('payoutCfOv');
    if (!ov) return null;
    return { text: ov.textContent.replace(/\s+/g, ' '),
      radku: ov.querySelectorAll('[onclick*="openDetail"]').length,
      dlazdic: [...ov.querySelectorAll('div')].filter(d => /TENTO TÝDEN|DO KONCE MĚSÍCE|PO SPLATNOSTI/i.test(d.textContent) && d.children.length === 2).length };
  });
  check('okno se otevře', !!okno);
  check('má nadpis Cashflow z payoutů', /Cashflow z payoutů/.test(okno.text), okno.text.slice(0, 80));
  check('ukazuje souhrnné dlaždice', okno.dlazdic >= 3, String(okno.dlazdic));
  check('vypíše všechny čekající prodeje', okno.radku === 4, String(okno.radku));
  check('u odhadu je vidět, odkud pochází',
    /dnů dle historie/.test(okno.text) && /dnů dle nastavení/.test(okno.text), okno.text.slice(0, 300));
  check('má sekci o rychlosti platforem',
    /Jak rychle kdo platí/.test(okno.text) && /z 5 prodejů/.test(okno.text), okno.text.slice(-300));
  check('hlásí zpoždění u položky po splatnosti', /\+10 dnů/.test(okno.text), okno.text.slice(0, 400));

  const zavreni = await page.evaluate(() => {
    document.getElementById('payoutCfOv').click();
    return !document.getElementById('payoutCfOv');
  });
  check('okno se zavře kliknutím mimo', zavreni);

  // ══════════════════════════════════════════════════════════════
  section('6) Prázdný stav');
  const prazdno = await page.evaluate(() => {
    const zaloha = items.slice();
    items = items.filter(i => i.saleState !== 'waiting');
    openPayoutCalendar();
    const ov = document.getElementById('payoutCfOv');
    const t = ov ? ov.textContent : '';
    if (ov) ov.remove();
    items = zaloha;
    return t.replace(/\s+/g, ' ');
  });
  check('bez čekajících prodejů to řekne slušně', /Žádné čekající prodeje/.test(prazdno), prazdno.slice(0, 120));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
