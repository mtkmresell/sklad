// Test: odkaz na obrázek s parametry se zkrátí jen tehdy, když zkrácená verze funguje
const http = require('http');
const { chromium } = require('playwright');
const path = require('path');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const hasParams = [...u.searchParams.keys()].length > 0;
  if (u.pathname === '/needs-params.jpg') {           // bez parametrů neexistuje
    if (!hasParams) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG);
  }
  if (u.pathname === '/works.jpg') {                   // funguje tak i tak
    res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG);
  }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const BASE = `http://localhost:${port}`;
  const BROKEN = `${BASE}/needs-params.jpg?fit=fill&w=140&h=75&updated_at=1746650613`;
  const OK = `${BASE}/works.jpg?fit=fill&w=140&h=75&updated_at=1746650072`;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      { id:'a', name:'Položka A', category:'pokemon', buyPrice:1000, buyCurrency:'CZK', saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] },
      { id:'b', name:'Položka B', category:'pokemon', buyPrice:1000, buyCurrency:'CZK', saleState:'stock', location:'Doma', dateAdded:Date.now()-1, buyDate:'2026-06-01', tags:[] },
    ]));
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  async function saveViaPhotoModal(id, url) {
    return page.evaluate(async (a) => {
      openImgModal(a.id);
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('imgUrlInput').value = a.url;
      previewImgUrl(a.url);
      await new Promise(r => setTimeout(r, 500));
      saveImgUrl();
      await new Promise(r => setTimeout(r, 1500));
      var stored = items.find(x => x.id === a.id).imgUrl;
      var loads = await new Promise(function(res){
        var im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = stored;
      });
      return { stored, loads };
    }, { id, url });
  }

  // ── 1) Odkaz, jehož zkrácená verze neexistuje → uloží se s parametry a načte se
  const broken = await saveViaPhotoModal('a', BROKEN);
  check('problémový odkaz se uloží i s parametry', broken.stored === BROKEN, broken.stored);
  check('problémový obrázek se po uložení načte', broken.loads, JSON.stringify(broken));

  // ── 2) Odkaz, jehož zkrácená verze funguje → zkrátí se (plná velikost)
  const ok = await saveViaPhotoModal('b', OK);
  check('funkční odkaz se zkrátí na plnou velikost', ok.stored === `${BASE}/works.jpg`, ok.stored);
  check('zkrácený obrázek se načte', ok.loads, JSON.stringify(ok));

  // ── 3) Pole v Upravit: problémový odkaz zůstane celý, funkční se zkrátí
  const field = await page.evaluate(async (u) => {
    async function typeInto(val) {
      openEdit('a');
      await new Promise(r => setTimeout(r, 500));
      var f = document.getElementById('fImgUrl');
      f.value = val; f.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 2000));
      return f.value;
    }
    return { broken: await typeInto(u.BROKEN), ok: await typeInto(u.OK) };
  }, { BROKEN, OK });
  check('Upravit: problémový odkaz zůstane celý', field.broken === BROKEN, field.broken);
  check('Upravit: funkční odkaz se zkrátí', field.ok === `${BASE}/works.jpg`, field.ok);

  // ── 4) Uložení položky pole nepřepíše zpět
  const afterSave = await page.evaluate(async (u) => {
    openEdit('a');
    await new Promise(r => setTimeout(r, 500));
    var f = document.getElementById('fImgUrl');
    f.value = u; f.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 2000));
    saveItem();
    await new Promise(r => setTimeout(r, 1500));
    return items.find(x => x.id === 'a').imgUrl;
  }, BROKEN);
  check('uložení položky odkaz neořízne', afterSave === BROKEN, afterSave);

  // ── 5) Nahraná fotka (data:) se nijak neupravuje
  const dataUrl = await page.evaluate(async () => {
    var d = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    openImgModal('b');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('imgPreview').dataset.pending = d;
    saveImgUrl();
    await new Promise(r => setTimeout(r, 600));
    return items.find(x => x.id === 'b').imgUrl === d;
  });
  check('nahraná fotka se neupravuje', dataUrl, String(dataUrl));

  // ── 6) Odkaz bez parametrů projde beze změny
  const noParams = await page.evaluate(async (u) => {
    return new Promise(function(res){ resolveImgUrl(u, res); });
  }, `${BASE}/works.jpg`);
  check('odkaz bez parametrů zůstane beze změny', noParams === `${BASE}/works.jpg`, noParams);

  // ── 7) Prázdný vstup nic nerozbije
  const empty = await page.evaluate(() => new Promise(function(res){ resolveImgUrl('', res); }));
  check('prázdný odkaz nespadne', empty === '', JSON.stringify(empty));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
