// Test: vlastní fotky se ukládají mimo hlavní dokument
const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const D = 'users/u1/sklad/';
const SEED = [];
for (let i = 0; i < 5; i++) SEED.push({ id: 's' + i, name: 'Sklad ' + i, category: 'sneakers', buyPrice: 2000,
  buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: 100 + i, buyDate: '2026-01-05', tags: [],
  imgUrl: 'https://images.stockx.com/odkaz-' + i + '.jpg' });
SEED.push({ id: 'p1', name: 'Prodáno', category: 'sneakers', buyPrice: 3000, buyCurrency: 'CZK',
  saleState: 'paid', sellPrice: 5000, profit: 1500, saleDate: '2025-11-01', payoutDate: '2025-12-01',
  soldWhere: 'StockX', dateAdded: 200, buyDate: '2025-06-01', tags: [] });

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
  // Mechanika zápisu, ne souběh zařízení — ochranu „ještě jsem neviděl cloud“
  // testuje test-zarizeni.js
  await page.evaluate(() => window.__cloudUzVideny());

  // Vyrobí zmenšenou fotku přesně tak, jak to dělá aplikace
  const fotka = await page.evaluate(() => new Promise(res => {
    const cv = document.createElement('canvas');
    cv.width = 2000; cv.height = 1500;
    const cx = cv.getContext('2d');
    const g = cx.createLinearGradient(0, 0, 2000, 1500);
    g.addColorStop(0, '#c8ff00'); g.addColorStop(1, '#204080');
    cx.fillStyle = g; cx.fillRect(0, 0, 2000, 1500);
    for (let i = 0; i < 300; i++) {
      cx.fillStyle = 'rgba(' + (i * 7 % 255) + ',' + (i * 29 % 255) + ',80,0.6)';
      cx.fillRect((i * 37) % 2000, (i * 53) % 1500, 90, 70);
    }
    shrinkImage(cv.toDataURL('image/png'), (out) => res(out));
  }));
  const druha = fotka.replace(/.$/, 'A');   // jiná fotka pro test změny

  const store = () => page.evaluate(() => Object.keys(window.__store).sort());
  const main = () => page.evaluate(() => window.__doc('data'));
  async function save() {
    const p = await page.evaluate(() => window.__commits);
    await page.evaluate(() => fbSaveToCloud());
    await page.waitForFunction((b) => window.__commits > b, p, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);
  }

  // ══════════════════════════════════════════════════════════════
  section('1) Fotka jde do vlastního dokumentu');
  await page.evaluate((f) => { items.find(i => i.id === 's0').imgUrl = f; }, fotka);
  await save();
  const dok = await store();
  const m1 = await main();
  check('vznikl dokument photo_s0', dok.includes(D + 'photo_s0'), JSON.stringify(dok));
  check('v hlavním dokumentu fotka není',
    !JSON.stringify(m1.itemsStock).includes('data:image'), 'délka ' + JSON.stringify(m1.itemsStock).length);
  check('položka nese jen značku hasPhoto',
    m1.itemsStock.find(i => i.id === 's0').hasPhoto === 1 && !m1.itemsStock.find(i => i.id === 's0').imgUrl,
    JSON.stringify(m1.itemsStock.find(i => i.id === 's0')));
  check('odkazované obrázky zůstávají v položce',
    m1.itemsStock.find(i => i.id === 's1').imgUrl.startsWith('https://'), m1.itemsStock.find(i => i.id === 's1').imgUrl);

  const velikost = await page.evaluate(() => ({
    hlavni: new Blob([JSON.stringify(window.__doc('data'))]).size,
    fotka: new Blob([JSON.stringify(window.__doc('photo_s0'))]).size,
  }));
  check('hlavní dokument zůstal malý', velikost.hlavni < 20000,
    Math.round(velikost.hlavni / 1024) + ' kB, fotka zvlášť ' + Math.round(velikost.fotka / 1024) + ' kB');

  // ══════════════════════════════════════════════════════════════
  section('2) Načtení fotku vrátí do položky');
  const nacteni = await page.evaluate(() => {
    items = []; window.__resetDevice();
    const r = window.__load();
    const it = items.find(i => i.id === 's0');
    return { pocet: r.pocet, maFotku: (it.imgUrl || '').startsWith('data:image'), znacka: it.hasPhoto,
      delka: (it.imgUrl || '').length };
  });
  check('položek je pořád 6', nacteni.pocet === 6, String(nacteni.pocet));
  check('fotka je zpátky v položce', nacteni.maFotku, JSON.stringify(nacteni));
  check('značka hasPhoto se po navrácení uklidí', nacteni.znacka === undefined, String(nacteni.znacka));
  check('fotka dorazila celá', nacteni.delka === fotka.length, nacteni.delka + ' vs ' + fotka.length);

  // ══════════════════════════════════════════════════════════════
  section('3) Zapisuje se jen změněná fotka');
  await page.evaluate(() => { items.find(i => i.id === 's1').buyPrice = 4242; });
  await save();
  const davka1 = await page.evaluate(() => window.__lastBatch);
  check('úprava jiné položky fotku nepřepisuje',
    !davka1.some(o => /photo_/.test(o)), JSON.stringify(davka1));

  await page.evaluate((f) => { items.find(i => i.id === 's2').imgUrl = f; }, druha);
  await save();
  const davka2 = await page.evaluate(() => window.__lastBatch);
  check('nová fotka se zapíše, stará ne',
    davka2.includes('set ' + D + 'photo_s2') && !davka2.includes('set ' + D + 'photo_s0'), JSON.stringify(davka2));

  // ══════════════════════════════════════════════════════════════
  section('4) Odebrání fotky smaže i dokument');
  await page.evaluate(() => { items.find(i => i.id === 's2').imgUrl = ''; });
  await save();
  check('dokument fotky zmizel', !(await store()).includes(D + 'photo_s2'), JSON.stringify(await store()));
  check('mazání proběhlo v dávce',
    (await page.evaluate(() => window.__lastBatch)).includes('del ' + D + 'photo_s2'),
    JSON.stringify(await page.evaluate(() => window.__lastBatch)));

  // Smazání celé položky vezme fotku s sebou
  await page.evaluate(() => { items = items.filter(i => i.id !== 's0'); });
  await save();
  check('smazání položky smaže i její fotku', !(await store()).includes(D + 'photo_s0'), JSON.stringify(await store()));

  // ══════════════════════════════════════════════════════════════
  section('5) Fotka u prodané položky (jde do archivu)');
  await page.evaluate((f) => { items.find(i => i.id === 'p1').imgUrl = f; }, fotka);
  await save();
  const arch = await page.evaluate(() => window.__doc('sold_2025'));
  check('archiv fotku neobsahuje', !JSON.stringify(arch).includes('data:image'), 'délka ' + JSON.stringify(arch).length);
  check('fotka prodané položky má vlastní dokument', (await store()).includes(D + 'photo_p1'), JSON.stringify(await store()));
  const zpetArch = await page.evaluate(() => {
    items = []; window.__resetDevice();
    window.__load();
    const it = items.find(i => i.id === 'p1');
    return { maFotku: (it.imgUrl || '').startsWith('data:image'), stav: it.saleState };
  });
  check('po načtení má prodaná položka fotku zpátky', zpetArch.maFotku && zpetArch.stav === 'paid', JSON.stringify(zpetArch));

  // ══════════════════════════════════════════════════════════════
  section('6) Chybějící fotka o data nepřipraví');
  const chybejici = await page.evaluate(() => {
    const zaloha = window.__store['users/u1/sklad/photo_p1'];
    delete window.__store['users/u1/sklad/photo_p1'];
    items = []; window.__resetDevice();
    const r = window.__load();
    const it = items.find(i => i.id === 'p1');
    return { pocet: r.pocet, neuplne: r.neuplne, znacka: it.hasPhoto, obrazek: it.imgUrl || '', zaloha: !!zaloha };
  });
  check('chybějící fotka nezablokuje načtení', chybejici.pocet === 5 && !chybejici.neuplne, JSON.stringify(chybejici));
  check('značka zůstane, ať se fotka nesmaže', chybejici.znacka === 1, JSON.stringify(chybejici));

  const nesmazano = await page.evaluate(() => new Promise(res => {
    // Uložení v tomhle stavu nesmí fotku smazat z cloudu
    items.find(i => i.id === 's1').buyPrice = 777;
    fbSaveToCloud();
    setTimeout(() => res({ davka: window.__lastBatch.slice() }), 500);
  }));
  check('uložení fotku bez dat nesmaže',
    !nesmazano.davka.some(o => /photo_p1/.test(o)), JSON.stringify(nesmazano.davka));

  // ══════════════════════════════════════════════════════════════
  section('7) Starý dokument s fotkou uvnitř');
  const stary = await page.evaluate((f) => {
    // Jako by to zapsala verze aplikace před rozdělením fotek
    window.__store['users/u1/sklad/data'] = {
      items: [{ id: 'x1', name: 'Stará s fotkou', category: 'sneakers', buyPrice: 100, buyCurrency: 'CZK',
        saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [], imgUrl: f }],
      savedAt: '2026-08-01T10:00:00.000Z',
    };
    Object.keys(window.__store).forEach(k => { if (/photo_|sold_/.test(k)) delete window.__store[k]; });
    items = []; window.__resetDevice();
    const r = window.__load();
    return { pocet: r.pocet, maFotku: (items[0].imgUrl || '').startsWith('data:image') };
  }, fotka);
  check('starý formát s fotkou uvnitř se načte', stary.pocet === 1 && stary.maFotku, JSON.stringify(stary));

  await save();
  const poPrevodu = await page.evaluate(() => ({
    dokumenty: Object.keys(window.__store).sort(),
    vHlavnim: JSON.stringify(window.__doc('data')).includes('data:image'),
  }));
  check('první uložení fotku přesune do vlastního dokumentu',
    poPrevodu.dokumenty.includes(D + 'photo_x1') && !poPrevodu.vHlavnim, JSON.stringify(poPrevodu));

  // ══════════════════════════════════════════════════════════════
  section('8) Lokální data a záloha se nemění');
  const lokalne = await page.evaluate(() => {
    const ulozene = JSON.parse(localStorage.getItem('sklad_v3') || '[]');
    return { maFotku: (ulozene[0] || {}).imgUrl ? ulozene[0].imgUrl.startsWith('data:image') : false,
      bezZnacky: (ulozene[0] || {}).hasPhoto === undefined };
  });
  check('v localStorage zůstává fotka v položce jako dřív', lokalne.maFotku, JSON.stringify(lokalne));
  check('a bez pomocné značky', lokalne.bezZnacky, JSON.stringify(lokalne));

  // ══════════════════════════════════════════════════════════════
  section('9) Kolik fotek se teď vejde');
  const kapacita = await page.evaluate((f) => {
    const zaloha = items.slice();
    items = [];
    for (let i = 0; i < 200; i++) items.push({ id: 'f' + i, name: 'Foto ' + i, category: 'sneakers',
      buyPrice: 1000, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: i,
      buyDate: '2026-01-01', tags: [], imgUrl: f });
    const hlavni = new Blob([JSON.stringify(_buildCloudPayload())]).size;
    items = zaloha;
    return { hlavni: hlavni, limit: 1048576, fotka: f.length };
  }, fotka);
  check('200 vlastních fotek a hlavní dokument je pořád malý',
    kapacita.hlavni < kapacita.limit * 0.2,
    Math.round(kapacita.hlavni / 1024) + ' kB = ' + (kapacita.hlavni / kapacita.limit * 100).toFixed(1) + ' % limitu');

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
