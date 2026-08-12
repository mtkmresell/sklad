// Test: zmenšování fotek + synchronizace wishlistu
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await ctx.addInitScript(() => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      { id:'i1', name:'Fotka test', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] },
    ]));
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ══ ZMENŠOVÁNÍ FOTEK ══
  // Vyrobí barevný PNG o zadaném rozměru — jako fotka z mobilu (velká a nekomprimovaná)
  const big = await page.evaluate(() => {
    var cv = document.createElement('canvas');
    cv.width = 4032; cv.height = 3024;               // typické rozlišení mobilu
    var cx = cv.getContext('2d');
    var g = cx.createLinearGradient(0, 0, 4032, 3024);
    g.addColorStop(0, '#c8ff00'); g.addColorStop(0.5, '#204080'); g.addColorStop(1, '#ff4444');
    cx.fillStyle = g; cx.fillRect(0, 0, 4032, 3024);
    for (var i = 0; i < 400; i++) {                   // šum, ať to nejde zkomprimovat do nuly
      cx.fillStyle = 'rgba(' + (i*7%255) + ',' + (i*13%255) + ',' + (i*29%255) + ',0.6)';
      cx.fillRect((i*37)%4032, (i*53)%3024, 120, 90);
    }
    return cv.toDataURL('image/png');
  });
  check('testovací fotka je opravdu velká (>1 MB)', big.length > 1024*1024, Math.round(big.length/1024) + ' kB');

  const shrunk = await page.evaluate((src) => new Promise(res => {
    shrinkImage(src, function(out, w, h){ res({ out: out, w: w, h: h, len: out.length }); });
  }), big);
  check('fotka se zmenšila na max 1000 px', Math.max(shrunk.w, shrunk.h) === 1000, JSON.stringify({w:shrunk.w,h:shrunk.h}));
  check('poměr stran zůstal', Math.abs(shrunk.w/shrunk.h - 4032/3024) < 0.01, JSON.stringify({w:shrunk.w,h:shrunk.h}));
  check('výsledek je JPEG', /^data:image\/jpeg/.test(shrunk.out), shrunk.out.slice(0, 22));
  check('velikost klesla pod 400 kB', shrunk.len < 400*1024, Math.round(shrunk.len/1024) + ' kB');
  check('úspora je výrazná (>80 %)', shrunk.len < big.length * 0.2,
    Math.round(big.length/1024) + ' kB → ' + Math.round(shrunk.len/1024) + ' kB');

  // Malý obrázek se zbytečně nezvětší
  const small = await page.evaluate(() => {
    var cv = document.createElement('canvas'); cv.width = 80; cv.height = 60;
    var cx = cv.getContext('2d'); cx.fillStyle = '#123'; cx.fillRect(0,0,80,60);
    var src = cv.toDataURL('image/png');
    return new Promise(res => shrinkImage(src, function(out, w, h){ res({ srcLen: src.length, outLen: out.length, w: w, h: h }); }));
  });
  check('malý obrázek se nezvětšuje', small.w === 80 && small.h === 60 && small.outLen <= small.srcLen, JSON.stringify(small));

  // Cloudový dokument po uložení fotky zůstane pod limitem
  const doc = await page.evaluate((photo) => {
    items[0].imgUrl = photo;
    return { mb: +(new Blob([JSON.stringify(_buildCloudPayload())]).size / 1048576).toFixed(3) };
  }, shrunk.out);
  check('cloudový dokument s fotkou je pod limitem 1 MiB', doc.mb < 1, doc.mb + ' MB');

  // Průchod oknem Fotka položky (bez skutečného souboru — přes shrinkImage a uložení)
  const flow = await page.evaluate(async (photo) => {
    items[0].imgUrl = '';
    openImgModal('i1');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('imgPreview').dataset.pending = photo;
    saveImgUrl();
    await new Promise(r => setTimeout(r, 600));
    var it = items.find(x => x.id === 'i1');
    return { ulozeno: (it.imgUrl || '').slice(0, 22), delka: (it.imgUrl || '').length };
  }, shrunk.out);
  check('zmenšená fotka se uloží do položky', /^data:image\/jpeg/.test(flow.ulozeno) && flow.delka === shrunk.len, JSON.stringify(flow));

  // ══ SYNCHRONIZACE WISHLISTU ══
  const wish = await page.evaluate(() => {
    wishItems = [
      { id:'w1', name:'Panda Dunk', category:'sneakers', size:'42', priority:'high', targetPrice:5000 },
      { id:'w2', name:'Prismatic ETB', category:'pokemon', priority:'medium', targetPrice:2500 },
    ];
    saveWishlist();
    var p = _buildCloudPayload();
    return { vPayloadu: (p.wishlist || []).length, jmena: (p.wishlist || []).map(w => w.name) };
  });
  check('wishlist je v datech pro cloud', wish.vPayloadu === 2, JSON.stringify(wish));
  check('nese i podrobnosti přání', JSON.stringify(wish.jmena) === JSON.stringify(['Panda Dunk','Prismatic ETB']), JSON.stringify(wish.jmena));

  // Uložení spustí synchronizaci
  const sync = await page.evaluate(() => {
    window._fbUser = { uid:'test' };
    var calls = 0; var orig = window.fbSaveToCloud;
    window.fbSaveToCloud = function(){ calls++; };
    _svCloudTimer = null;
    wishItems.push({ id:'w3', name:'Nové přání', category:'lego', priority:'low' });
    saveWishlist();
    var timer = !!_svCloudTimer;
    return new Promise(res => setTimeout(function(){
      window.fbSaveToCloud = orig; window._fbUser = null;
      res({ timer: timer, calls: calls });
    }, 900));
  });
  check('uložení wishlistu spustí synchronizaci', sync.timer && sync.calls === 1, JSON.stringify(sync));

  // Data z cloudu se aplikují
  const applied = await page.evaluate(() => {
    wishItems = []; localStorage.removeItem('sklad_wishlist_v1');
    _applyCloudData({
      items: [{ id:'i1', name:'Fotka test', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] }],
      wishlist: [{ id:'wc1', name:'Z cloudu', category:'sneakers', priority:'high', targetPrice:9000 }],
      savedAt: new Date().toISOString(),
    });
    loadWishlist();
    return { pocet: wishItems.length, jmeno: (wishItems[0]||{}).name, vUlozisti: !!localStorage.getItem('sklad_wishlist_v1') };
  });
  check('wishlist z cloudu se načte', applied.pocet === 1 && applied.jmeno === 'Z cloudu' && applied.vUlozisti, JSON.stringify(applied));

  // Prázdný seznam z cloudu lokální nepřepíše
  const guard = await page.evaluate(() => {
    _applyCloudData({
      items: [{ id:'i1', name:'X', category:'sneakers', buyPrice:1, buyCurrency:'CZK', saleState:'stock',
        location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] }],
      wishlist: [], savedAt: new Date().toISOString(),
    });
    loadWishlist();
    return wishItems.length;
  });
  check('prázdný cloud wishlist lokální nesmaže', guard === 1, String(guard));

  // Wishlist je i v JSON záloze
  const backup = await page.evaluate(() => {
    var v = localStorage.getItem('sklad_wishlist_v1');
    return { vZaloze: v ? JSON.parse(v).length : 0 };
  });
  check('wishlist je v JSON záloze', backup.vZaloze === 1, JSON.stringify(backup));

  // Sekce Wishlist se pořád normálně vykreslí
  await page.evaluate(() => switchTab('wishlist'));
  await page.waitForTimeout(500);
  const render = await page.evaluate(() => ({
    karet: document.querySelectorAll('.wish-card').length,
    text: document.getElementById('itemsGrid').textContent.includes('Z cloudu'),
  }));
  check('sekce Wishlist se vykreslí', render.karet === 1 && render.text, JSON.stringify(render));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
