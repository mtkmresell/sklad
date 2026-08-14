// Test: zdroj poptávky u prodeje a evidence vratek
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const POLOZKY = [
  { id: 'p1', name: 'Nike Dunk Low', buyPrice: 2500, buyCurrency: 'CZK', saleState: 'stock', dateAdded: '2026-01-10', buyDate: '2026-01-10' },
  { id: 'p2', name: 'Jordan 1', buyPrice: 3000, buyCurrency: 'CZK', saleState: 'waiting', soldWhere: 'StockX',
    sellPrice: 5000, saleDate: '2026-06-01', dateAdded: '2026-01-05', buyDate: '2026-01-05' },
  // Kus vrácený ještě před zavedením evidence — pozná se podle toho, že leží
  // na skladě, ale pamatuje si, kde se prodával
  { id: 'p3', name: 'Yeezy 350', buyPrice: 4000, buyCurrency: 'CZK', saleState: 'stock', soldWhere: 'Footshop',
    location: 'Footshop', dateAdded: '2026-02-01', buyDate: '2026-02-01' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript(d => localStorage.setItem('sklad_v3', JSON.stringify(d)), POLOZKY);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ══════════════════════════════════════════════════════════════
  section('1) Nabídka zdrojů');
  const zdroje = await page.evaluate(() => ({
    ids: DEMAND_SOURCES.map(s => s.id),
    labels: DEMAND_SOURCES.map(s => s.l),
    popisek: demandLabel('doporuceni'),
    neznamy: demandLabel('cosi'),
  }));
  check('čtyři zdroje', zdroje.ids.length === 4, JSON.stringify(zdroje.ids));
  check('mezi nimi Instagram i doporučení',
    zdroje.ids.includes('instagram') && zdroje.ids.includes('doporuceni'), JSON.stringify(zdroje.ids));
  check('popisek se dohledá', zdroje.popisek === 'Doporučení', zdroje.popisek);
  check('neznámé id nespadne', zdroje.neznamy === '', JSON.stringify(zdroje.neznamy));

  // ══════════════════════════════════════════════════════════════
  section('2) Přepínač v prodejním okně');
  const chipy = await page.evaluate(async () => {
    openSellModal('p1');
    await new Promise(r => setTimeout(r, 350));
    const box = document.getElementById('sDemandChips');
    return { pocet: box.querySelectorAll('.demand-chip').length, vybrano: box.dataset.val };
  });
  check('vykreslí se čtyři chipy', chipy.pocet === 4, JSON.stringify(chipy));
  check('nic není předvybrané', chipy.vybrano === '', JSON.stringify(chipy));

  const vyber = await page.evaluate(async () => {
    demandPick('s', 'instagram');
    const po1 = { val: getDemandValue('s'), on: document.querySelectorAll('#sDemandChips .demand-chip.on').length };
    demandPick('s', 'doporuceni');            // přepnutí na jiný
    const po2 = getDemandValue('s');
    demandPick('s', 'doporuceni');            // druhé kliknutí na stejný = zrušení
    const po3 = getDemandValue('s');
    return { po1, po2, po3 };
  });
  check('kliknutí vybere zdroj', vyber.po1.val === 'instagram' && vyber.po1.on === 1, JSON.stringify(vyber.po1));
  check('další klik přepne', vyber.po2 === 'doporuceni', vyber.po2);
  check('klik na vybraný ho zruší', vyber.po3 === '', JSON.stringify(vyber.po3));

  // ══════════════════════════════════════════════════════════════
  section('3) Zobrazí se jen u prodeje napřímo');
  const viditelnost = await page.evaluate(async () => {
    const nastav = (kam) => {
      document.getElementById('sSoldWhere').value = kam;
      updateBuyerTypeVisibility('s');
      return document.getElementById('sDemandRow').style.display;
    };
    return { stockx: nastav('StockX'), osobne: nastav('Osobní odběr'), prazdno: nastav('') };
  });
  check('u platformy je pole schované', viditelnost.stockx === 'none', JSON.stringify(viditelnost));
  check('u prodeje napřímo je vidět', viditelnost.osobne === '', JSON.stringify(viditelnost));

  // ══════════════════════════════════════════════════════════════
  section('4) Uloží se k položce');
  const ulozeno = await page.evaluate(async () => {
    openSellModal('p1');
    await new Promise(r => setTimeout(r, 350));
    document.getElementById('sSellPrice').value = '4200';
    document.getElementById('sSoldWhere').value = 'Osobní odběr';
    updateBuyerTypeVisibility('s');
    demandPick('s', 'doporuceni');
    await saveSell();
    await new Promise(r => setTimeout(r, 400));
    const it = items.find(x => x.id === 'p1');
    return { zdroj: it.demandSource, stav: it.saleState };
  });
  check('zdroj poptávky je u položky', ulozeno.zdroj === 'doporuceni', JSON.stringify(ulozeno));
  check('prodej samotný proběhl', ulozeno.stav === 'waiting', ulozeno.stav);

  // U platformy se zdroj neuloží, i kdyby v přepínači zůstal vybraný
  const platforma = await page.evaluate(async () => {
    const id = 'p9';
    items.push({ id, name: 'Test plat', buyPrice: 1000, buyCurrency: 'CZK', saleState: 'stock', buyDate: '2026-03-01' });
    openSellModal(id);
    await new Promise(r => setTimeout(r, 350));
    demandPick('s', 'instagram');
    document.getElementById('sSellPrice').value = '1500';
    document.getElementById('sSoldWhere').value = 'StockX';
    updateBuyerTypeVisibility('s');
    await saveSell();
    await new Promise(r => setTimeout(r, 400));
    return (items.find(x => x.id === id) || {}).demandSource;
  });
  check('u platformy se zdroj nezapíše', !platforma, JSON.stringify(platforma));

  // ══════════════════════════════════════════════════════════════
  section('5) Evidence vratek');
  const vratka = await page.evaluate(async () => {
    const it = items.find(x => x.id === 'p2');
    logReturn(it);
    return { pocet: (it.returns || []).length, zaznam: (it.returns || [])[0] };
  });
  check('vratka se zapíše', vratka.pocet === 1, JSON.stringify(vratka));
  check('a pamatuje si kam se prodávalo', vratka.zaznam && vratka.zaznam.w === 'StockX', JSON.stringify(vratka.zaznam));
  check('i datum', vratka.zaznam && /^\d{4}-\d{2}-\d{2}$/.test(vratka.zaznam.d), JSON.stringify(vratka.zaznam));

  const bezPlatformy = await page.evaluate(() => {
    const it = { id: 'x', name: 'Bez platformy' };
    logReturn(it);
    return it.returns;
  });
  check('bez „kde prodáno" se nezapisuje nic', bezPlatformy === undefined, JSON.stringify(bezPlatformy));

  // Opakovaná vratka téhož kusu se přidá, nepřepíše
  const dvakrat = await page.evaluate(() => {
    const it = items.find(x => x.id === 'p2');
    logReturn(it);
    return (it.returns || []).length;
  });
  check('druhá vratka se přidá', dvakrat === 2, JSON.stringify(dvakrat));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
