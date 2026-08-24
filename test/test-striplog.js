// Test: jednorázový úklid zbytků po zrušených evidencích —
// přesunů mezi profily (profileLog) a data přijetí na sklad (homeDate)
const { chromium } = require('playwright');
const path = require('path');
let failures = 0;
function check(n,c,e){ console.log((c?'PASS':'FAIL')+' — '+n+(c||e===undefined?'':' | '+e)); if(!c) failures++; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  const SAVED_AT = '2026-07-01T10:00:00.000Z';
  await ctx.addInitScript((savedAt) => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      { id:'p1', name:'S evidencí přesunů', category:'sneakers', personal:true, buyPrice:4000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2023-09-15', tags:[], homeDate:'2026-01-15',
        profileLog:[{date:'2026-07-12', to:'personal'},{date:'2026-05-01', to:'business'}] },
      { id:'p2', name:'S prázdnou evidencí', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now()-1000, buyDate:'2026-06-01', tags:[], homeDate:'2026-02-20',
        profileLog:[] },
      { id:'p3', name:'Bez evidence', category:'sneakers', buyPrice:1000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now()-2000, buyDate:'2026-06-01', tags:[] },
    ]));
    localStorage.setItem('sklad_v3_savedAt', savedAt);
    localStorage.removeItem('sklad_v3_dirty');
  }, SAVED_AT);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(4000);

  // ── 1) Úklid při startu
  const st = await page.evaluate(() => {
    var stored = JSON.parse(localStorage.getItem('sklad_v3'));
    return {
      inMemory: items.map(i => 'profileLog' in i),
      inStorage: stored.map(i => 'profileLog' in i),
      hdMemory: items.map(i => 'homeDate' in i),
      hdStorage: stored.map(i => 'homeDate' in i),
      names: items.map(i => i.name),
      savedAt: localStorage.getItem('sklad_v3_savedAt'),
      dirty: localStorage.getItem('sklad_v3_dirty'),
    };
  });
  check('evidence odstraněna z paměti u všech položek', st.inMemory.every(v => v === false), JSON.stringify(st.inMemory));
  check('evidence odstraněna i z úložiště', st.inStorage.every(v => v === false), JSON.stringify(st.inStorage));
  check('datum přijetí odstraněno z paměti', st.hdMemory.every(v => v === false), JSON.stringify(st.hdMemory));
  check('datum přijetí odstraněno i z úložiště', st.hdStorage.every(v => v === false), JSON.stringify(st.hdStorage));
  check('položky samotné zůstaly (nic se nesmazalo navíc)', st.names.length === 3, JSON.stringify(st.names));
  check('savedAt se nezměnil', st.savedAt === '2026-07-01T10:00:00.000Z', st.savedAt);
  check('data nejsou označena jako rozpracovaná', st.dirty === null, String(st.dirty));

  // ── 2) Ostatní data položky jsou nedotčená
  const intact = await page.evaluate(() => {
    var it = items.find(x => x.id === 'p1');
    return { name: it.name, personal: !!it.personal, buy: it.buyPrice, loc: it.location, buyDate: it.buyDate };
  });
  check('ostatní pole položky beze změny', intact.name === 'S evidencí přesunů' && intact.personal === true && intact.buy === 4000 && intact.buyDate === '2023-09-15', JSON.stringify(intact));

  // ── 3) Úklid je idempotentní
  const again = await page.evaluate(() => stripProfileLogs() + stripHomeDates());
  check('opakovaný úklid už nic nemaže', again === 0, String(again));

  // ── 4) Data přicházející z cloudu se taky uklidí
  const cloud = await page.evaluate(() => {
    var ok = _applyCloudData({
      items: [{ id:'c1', name:'Z cloudu', category:'sneakers', buyPrice:500, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[],
        profileLog:[{date:'2026-01-01', to:'personal'}] }],
      savedAt: new Date().toISOString(),
    });
    return { ok, has: 'profileLog' in items.find(x => x.id==='c1') };
  });
  check('data z cloudu se uklidí taky', cloud.ok && !cloud.has, JSON.stringify(cloud));

  // ── 5) Uklizená verze se pošle do cloudu (payload už evidenci neobsahuje)
  const payload = await page.evaluate(() => {
    var p = _buildCloudPayload();
    return p.items.some(i => 'profileLog' in i);
  });
  check('odchozí data do cloudu už evidenci neobsahují', !payload, String(payload));

  // ── 6) Záloha do JSON taky bez evidence
  const backup = await page.evaluate(() => JSON.stringify(items).includes('profileLog'));
  check('položky neobsahují evidenci ani v exportu', !backup, String(backup));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0,3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
