// Test: rozbalovací seznamy mají vlastní vzhled.
//
// Systémový <select> vypadá v každém prohlížeči jinak a do tmavého vzhledu
// aplikace vůbec nezapadá — rozbalí se bílé okno s modrým zvýrazněním.
// Proto se každý select prohání funkcí initCustomSelect(), která ho zabalí
// do .cs-wrap a nahradí vlastní nabídkou.
//
// Zapomenout na to je snadné: u selectu psaného do HTML se jeho id musí
// přidat do seznamu při startu, u selectu vznikajícího za běhu se musí
// initCustomSelect() zavolat ručně. Ani jedno není vidět, dokud se na
// dropdown nekliknne.
//
// Tenhle test to hlídá. Když přibude nový select, buď dostane vlastní
// vzhled, nebo se musí vědomě dopsat do VYJIMKY i s důvodem.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

// Selecty, které vlastní vzhled mít nemusí — a proč
const VYJIMKY = {
  fLocationSel:      'skrytý, drží hodnotu pro vlastní dropdown lokace',
  sSoldWhereSelect:  'skrytý, drží hodnotu pro vlastní dropdown míst prodeje',
  fFpCislo:          'stylovaný ručně inline podle proměnných aplikace',
  // Zbytek je starší dluh, ne nové selhání. Až se dodělá, smaž je odsud.
  calcBuyCur:        'DLUH: kalkulačka marží',
  calcSellCur:       'DLUH: kalkulačka marží',
  crmHMType:         'DLUH: formulář historie v CRM',
  crmHMCategory:     'DLUH: formulář historie v CRM',
  crmHMPriceCur:     'DLUH: formulář historie v CRM',
  crmHMPayment:      'DLUH: formulář historie v CRM',
  crmHMStatus:       'DLUH: formulář historie v CRM',
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.readyState === 'complete' && typeof initCustomSelect === 'function',
    { timeout: 20000 });
  await page.waitForTimeout(500);

  const holé = () => page.evaluate(() => Array.from(document.querySelectorAll('select'))
    .filter(s => !s.closest('.cs-wrap'))
    .map(s => s.id || '(bez id)'));

  // ══════════════════════════════════════════════════════════════
  section('1) Selecty napsané v HTML');
  const vsechny = await page.evaluate(() => document.querySelectorAll('select').length);
  const bezVzhledu = await holé();
  const nove = bezVzhledu.filter(id => !(id in VYJIMKY));
  check('aplikace nějaké selecty má', vsechny > 20, String(vsechny));
  check('žádný select bez vlastního vzhledu mimo známé výjimky',
    nove.length === 0,
    nove.length ? 'chybí u: ' + nove.join(', ') + '\n  → přidej id do seznamu při startu, nebo zavolej initCustomSelect()' : '');
  check('žádný select nemá prázdné id', !bezVzhledu.includes('(bez id)'),
    'select bez id nejde zaregistrovat');

  section('2) Kupující u bulk prodeje');
  const bs = await page.evaluate(() => {
    const s = document.getElementById('bsBuyerType');
    return { existuje: !!s, zabaleny: !!(s && s.closest('.cs-wrap')) };
  });
  check('typ kupujícího v bulk prodeji existuje', bs.existuje === true);
  check('a má vlastní vzhled', bs.zabaleny === true);

  // ══════════════════════════════════════════════════════════════
  section('3) Selecty vznikající až za běhu');
  await page.evaluate(() => {
    localStorage.clear();
    items = [
      { id: 'bulk_x', type: 'bulk', name: 'Testovací balík', saleState: 'paid', sellPrice: 1000,
        totalBuyPrice: 500, profit: 500, extraCosts: 0, itemIds: ['kx'], itemPrices: {},
        saleDate: '01.05.2026', payoutDate: '2026-05-10', profitRateEur: 25 },
      { id: 'kx', name: 'Kus', buyPrice: 500, buyCurrency: 'CZK', saleState: 'paid',
        bulkId: 'bulk_x', sellPrice: 0, tags: [] },
    ];
    customers = []; partners = [];
    openBulkEditModal('bulk_x');
  });
  await page.waitForTimeout(400);

  // Konkrétní prvky, ne „první pevně umístěný blok" — takových je na stránce víc
  const vModalu = await page.evaluate(() => {
    const stav = {};
    ['beBuyerType', '_beC', '_beTrkCarrier'].forEach(id => {
      const s = document.getElementById(id);
      stav[id] = s ? (s.closest('.cs-wrap') ? 'ok' : 'holý') : 'chybí';
    });
    return stav;
  });
  check('editace balíku se otevřela', vModalu._beC !== 'chybí', JSON.stringify(vModalu));
  check('typ kupujícího má vlastní vzhled', vModalu.beBuyerType === 'ok', vModalu.beBuyerType);
  check('měna má vlastní vzhled', vModalu._beC === 'ok', vModalu._beC);
  check('dopravce má vlastní vzhled', vModalu._beTrkCarrier === 'ok', vModalu._beTrkCarrier);

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
