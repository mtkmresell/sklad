// Test: historie cen u položky
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DNES = new Date().toISOString().slice(0, 10);
const SEED = [{ id: 'i1', name: 'Nike Dunk Low Panda', category: 'sneakers', sku: 'DD1391-100',
  buyPrice: 3000, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma',
  dateAdded: Date.now(), buyDate: '2026-05-01', tags: [], targetPrice: 6500 }];

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

  const log = () => page.evaluate(() => (items.find(i => i.id === 'i1') || {}).priceLog || []);

  // ══════════════════════════════════════════════════════════════
  section('1) Zápis ceny');
  let z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    return { a: logPrice(it, 6500, 'CZK', null, false), delka: it.priceLog.length, zaznam: it.priceLog[0] };
  });
  check('první cena se zapíše', z.a && z.delka === 1, JSON.stringify(z));
  check('záznam nese datum a částku', z.zaznam.p === 6500 && z.zaznam.d === DNES, JSON.stringify(z.zaznam));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    return { a: logPrice(it, 6500, 'CZK', null, false), delka: it.priceLog.length };
  });
  check('stejná cena se nezapisuje podruhé', !z.a && z.delka === 1, JSON.stringify(z));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    logPrice(it, 5900, 'CZK', null, false);
    return { delka: it.priceLog.length, ceny: it.priceLog.map(x => x.p) };
  });
  check('změněná cena přibude', z.delka === 2 && JSON.stringify(z.ceny) === JSON.stringify([6500, 5900]), JSON.stringify(z));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    logPrice(it, 5250, 'EUR', 210, false);
    return it.priceLog[it.priceLog.length - 1];
  });
  check('u eurové ceny se pamatuje i původní částka', z.e === 210 && z.p === 5250, JSON.stringify(z));

  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    return { nula: logPrice(it, 0, 'CZK', null, false), zaporna: logPrice(it, -100, 'CZK', null, false),
      prazdna: logPrice(it, null, 'CZK', null, false), delka: it.priceLog.length };
  });
  check('nulová ani záporná cena se nezapíše', !z.nula && !z.zaporna && !z.prazdna && z.delka === 3, JSON.stringify(z));

  // ══════════════════════════════════════════════════════════════
  section('2) Strop délky');
  z = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    for (let i = 0; i < 40; i++) logPrice(it, 1000 + i, 'CZK', null, false);
    return { delka: it.priceLog.length, prvni: it.priceLog[0].p, posledni: it.priceLog[it.priceLog.length - 1].p };
  });
  check('drží se nejvýš 20 záznamů', z.delka === 20, String(z.delka));
  check('ořezávají se ty nejstarší', z.posledni === 1039, JSON.stringify(z));

  // ══════════════════════════════════════════════════════════════
  section('3) Souhrn a text');
  const sum = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    it.priceLog = [{ d: '2026-05-01', p: 6500 }, { d: '2026-06-01', p: 5900 }, { d: '2026-07-01', p: 5200, s: 1 }];
    const s = priceLogSummary(it);
    const div = document.createElement('div'); div.innerHTML = priceLogHtml(it);
    return { zmen: s.zmen, prvni: s.prvni.p, prodej: s.prodej.p, rozdil: Math.round(s.rozdil),
      procent: Math.round(s.procent), text: div.textContent.replace(/\s+/g, ' ').trim() };
  });
  check('souhrn najde první i prodejní cenu', sum.prvni === 6500 && sum.prodej === 5200, JSON.stringify(sum));
  check('spočítá rozdíl i procenta', sum.rozdil === -1300 && sum.procent === -20, JSON.stringify(sum));
  check('text ukáže posloupnost', /6 500.*5 900.*5 200/.test(sum.text.replace(/[  ]/g, ' ')), sum.text);
  check('a kolik se slevilo', /Sleveno o/.test(sum.text) && /20 %/.test(sum.text), sum.text);

  const jedna = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    it.priceLog = [{ d: '2026-05-01', p: 6500 }];
    return { html: priceLogHtml(it) };
  });
  check('u jediné ceny se nic nezobrazuje', jedna.html === '', jedna.html);

  const nahoru = await page.evaluate(() => {
    const it = items.find(i => i.id === 'i1');
    it.priceLog = [{ d: '2026-05-01', p: 5000 }, { d: '2026-06-01', p: 6000 }];
    const div = document.createElement('div'); div.innerHTML = priceLogHtml(it);
    return div.textContent.replace(/\s+/g, ' ').trim();
  });
  check('zdražení se hlásí jako zdražení', /Zdraženo o/.test(nahoru), nahoru);

  // ══════════════════════════════════════════════════════════════
  section('4) Zápis přes skutečné uložení položky');
  await page.evaluate(() => {
    items = [{ id: 'i1', name: 'Nike Dunk Low Panda', category: 'sneakers', sku: 'DD1391-100',
      buyPrice: 3000, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma',
      dateAdded: Date.now(), buyDate: '2026-05-01', tags: [], targetPrice: 6500 }];
    sv(); renderItems();
  });
  async function uprav(cena) {
    await page.evaluate(async (c) => {
      openEdit('i1');
      await new Promise(r => setTimeout(r, 250));
      document.getElementById('fTargetPrice').value = String(c);
      await saveItem();
    }, cena);
    await page.waitForTimeout(500);
  }
  await uprav(6500);
  check('první uložení zapíše cílovou cenu', (await log()).length === 1, JSON.stringify(await log()));
  await uprav(5900);
  let l = await log();
  check('snížení ceny přibude do historie', l.length === 2 && l[1].p === 5900, JSON.stringify(l));
  await uprav(5900);
  check('uložení beze změny ceny nic nepřidá', (await log()).length === 2, JSON.stringify(await log()));

  // ══════════════════════════════════════════════════════════════
  section('5) Prodej uzavře vývoj');
  await page.evaluate(async () => {
    openSellModal('i1');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('sSellPrice').value = '5200';
    const sd = document.getElementById('sSaleDate'); if (sd && !sd.value) sd.value = '2026-08-01';
    await saveSell();
  });
  await page.waitForTimeout(900);
  l = await log();
  check('prodejní cena se zapíše se značkou prodeje',
    l.length === 3 && l[2].p === 5200 && l[2].s === 1, JSON.stringify(l));

  /* Po prodeji je kus v **Čeká**, ne v Prodáno — a tam vývoj ceny být
     nemá. U neprodaného kusu je to jen připomínka, že už jsi šel dolů;
     rozhodnutí to neovlivní a v detailu zabíralo dva řádky. Majitel si
     to takhle vyžádal. Zapisuje se dál, jen se nezobrazuje. */
  const vCeka = await page.evaluate(async () => {
    openDetail('i1');
    await new Promise(r => setTimeout(r, 400));
    const mo = document.getElementById('moDetail');
    const text = mo ? mo.textContent.replace(/\s+/g, ' ') : '';
    cm('moDetail');
    return text;
  });
  check('v Čeká se vývoj ceny neukazuje', !/Vývoj ceny/.test(vCeka), vCeka.slice(0, 220));
  check('a sekce se tam jmenuje Zásilka, ne Sklad',
    /Zásilka/.test(vCeka) && !/PoložkaSklad|NákupSklad/.test(vCeka), vCeka.slice(0, 220));

  // Teprve v Prodáno má smysl — tam se majitel dívá zpětně
  const vProdano = await page.evaluate(async () => {
    changeWaitState('i1', 'completed');
    await new Promise(r => setTimeout(r, 300));
    openDetail('i1');
    await new Promise(r => setTimeout(r, 400));
    const mo = document.getElementById('moDetail');
    const text = mo ? mo.textContent.replace(/\s+/g, ' ') : '';
    cm('moDetail');
    return text;
  });
  check('v Prodáno vývoj ceny je',
    /Vývoj ceny/.test(vProdano) && /Sleveno o/.test(vProdano), vProdano.slice(0, 260));

  /* Pořadí řádků si majitel vyžádal výslovně: profil rozhoduje o dokladu
     i o tom, kam se kus počítá, takže patří nahoru. */
  check('profil stojí nad typem',
    vProdano.indexOf('Profil') !== -1 && vProdano.indexOf('Profil') < vProdano.indexOf('Typ'),
    vProdano.slice(0, 160));
  // Zisk a vývoj ceny jsou obojí o penězích a čtou se spolu
  check('vývoj ceny stojí hned pod ziskem',
    vProdano.indexOf('Zisk') < vProdano.indexOf('Vývoj ceny')
      && vProdano.indexOf('Vývoj ceny') < vProdano.indexOf('Datum prodeje'),
    vProdano.slice(0, 300));

  /* Zisk je jediné číslo, kvůli kterému se sem člověk dívá — ať je hned
     poznat, jestli je v plusu. */
  const barvaZisku = await page.evaluate(async () => {
    openDetail('i1');
    await new Promise(r => setTimeout(r, 400));
    const bunky = [...document.querySelectorAll('#moDetail td')];
    const popisek = bunky.find(td => td.textContent.trim() === 'Zisk');
    const hodnota = popisek && popisek.nextElementSibling;
    const span = hodnota && hodnota.querySelector('span[style*="color"]');
    const out = { text: hodnota ? hodnota.textContent.trim() : null,
      barva: span ? span.getAttribute('style') : null };
    cm('moDetail');
    return out;
  });
  check('zisk je barevně zvýrazněný', !!barvaZisku.barva, JSON.stringify(barvaZisku));
  check('a v plusu je zelený', /--accent/.test(barvaZisku.barva || ''),
    JSON.stringify(barvaZisku));

  // Ztráta musí být poznat taky — a jinou barvou
  const ztrata = await page.evaluate(async () => {
    const it = items.find(i => i.id === 'i1');
    /* Uložený zisk má přednost před dopočítaným (viz `_itemProfit`),
       takže nestačí srazit prodejní cenu — musí se přepsat i on. */
    it.sellPrice = 100; it.profit = -900;
    openDetail('i1');
    await new Promise(r => setTimeout(r, 400));
    const bunky = [...document.querySelectorAll('#moDetail td')];
    const popisek = bunky.find(td => td.textContent.trim() === 'Zisk');
    const span = popisek && popisek.nextElementSibling
      && popisek.nextElementSibling.querySelector('span[style*="color"]');
    const out = { text: popisek ? popisek.nextElementSibling.textContent.trim() : null,
      barva: span ? span.getAttribute('style') : null };
    it.sellPrice = 5200; delete it.profit;
    cm('moDetail');
    return out;
  });
  check('a ztráta červená', /--danger/.test(ztrata.barva || ''), JSON.stringify(ztrata));

  /* Rozdíl v procentech nesmí zmizet, ani když je prodej v logu první —
     to nastane, když se kus prodá a cílovka se doplní až potom. Dřív
     vyšlo „konec === prvni" a v detailu zbyla jen šipka mezi čísly. */
  const sProdejemPrvnim = await page.evaluate(async () => {
    const it = items.find(i => i.id === 'i1');
    const zaloha = it.priceLog;
    it.priceLog = [{ p: 4985, d: '2026-09-16', s: 1 }, { p: 5200, d: '2026-09-17' }];
    openDetail('i1');
    await new Promise(r => setTimeout(r, 400));
    const mo = document.getElementById('moDetail');
    const text = mo ? mo.textContent.replace(/\s+/g, ' ') : '';
    it.priceLog = zaloha;
    cm('moDetail');
    return text;
  });
  check('rozdíl se ukáže i s prodejem na prvním místě',
    /Zdraženo o/.test(sProdejemPrvnim) && /%/.test(sProdejemPrvnim),
    sProdejemPrvnim.slice(0, 300));
  check('a netvrdí se „oproti první cílové ceně", když první byl prodej',
    !/oproti první cílové ceně/.test(sProdejemPrvnim), sProdejemPrvnim.slice(0, 300));

  // ══════════════════════════════════════════════════════════════
  section('6) Historie jde do cloudu a přežije kolečko');
  const cloud = await page.evaluate(() => {
    const p = _buildCloudPayload();
    const vse = (p.itemsStock || []).concat(...(p.archiveYears || []).map(() => []));
    const it = (p.itemsStock || []).find(i => i.id === 'i1');
    return { vHlavnim: !!it, log: it ? it.priceLog : null,
      velikost: new Blob([JSON.stringify((items[0] || {}).priceLog || [])]).size };
  });
  check('historie je součástí položky v cloudu',
    !cloud.vHlavnim || (cloud.log && cloud.log.length === 3), JSON.stringify(cloud.log));
  check('tři záznamy zaberou pár desítek bajtů', cloud.velikost < 200, cloud.velikost + ' B');

  // ══════════════════════════════════════════════════════════════
  section('7) Detail kusu na skladě');
  /* Sekce se čtou z DOMu, ne z textu — nadpis „Sklad" by se v jednom
     dlouhém řetězci pletl s „Na skladě". */
  const sekce = (dnuNazpet) => page.evaluate(async (dnu) => {
    const it = items.find(i => i.id === 's1') || (items.push({
      id: 's1', name: 'Kus na skladě', category: 'sneakers', buyPrice: 2000,
      buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: Date.now(),
      condition: 'DS', targetPrice: 5000, stockIntent: 'flip', tags: [],
    }), items[items.length - 1]);
    const d = new Date(Date.now() - dnu * 86400000);
    it.buyDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
    openDetail('s1');
    await new Promise(r => setTimeout(r, 400));
    const mo = document.getElementById('moDetail');
    const out = [...mo.querySelectorAll('table')].map(t => ({
      nadpis: t.previousElementSibling ? t.previousElementSibling.textContent.trim() : '',
      radky: [...t.querySelectorAll('tr')].map(tr => ({
        k: tr.cells[0].textContent.trim(), v: tr.cells[1].textContent.trim() })),
    }));
    cm('moDetail');
    return out;
  }, dnuNazpet);

  const najdi = (sekce, nadpis) => sekce.find(x => x.nadpis === nadpis);
  const klice = (s) => (s ? s.radky.map(r => r.k) : []);

  let s3 = await sekce(3);
  const vSkladu = najdi(s3, 'Sklad');
  check('sekce Sklad existuje', !!vSkladu, JSON.stringify(s3.map(x => x.nadpis)));
  /* **Stav zboží (DS, použité, poškozené) zůstává v Položce.** Je to
     vlastnost samotného kusu, ne skladu; jednou se omylem přesunul pod
     Sklad a majitel ho hned vrátil zpátky. */
  check('Stav zboží zůstává v Položce',
    klice(najdi(s3, 'Položka')).indexOf('Stav') !== -1,
    JSON.stringify(klice(najdi(s3, 'Položka'))));
  check('a ve Skladu není', klice(vSkladu).indexOf('Stav') === -1,
    JSON.stringify(klice(vSkladu)));
  /* Dvě různé věci se nesmí jmenovat stejně — místo uložení se proto
     jmenuje Umístění, ne Sklad ani Stav. */
  check('místo uložení se jmenuje Umístění', klice(vSkladu).indexOf('Umístění') !== -1,
    JSON.stringify(klice(vSkladu)));

  const plan = najdi(s3, 'Prodej');
  check('cílovka a strategie mají vlastní sekci Prodej',
    klice(plan).indexOf('Cílová cena') !== -1 && klice(plan).indexOf('Strategie') !== -1,
    JSON.stringify(s3.map(x => ({ n: x.nadpis, r: x.radky.map(r => r.k) }))));
  check('a ve Skladu už nejsou',
    klice(vSkladu).indexOf('Cílová cena') === -1 && klice(vSkladu).indexOf('Strategie') === -1,
    JSON.stringify(klice(vSkladu)));

  /* „4 dní" je na první pohled špatně. Jeden den, dva až čtyři dny,
     pět a víc dní. */
  const dnu = (s) => (najdi(s, 'Sklad').radky.find(r => r.k === 'Na skladě') || {}).v;
  check('3 dny se skloňují správně', dnu(s3) === '3 dny', String(dnu(s3)));
  check('1 den taky', dnu(await sekce(1)) === '1 den', String(dnu(await sekce(1))));
  check('5 dní taky', dnu(await sekce(5)) === '5 dní', String(dnu(await sekce(5))));
  check('a 22 dní taky', dnu(await sekce(22)) === '22 dní', String(dnu(await sekce(22))));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
