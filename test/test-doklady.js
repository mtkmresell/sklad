// Test: prodejní doklady a nastavení míst prodeje.
//
// Co se u prodeje vystavuje, se řídí místem, kde se prodalo — nastavuje
// se ve Správě platforem. Osobní věci doklad nedostanou vůbec.
//
// Hlídá se hlavně to, že se doklad nenabídne tam, kam nepatří: u osobních
// věcí a u platforem, které si doklad dělají samy. Nabídnutý doklad
// k prodeji na StockX by byl doklad navíc k tomu, co vystavil StockX.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  // Firebase by po načtení ohlásil „nikdo přihlášený" a smazal nastavení,
  // které si tenhle test ukládá — a test je o dokladech, ne o přihlašování
  await page.route('**/firebasejs/**', route => route.abort());
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.readyState === 'complete' && typeof getPlatDocType === 'function'
      && typeof openPlatMgr === 'function' && !!document.getElementById('itemsGrid'),
    { timeout: 20000 });
  await page.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════
  section('1) Výchozí nastavení podle skupiny');
  const vychozi = await page.evaluate(() => {
    localStorage.removeItem('sklad_plat_groups_v1');
    return {
      stockx: getPlatDocType('StockX'),          // platformy → nic
      sneaker: getPlatDocType('Sneakerstore'),   // eshopy → nic
      vinted: getPlatDocType('Vinted'),          // local → doklad
      bazos: getPlatDocType('Bazoš.cz'),
      neznamy: getPlatDocType('Někdo úplně nový'),
      prazdno: getPlatDocType(''),
    };
  });
  check('platforma nevystavuje nic', vychozi.stockx === 'nic', vychozi.stockx);
  check('komisní eshop taky ne', vychozi.sneaker === 'nic', vychozi.sneaker);
  check('local prodej dostane doklad', vychozi.vinted === 'doklad', vychozi.vinted);
  check('a Bazoš taky', vychozi.bazos === 'doklad', vychozi.bazos);
  // Neznámé místo je nejspíš přímý prodej — doklad je bezpečnější než nic
  check('neznámé místo dostane doklad', vychozi.neznamy === 'doklad', vychozi.neznamy);
  check('prázdné místo taky', vychozi.prazdno === 'doklad', vychozi.prazdno);

  section('2) Vlastní nastavení přebije výchozí');
  const vlastni = await page.evaluate(() => {
    var g = getPlatGroups();
    g.platDoc = { 'StockX': 'doklad', 'Vinted': 'faktura', 'Sneakerstore': 'nesmysl' };
    savePlatGroupsData(g);
    return {
      stockx: getPlatDocType('StockX'),
      vinted: getPlatDocType('Vinted'),
      nesmysl: getPlatDocType('Sneakerstore'),
    };
  });
  check('platforma může dostat doklad', vlastni.stockx === 'doklad', vlastni.stockx);
  check('local může mít fakturu', vlastni.vinted === 'faktura', vlastni.vinted);
  check('neznámá hodnota spadne na výchozí', vlastni.nesmysl === 'nic', vlastni.nesmysl);

  // ══════════════════════════════════════════════════════════════
  section('3) Kdy se doklad nabídne');
  const kdy = await page.evaluate(() => {
    var g = getPlatGroups();
    g.platDoc = { 'Vinted': 'doklad', 'StockX': 'nic', 'Sneakerstore': 'faktura' };
    savePlatGroupsData(g);
    const kus = (o) => Object.assign({ id: 'x', name: 'Kus', saleState: 'paid' }, o);
    return {
      vinted: lzeVystavitDoklad(kus({ soldWhere: 'Vinted' })),
      stockx: lzeVystavitDoklad(kus({ soldWhere: 'StockX' })),
      eshop: lzeVystavitDoklad(kus({ soldWhere: 'Sneakerstore' })),
      osobni: lzeVystavitDoklad(kus({ soldWhere: 'Vinted', personal: true })),
      fakturaVinted: chceOdkazNaFakturu(kus({ soldWhere: 'Vinted' })),
      fakturaEshop: chceOdkazNaFakturu(kus({ soldWhere: 'Sneakerstore' })),
      fakturaOsobni: chceOdkazNaFakturu(kus({ soldWhere: 'Sneakerstore', personal: true })),
    };
  });
  check('u local prodeje ano', kdy.vinted === true);
  check('u platformy, co si to řeší sama, ne', kdy.stockx === false);
  check('u místa s fakturou ne', kdy.eshop === false);
  check('u osobní věci nikdy', kdy.osobni === false, 'osobní prodej není podnikání');
  check('odkaz na fakturu jen u faktury', kdy.fakturaEshop === true && kdy.fakturaVinted === false);
  check('a u osobní věci taky ne', kdy.fakturaOsobni === false);

  // ══════════════════════════════════════════════════════════════
  section('4) Detail místa ve správě platforem');
  await page.evaluate(() => {
    var g = getPlatGroups();
    g.payoutDays = { 'Sneakerstore': 30 };
    g.platDoc = {}; g.platBilling = {};
    savePlatGroupsData(g);
    openPlatMgr();
    openPlatDetail('Sneakerstore', 'eshopy');
  });
  await page.waitForTimeout(200);
  const detail = await page.evaluate(() => ({
    payout: (document.getElementById('pdPayout') || {}).value,
    maTyp: !!document.getElementById('pdDocType'),
    typZabalen: !!(document.getElementById('pdDocType') || {}).closest?.('.cs-wrap'),
    // Nejdelší volba je „Nic — řeší platforma"; v úzkém tlačítku se ořízne
    typSiroky: !!(document.getElementById('pdDocType') || {}).closest?.('.cs-wrap')?.classList.contains('cs-fullwidth'),
    maFakturacni: !!document.getElementById('pdCompany'),
    maAdresu: !!document.getElementById('pdAddress'),
  }));
  check('lhůta se předvyplní z nastavení', detail.payout === '30', detail.payout);
  check('je tam volba dokladu', detail.maTyp === true);
  check('a má vlastní vzhled', detail.typZabalen === true, 'systémový select do aplikace nezapadá');
  check('a je přes celou šířku', detail.typSiroky === true, 'jinak se nejdelší volba ořízne');
  check('u eshopu jsou fakturační údaje', detail.maFakturacni && detail.maAdresu);

  // U local prodeje kupujícím není firma, tak tam ta pole nepatří
  await page.evaluate(() => { openPlatMgr(false); openPlatDetail('Vinted', 'local'); });
  await page.waitForTimeout(200);
  const local = await page.evaluate(() => ({ maFakturacni: !!document.getElementById('pdCompany') }));
  check('u local prodeje fakturační údaje nejsou', local.maFakturacni === false);

  /* Spodní tlačítka patří celému oknu, ne detailu — a dokud o detailu
     nevěděla, vyhazovala uživatele z celé správy platforem. Uložit jedno
     místo a vypadnout ven je to poslední, co člověk chce; obvykle jich
     nastavuje víc po sobě. */
  section('4b) Zpět z detailu vede na seznam, ne ven');
  const zpet = await page.evaluate(() => {
    openPlatMgr();
    openPlatDetail('Sneakerstore', 'eshopy');
    document.querySelector('#moPlatMgr [data-action="closeplatmgr"]').click();
    return {
      oknoOtevrene: document.getElementById('moPlatMgr').classList.contains('open'),
      nastaveniZavrena: !document.getElementById('moSettings').classList.contains('open'),
      vSeznamu: !document.getElementById('pdDocType') && !!document.getElementById('pmg_eshopy'),
    };
  });
  check('správa platforem zůstane otevřená', zpet.oknoOtevrene === true);
  check('nastavení se neotevře', zpet.nastaveniZavrena === true, 'to je o dvě patra výš');
  check('a jsme zpátky na seznamu míst', zpet.vSeznamu === true);

  // Ze seznamu naopak Zpět ven vede — tam je to správně
  const zpetZeSeznamu = await page.evaluate(() => {
    openPlatMgr();
    document.querySelector('#moPlatMgr [data-action="closeplatmgr"]').click();
    return {
      oknoZavrene: !document.getElementById('moPlatMgr').classList.contains('open'),
      nastaveniOtevrena: document.getElementById('moSettings').classList.contains('open'),
    };
  });
  check('ze seznamu Zpět zavře správu', zpetZeSeznamu.oknoZavrene === true);
  check('a otevře nastavení', zpetZeSeznamu.nastaveniOtevrena === true);

  section('4c) Uložit z detailu taky vede na seznam');
  const poUlozeni = await page.evaluate(() => {
    document.getElementById('moSettings').classList.remove('open');
    openPlatMgr();
    openPlatDetail('Sneakerstore', 'eshopy');
    document.getElementById('pdPayout').value = '33';
    savePlatMgr();
    return {
      oknoOtevrene: document.getElementById('moPlatMgr').classList.contains('open'),
      vSeznamu: !document.getElementById('pdDocType') && !!document.getElementById('pmg_eshopy'),
      ulozeno: (getPlatGroups().payoutDays || {})['Sneakerstore'],
    };
  });
  check('okno zůstane otevřené', poUlozeni.oknoOtevrene === true);
  check('jsme na seznamu míst', poUlozeni.vSeznamu === true);
  check('a změna se opravdu uložila', poUlozeni.ulozeno === 33, String(poUlozeni.ulozeno));

  section('5) Detail se uloží');
  const ulozeno = await page.evaluate(() => {
    openPlatMgr();
    openPlatDetail('Sneakerstore', 'eshopy');
    document.getElementById('pdPayout').value = '45';
    document.getElementById('pdDocType').value = 'faktura';
    document.getElementById('pdCompany').value = 'Sneaker s.r.o.';
    document.getElementById('pdIco').value = '12345678';
    document.getElementById('pdAddress').value = 'Ulice 1, Praha';
    savePlatMgr();                       // uloží rovnou z detailu
    var g = getPlatGroups();
    return {
      dny: g.payoutDays && g.payoutDays['Sneakerstore'],
      typ: getPlatDocType('Sneakerstore'),
      firma: getPlatBilling('Sneakerstore').company,
      ico: getPlatBilling('Sneakerstore').ico,
    };
  });
  check('lhůta se uložila', ulozeno.dny === 45, String(ulozeno.dny));
  check('typ dokladu taky', ulozeno.typ === 'faktura', ulozeno.typ);
  check('i fakturační údaje', ulozeno.firma === 'Sneaker s.r.o.' && ulozeno.ico === '12345678',
    JSON.stringify(ulozeno));

  // ══════════════════════════════════════════════════════════════
  section('6) Co je na dokladu');
  const doklad = await page.evaluate(() => {
    var g = getPlatGroups();
    g.platDoc = { 'Vinted': 'doklad', 'Sneakerstore': 'doklad' };
    g.platBilling = { 'Sneakerstore': { company: 'Sneaker s.r.o.', ico: '12345678', dic: 'CZ12345678', address: 'Ulice 1, Praha' } };
    savePlatGroupsData(g);
    customers = [{ id: 'c1', name: 'Petr Novák', address: 'Dlouhá 5, Brno',
      contacts: [{ type: 'telefon', value: '777123456' }, { type: 'email', value: 'petr@example.com' }] }];
    items = [
      { id: 'k1', name: 'Dunk Panda', sku: 'DD1391', size: '44', saleState: 'paid',
        sellPrice: 3000, saleDate: '2026-08-01', soldWhere: 'Vinted', linkedCustomerId: 'c1' },
      { id: 'k2', name: 'LEGO Titanic', saleState: 'paid', sellPrice: 9000,
        saleDate: '2026-08-02', soldWhere: 'Sneakerstore' },
    ];
    // Doklad se otevírá do nového okna; podstrčíme si zápis, ať ho vidíme
    var zachyceno = {};
    var puvodni = window.open;
    window.open = function () {
      return { document: { write: function (h) { zachyceno.html = h; }, close: function () {} }, focus: function () {} };
    };
    try { openSaleDocument('k1'); } catch (e) { zachyceno.chyba = String(e); }
    var koncovy = zachyceno.html || '';
    zachyceno = {};
    try { openSaleDocument('k2'); } catch (e) { zachyceno.chyba = String(e); }
    var firemni = zachyceno.html || '';
    window.open = puvodni;
    return { koncovy, firemni };
  });

  check('u local prodeje je kupujícím zákazník',
    /Petr Novák/.test(doklad.koncovy), doklad.koncovy.slice(0, 200));
  check('s telefonem i e-mailem',
    /777123456/.test(doklad.koncovy) && /petr@example\.com/.test(doklad.koncovy));
  check('a adresou', /Dlouhá 5, Brno/.test(doklad.koncovy));

  check('u komisního eshopu je kupujícím ten eshop',
    /Sneaker s\.r\.o\./.test(doklad.firemni), doklad.firemni.slice(0, 200));
  check('s IČO i DIČ',
    /12345678/.test(doklad.firemni) && /CZ12345678/.test(doklad.firemni));
  check('zákazník se tam neplete', !/Petr Novák/.test(doklad.firemni));

  section('7) Drobnosti na dokladu');
  check('žádné „Použité zboží"', !/Použité zboží/.test(doklad.koncovy),
    'v podnikání se prodává nové');
  check('tlačítko tisku je až na konci',
    doklad.koncovy.lastIndexOf('noprint') > doklad.koncovy.indexOf('Celkem k úhradě'),
    'nahoře překáželo v tom podstatném');
  check('a je zarovnané doprava', /justify-content:flex-end/.test(doklad.koncovy));

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
