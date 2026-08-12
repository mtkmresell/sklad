// Test: jeden seznam synchronizovaných nastavení řídí všechna tři místa
const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SEED = [{ id: 'i1', name: 'Bota', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }];

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
  await page.evaluate(installFakeFirestore);

  // ══════════════════════════════════════════════════════════════
  section('1) Seznam je úplný a konzistentní');
  const seznam = await page.evaluate(() => ({
    polozek: syncSettings().length,
    klice: syncSettings().map(s => s.key),
    pole: syncSettings().map(s => s.field),
    duplicitniKlice: syncSettings().map(s => s.key).length !== new Set(syncSettings().map(s => s.key)).size,
    duplicitniPole: syncSettings().map(s => s.field).length !== new Set(syncSettings().map(s => s.field)).size,
    platneTvary: syncSettings().every(s => ['json', 'text', 'number'].includes(s.shape)),
  }));
  check('seznam má položky', seznam.polozek >= 11, String(seznam.polozek));
  check('žádné duplicitní klíče ani pole', !seznam.duplicitniKlice && !seznam.duplicitniPole, JSON.stringify(seznam.klice));
  check('všechny tvary jsou platné', seznam.platneTvary, JSON.stringify(seznam));
  check('rozložení analytiky je nově v seznamu',
    seznam.klice.includes('an_order_v2') && seznam.klice.includes('sa_order'), JSON.stringify(seznam.klice));

  // ══════════════════════════════════════════════════════════════
  section('2) Odhlášení maže přesně to, co je v seznamu');
  const mazani = await page.evaluate(() => {
    // Naplň každý klíč ze seznamu i lokální klíče
    syncSettings().forEach(s => localStorage.setItem(s.key, s.shape === 'number' ? '123' : (s.shape === 'text' ? 'xx' : '["a"]')));
    SYNC_FREQ_KEYS.forEach(k => localStorage.setItem(k, '{"x":1}'));
    syncLocalOnlyKeys().forEach(k => localStorage.setItem(k, 'x'));
    localStorage.setItem('sklad_item_cache_v2', '{"name:x":{}}');   // cache se schválně nemaže
    clearSkladLocalStorage();
    return {
      zbylo: syncSettings().map(s => s.key).filter(k => localStorage.getItem(k) !== null),
      zbylyFreq: SYNC_FREQ_KEYS.filter(k => localStorage.getItem(k) !== null),
      zbyloLokalni: syncLocalOnlyKeys().filter(k => localStorage.getItem(k) !== null),
      cache: !!localStorage.getItem('sklad_item_cache_v2'),
    };
  });
  check('všechna synchronizovaná nastavení se smažou', !mazani.zbylo.length, JSON.stringify(mazani.zbylo));
  check('frekvence i lokální klíče se smažou', !mazani.zbylyFreq.length && !mazani.zbyloLokalni.length, JSON.stringify(mazani));
  check('našeptávač se odhlášením nemaže', mazani.cache, JSON.stringify(mazani));

  // ══════════════════════════════════════════════════════════════
  section('3) Kolečko tam a zpět zachová každou hodnotu');
  const kolecko = await page.evaluate(() => {
    const vzorky = {
      'sklad_plat_groups_v1': JSON.stringify({ eshopy: ['A', 'B'] }),
      'sklad_retailers_v1': JSON.stringify([{ name: 'Footshop', zone: 'cz' }]),
      'sklad_io_limit_v1': '326000',
      'sklad_custom_cats_v1': JSON.stringify([{ key: 'vinyl', label: 'Vinyl' }]),
      'sklad_payment_opts_v1': JSON.stringify(['Fio', 'Revolut']),
      'sklad_loc_opts_v1': JSON.stringify(['Doma', 'Sklep']),
      'sklad_wishlist_v1': JSON.stringify([{ id: 'w1', name: 'Panda' }]),
      'an_order_v2': JSON.stringify(['a', 'b', 'c', 'd']),
      'sa_order': JSON.stringify(['x', 'y', 'z']),
      'carrier_freq': JSON.stringify({ 'Zásilkovna': 5 }),
    };
    Object.keys(vzorky).forEach(k => localStorage.setItem(k, vzorky[k]));
    // Tabulky velikostí žijí v paměti, localStorage je jen jejich otisk
    steTables = { nike: { label: 'Nike', rows: [['42', '27', '8']] } };
    steBrandOrder = ['nike', 'adidas'];
    const payload = _buildCloudPayload();
    // Vyčisti a načti zpátky
    clearSkladLocalStorage();
    applySyncSettings(JSON.parse(JSON.stringify(payload)));
    const po = {};
    Object.keys(vzorky).forEach(k => { po[k] = localStorage.getItem(k); });
    return { vzorky, po, payload: Object.keys(payload),
      ste: { tabulky: payload.steTables, poradi: payload.steBrandOrder } };
  });
  const rozdily = Object.keys(kolecko.vzorky).filter(k => {
    const a = kolecko.vzorky[k], b = kolecko.po[k];
    try { return JSON.stringify(JSON.parse(a)) !== JSON.stringify(JSON.parse(b)); } catch (e) { return a !== b; }
  });
  check('všechny hodnoty přežily cestu do cloudu a zpět', !rozdily.length,
    JSON.stringify(rozdily.map(k => ({ k, pred: kolecko.vzorky[k], po: kolecko.po[k] }))));
  check('tabulky velikostí z paměti se do balíčku dostanou',
    /"nike"/.test(kolecko.ste.tabulky || '') && JSON.stringify(kolecko.ste.poradi) === JSON.stringify(['nike', 'adidas']),
    JSON.stringify(kolecko.ste));
  check('balíček obsahuje pole pro každé nastavení',
    ['platGroups', 'steTables', 'steBrandOrder', 'retailers', 'ioLimit', 'customCats',
     'paymentOpts', 'locOpts', 'wishlist', 'anOrder', 'saOrder', 'freqMaps'].every(f => kolecko.payload.includes(f)),
    JSON.stringify(kolecko.payload));

  // ══════════════════════════════════════════════════════════════
  section('4) Čerstvé zařízení nepřepíše cloud prázdnem');
  const cerstve = await page.evaluate(() => {
    clearSkladLocalStorage();                    // jako po odhlášení
    const prazdny = _buildCloudPayload();
    // Tabulky velikostí se dopisují z paměti, takže nulové nikdy nejsou
    const zPameti = ['steTables', 'steBrandOrder'];
    const ocekavaneNulove = syncSettings().map(s => s.field).filter(f => !zPameti.includes(f));
    const nulove = ocekavaneNulove.filter(f => prazdny[f] === null);
    const chybi = ocekavaneNulove.filter(f => prazdny[f] !== null);
    // Cloud má hodnoty — načtení je musí přinést, ne smazat
    const zCloudu = {
      paymentOpts: ['Fio'], locOpts: ['Doma'], customCats: [{ key: 'x', label: 'X' }],
      wishlist: [{ id: 'w1', name: 'Panda' }], retailers: [{ name: 'Footshop' }],
      anOrder: ['a', 'b'], saOrder: ['x'], ioLimit: 326000,
      platGroups: JSON.stringify({ eshopy: ['A'] }), steBrandOrder: ['nike'],
    };
    applySyncSettings(zCloudu);
    const naplneno = Object.keys(zCloudu).length;
    // A teď prázdný cloud na plné lokální hodnoty
    applySyncSettings({ paymentOpts: [], locOpts: [], customCats: [], wishlist: [],
      retailers: [], anOrder: [], saOrder: [], platGroups: '', steBrandOrder: [] });
    return {
      nulove: nulove, chybi: chybi,
      poNacteni: { pay: JSON.parse(localStorage.getItem('sklad_payment_opts_v1') || '[]').length,
        wish: JSON.parse(localStorage.getItem('sklad_wishlist_v1') || '[]').length,
        an: JSON.parse(localStorage.getItem('an_order_v2') || '[]').length,
        ret: JSON.parse(localStorage.getItem('sklad_retailers_v1') || '[]').length },
      naplneno,
    };
  });
  check('nenastavené klíče jdou do cloudu jako null, ne jako výchozí hodnoty',
    !cerstve.chybi.length, 'nenulové: ' + JSON.stringify(cerstve.chybi));
  check('prázdný cloud nepřepíše načtené hodnoty',
    cerstve.poNacteni.pay === 1 && cerstve.poNacteni.wish === 1 && cerstve.poNacteni.an === 2 && cerstve.poNacteni.ret === 1,
    JSON.stringify(cerstve.poNacteni));

  // ══════════════════════════════════════════════════════════════
  section('5) Rozložení analytiky přežije odhlášení a přihlášení');
  const rozlozeni = await page.evaluate(() => new Promise(res => {
    localStorage.setItem('an_order_v2', JSON.stringify(['zisk', 'roi', 'kategorie', 'platformy']));
    localStorage.setItem('sa_order', JSON.stringify(['prehled', 'trend', 'per-platforma']));
    items = [{ id: 'i1', name: 'Bota', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
      saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }];
    fbSaveToCloud();
    setTimeout(function() {
      const vCloudu = window.__doc('data');
      // Odhlášení vymaže lokální kopii
      document.dispatchEvent(new CustomEvent('fb-auth', { detail: {} }));
      setTimeout(function() {
        const poOdhlaseni = localStorage.getItem('an_order_v2');
        // Přihlášení zpátky načte z cloudu
        applySyncSettings(vCloudu);
        res({
          vCloudu: vCloudu.anOrder, saVCloudu: vCloudu.saOrder,
          poOdhlaseni: poOdhlaseni,
          poPrihlaseni: JSON.parse(localStorage.getItem('an_order_v2') || 'null'),
          saPoPrihlaseni: JSON.parse(localStorage.getItem('sa_order') || 'null'),
        });
      }, 300);
    }, 500);
  }));
  check('pořadí panelů se dostane do cloudu',
    JSON.stringify(rozlozeni.vCloudu) === JSON.stringify(['zisk', 'roi', 'kategorie', 'platformy']), JSON.stringify(rozlozeni.vCloudu));
  check('odhlášením lokálně zmizí', rozlozeni.poOdhlaseni === null, String(rozlozeni.poOdhlaseni));
  check('přihlášením se vrátí z cloudu',
    JSON.stringify(rozlozeni.poPrihlaseni) === JSON.stringify(['zisk', 'roi', 'kategorie', 'platformy'])
    && JSON.stringify(rozlozeni.saPoPrihlaseni) === JSON.stringify(['prehled', 'trend', 'per-platforma']),
    JSON.stringify(rozlozeni));

  // ══════════════════════════════════════════════════════════════
  section('6) Rozepsaná tabulka velikostí se neztratí');
  const tabulky = await page.evaluate(() => {
    steTables = { nike: { label: 'Nike', rows: [['42', '27', '8.5']] } };
    steBrandOrder = ['nike'];
    localStorage.removeItem('ste_custom_tables');
    const p = _buildCloudPayload();        // musí si ji propsat do localStorage sám
    return { vBalicku: p.steTables, vUlozisti: localStorage.getItem('ste_custom_tables'), poradi: p.steBrandOrder };
  });
  check('tabulka jen v paměti se do balíčku dostane',
    /Nike/.test(tabulky.vBalicku || '') && /Nike/.test(tabulky.vUlozisti || ''), JSON.stringify(tabulky));
  check('pořadí značek taky', JSON.stringify(tabulky.poradi) === JSON.stringify(['nike']), JSON.stringify(tabulky.poradi));

  const zpet = await page.evaluate(() => {
    steTables = {}; steBrandOrder = [];
    applySyncSettings({ steTables: JSON.stringify({ adidas: { label: 'Adidas', rows: [['40', '25', '7']] } }), steBrandOrder: ['adidas'] });
    return { tabulky: Object.keys(steTables), poradi: steBrandOrder };
  });
  check('načtení obnoví proměnné v paměti, nejen localStorage',
    JSON.stringify(zpet.tabulky) === JSON.stringify(['adidas']) && JSON.stringify(zpet.poradi) === JSON.stringify(['adidas']),
    JSON.stringify(zpet));

  // ══════════════════════════════════════════════════════════════
  section('7) Wishlist se pořád chová správně');
  const wish = await page.evaluate(() => {
    wishItems = [];
    applySyncSettings({ wishlist: [{ id: 'w9', name: 'Z cloudu' }] });
    const poNacteni = { pocet: wishItems.length, jmeno: (wishItems[0] || {}).name };
    applySyncSettings({ wishlist: [] });
    return { poNacteni, poPrazdnem: wishItems.length };
  });
  check('wishlist z cloudu naplní i proměnnou v paměti',
    wish.poNacteni.pocet === 1 && wish.poNacteni.jmeno === 'Z cloudu', JSON.stringify(wish));
  check('prázdný wishlist z cloudu ten lokální nesmaže', wish.poPrazdnem === 1, JSON.stringify(wish));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
