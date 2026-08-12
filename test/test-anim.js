// Test: doplněné animace (karty zákazníků/wishlistu, záložky detailu, statistiky, kontakty, koláč)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }

const D = '2026-06-05';
const SEED = [];
for (let i = 0; i < 12; i++) SEED.push({ id:'i'+i, name:'P'+i, category:['sneakers','pokemon','lego'][i%3],
  buyPrice:1000+i*100, buyCurrency:'CZK', saleState:i%2?'paid':'stock', location:i%2?undefined:'Doma',
  sellPrice:i%2?3000:undefined, profit:i%2?800:undefined, saleDate:i%2?D:undefined, payoutDate:i%2?D:undefined,
  soldWhere:i%2?'StockX':undefined, dateAdded:Date.now()-i*8.64e7, buyDate:'2026-06-01', tags:[] });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript((s) => { localStorage.setItem('sklad_v3', JSON.stringify(s)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const cid = await page.evaluate(() => {
    var id = _crmCreateMinimal('Anim Zákazník', 'b2c');
    var c = customers.find(x => x.id === id);
    c.contacts = [{type:'instagram', value:'a', primary:true},{type:'email', value:'b@c.cz'},{type:'telefon', value:'+420111222333'}];
    c.stats_orders_count = 3; c.stats_total_spent = 12000; c.stats_avg_order = 4000;
    for (var i = 0; i < 8; i++) _crmCreateMinimal('Další ' + i, 'b2c');
    switchTab('customers');
    return id;
  });
  await page.waitForTimeout(900);

  // ── 1) Karty zákazníků se odhalují stejně jako karty položek
  const cust = await page.evaluate(() => {
    var cards = [...document.querySelectorAll('.customer-card')];
    return {
      n: cards.length,
      allVisible: cards.every(c => c.classList.contains('card-visible')),
      maIdx: cards.every(c => c.dataset.cardIdx !== undefined),
      maCid: cards.every(c => !!c.dataset.cid),
      opacity: getComputedStyle(cards[0]).opacity,
      transition: getComputedStyle(cards[0]).transitionProperty,
    };
  });
  check('karty zákazníků se odhalí (card-visible)', cust.allVisible && cust.n > 5, JSON.stringify(cust));
  check('karty mají index i identifikátor', cust.maIdx && cust.maCid, JSON.stringify(cust));
  check('odhalení jede přes opacity jako u položek', cust.opacity === '1' && /opacity/.test(cust.transition), JSON.stringify(cust));

  // ── 2) Sdílená funkce se používá i pro položky
  await page.evaluate(() => { switchTab('stock'); stockViewMode = 'list'; viewMode = 'grid'; renderItems(); });
  await page.waitForTimeout(600);   // IntersectionObserver doběhne až po vykreslení
  const shared = await page.evaluate(() => {
    var cards = [...document.querySelectorAll('.item-card')];
    return { n: cards.length, visible: cards.filter(c => c.classList.contains('card-visible')).length, fn: typeof revealCards };
  });
  check('sdílená funkce revealCards existuje', shared.fn === 'function', shared.fn);
  check('karty položek se odhalují dál', shared.n === 0 || shared.visible === shared.n, JSON.stringify(shared));

  // ── 3) Wishlist karty mají třídu a odhalí se
  const wish = await page.evaluate(() => {
    wishItems = [
      { id:'w1', name:'Přání A', category:'sneakers', priority:'high', targetPrice:5000 },
      { id:'w2', name:'Přání B', category:'pokemon', priority:'low', targetPrice:2000 },
    ];
    try { saveWishlist(); } catch(e) {}
    switchTab('wishlist');
    var cards = [...document.querySelectorAll('.wish-card')];
    return { n: cards.length, visible: cards.filter(c => c.classList.contains('card-visible')).length };
  });
  await page.waitForTimeout(400);
  const wish2 = await page.evaluate(() => {
    var cards = [...document.querySelectorAll('.wish-card')];
    return { n: cards.length, visible: cards.filter(c => c.classList.contains('card-visible')).length };
  });
  check('wishlist karty mají třídu wish-card', wish2.n >= 2, JSON.stringify([wish, wish2]));
  check('wishlist karty se odhalí', wish2.visible === wish2.n, JSON.stringify(wish2));

  // ── 4) Záložky detailu zákazníka se prolínají
  await page.evaluate((id) => { switchTab('customers'); openCustomerDetail(id); }, cid);
  await page.waitForTimeout(500);
  const tabAnim = await page.evaluate(async () => {
    var el = document.getElementById('crmDetailContent');
    var out = [];
    for (const t of ['contacts','prefs','overview']) {
      crmDetailTab(t);
      out.push({ tab: t, cls: el.classList.contains('tab-content-anim'), anim: getComputedStyle(el).animationName });
      await new Promise(r => setTimeout(r, 260));
    }
    return out;
  });
  check('obsah záložky se prolne při každém přepnutí', tabAnim.every(t => t.cls && t.anim === 'tabFade'), JSON.stringify(tabAnim));

  // ── 5) Dlaždice statistik se vysouvají se zpožděním
  const stats = await page.evaluate(() => {
    crmDetailTab('overview');
    var tiles = [...document.querySelectorAll('.crm-stat')];
    return {
      n: tiles.length,
      anim: tiles.length ? getComputedStyle(tiles[0]).animationName : null,
      delays: tiles.map(t => getComputedStyle(t).animationDelay),
    };
  });
  check('statistiky v detailu mají animaci statIn', stats.n === 6 && stats.anim === 'statIn', JSON.stringify(stats));
  check('dlaždice se vysouvají postupně', JSON.stringify(stats.delays) === JSON.stringify(['0s','0.05s','0.1s','0.15s','0.2s','0.25s']), JSON.stringify(stats.delays));

  // ── 6) Řádky kontaktů najíždějí postupně
  const contacts = await page.evaluate(() => {
    crmDetailTab('contacts');
    var rows = [...document.querySelectorAll('.crm-contact-row')];
    return { n: rows.length, anim: rows.length ? getComputedStyle(rows[0]).animationName : null, delays: rows.map(r => getComputedStyle(r).animationDelay) };
  });
  check('řádky kontaktů mají animaci rowIn', contacts.n === 3 && contacts.anim === 'rowIn', JSON.stringify(contacts));
  check('kontakty najíždějí postupně', JSON.stringify(contacts.delays) === JSON.stringify(['0s','0.02s','0.04s']), JSON.stringify(contacts.delays));
  await page.evaluate(() => closeCustomerDetail());

  // ── 7) Koláčový graf: platný keySplines (dřív padal do konzole)
  await page.evaluate(() => { switchTab('stock'); stockViewMode = 'analytics'; renderItems(); });
  await page.waitForTimeout(1200);
  const pie = await page.evaluate(() => {
    var a = [...document.querySelectorAll('animateTransform')];
    return a.map(el => ({ ks: el.getAttribute('keySplines'), kt: el.getAttribute('keyTimes'), v: el.getAttribute('values') }));
  });
  const validKs = pie.every(p => (p.ks || '').split(';').every(seg => seg.trim().split(/\s+/).every(n => { const f = parseFloat(n); return f >= 0 && f <= 1; })));
  check('keySplines je v povoleném rozsahu 0–1', pie.length > 0 && validKs, JSON.stringify(pie.slice(0, 2)));
  check('přestřel je zachovaný přes hodnoty', pie.every(p => /1\.06/.test(p.v || '')), JSON.stringify(pie.slice(0, 1)));
  check('žádná SVG chyba v konzoli', !errs.some(e => /keySplines/.test(e)), JSON.stringify(errs.filter(e => /keySplines/.test(e))));

  // ── 8) Mazání karty zákazníka nejdřív odjede
  await page.evaluate(() => switchTab('customers'));
  await page.waitForTimeout(400);
  const del = await page.evaluate(async () => {
    var card = document.querySelector('.customer-card[data-cid]');
    var id = card.dataset.cid;
    deleteCustomer(id);
    await new Promise(r => setTimeout(r, 250));
    var btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Smazat' && b.closest('[style*="fixed"]'));
    btns[btns.length - 1].click();
    await new Promise(r => setTimeout(r, 120));
    var still = document.querySelector('.customer-card[data-cid="' + id + '"]');
    var animating = still && still.classList.contains('deleting');
    await new Promise(r => setTimeout(r, 500));
    return { animating, gone: !customers.some(c => c.id === id) };
  });
  check('karta při mazání odjede (deleting)', del.animating, JSON.stringify(del));
  check('po animaci je zákazník smazaný', del.gone, JSON.stringify(del));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
