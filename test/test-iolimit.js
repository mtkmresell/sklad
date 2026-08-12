// Test: predikce překročení limitu identifikované osoby
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const ROK = new Date().getFullYear();
const RETAILERS = [{ id: 'r1', name: 'Footshop EU', zone: 'eu', vatRate: 21, aliases: '' }];

// n nákupů z EU rozložených od začátku roku do dneška
function nakupy(n, castka) {
  const zacatek = new Date(ROK, 0, 1);
  const dnes = new Date();
  const dnu = Math.max(1, Math.round((dnes - zacatek) / 864e5));
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(zacatek.getTime() + Math.floor(dnu * (i + 0.5) / n) * 864e5);
    out.push({ id: 'e' + i, name: 'EU nákup ' + i, category: 'sneakers', buyPrice: castka,
      buyCurrency: 'CZK', buyWhere: 'Footshop EU', saleState: 'stock', location: 'Doma',
      dateAdded: d.getTime(), buyDate: d.toISOString().slice(0, 10), tags: [] });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript((r) => {
    localStorage.setItem('sklad_v3', JSON.stringify([]));
    localStorage.setItem('sklad_retailers_v1', JSON.stringify(r));
    localStorage.setItem('sklad_io_limit_v1', '326000');
    localStorage.setItem('sklad_profile_v1', 'business');
  }, RETAILERS);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const predpoved = (list) => page.evaluate(({ l, rok }) => {
    items = l;
    const f = ioForecast(rok);
    return { net: Math.round(f.net), limit: f.limit, dost: f.dost, prekrocen: !!f.prekrocen,
      uplynulo: f.uplynulo, celkem: f.celkem,
      tempo: f.tempo || null,
      odhadRoku: f.odhadRoku ? Math.round(f.odhadRoku) : null,
      zbyva: f.zbyva !== undefined ? Math.round(f.zbyva) : null,
      dnuDoLimitu: f.dnuDoLimitu !== undefined && isFinite(f.dnuDoLimitu) ? Math.round(f.dnuDoLimitu) : null,
      datum: f.datum ? f.datum.toISOString().slice(0, 10) : null };
  }, { l: list, rok: ROK });

  const veta = (list) => page.evaluate(({ l, rok }) => {
    items = l;
    const div = document.createElement('div');
    div.innerHTML = ioForecastHtml(rok);
    return { text: div.textContent.trim(), barva: div.firstChild.style.color };
  }, { l: list, rok: ROK });

  const dnuLetos = Math.round((new Date() - new Date(ROK, 0, 1)) / 864e5) + 1;
  console.log('  (dnes je ' + dnuLetos + '. den roku ' + ROK + ')');

  // ══════════════════════════════════════════════════════════════
  section('1) Bez dat se nic netvrdí');
  let f = await predpoved([]);
  check('bez nákupů není odhad', !f.dost && !f.prekrocen, JSON.stringify(f));
  let v = await veta([]);
  check('věta to říká srozumitelně', /málo dat|Zatím žádné/.test(v.text), v.text);

  // ══════════════════════════════════════════════════════════════
  section('2) Klidné tempo — limit se letos nepřekročí');
  // 100 000 Kč s DPH za dosavadní část roku → net ≈ 82 645
  const klidne = nakupy(10, 10000);
  f = await predpoved(klidne);
  check('základ bez DPH sedí (21 %)', Math.abs(f.net - Math.round(100000 / 1.21)) <= 2, f.net + ' Kč');
  if (dnuLetos >= 30) {
    check('odhad se počítá', f.dost, JSON.stringify(f));
    check('tempo je čistý průměr na den', Math.abs(f.tempo - f.net / f.uplynulo) < 1, f.tempo.toFixed(1) + ' Kč/den');
    check('odhad roku je tempo × délka roku', Math.abs(f.odhadRoku - f.tempo * f.celkem) < 1,
      f.odhadRoku + ' vs ' + (f.tempo * f.celkem).toFixed(0));
    check('zbývající prostor sedí', f.zbyva === 326000 - f.net, f.zbyva + ' Kč');
    v = await veta(klidne);
    if (f.odhadRoku < f.limit) {
      check('věta hlásí, že se limit nepřekročí', /skončíš letos kolem/.test(v.text), v.text);
      check('je zelená', v.barva.includes('accent'), v.barva);
      check('nedatuje překročení', f.datum === null, String(f.datum));
    }
  } else {
    check('do 30. dne roku se odhad nedělá', !f.dost, JSON.stringify(f));
  }

  // ══════════════════════════════════════════════════════════════
  section('3) Rychlé tempo — limit padne během roku');
  // Tolik, aby projekce limit spolehlivě přestřelila, ale zatím pod ním
  const naDen = 326000 / 365 * 2.2;                       // dvojnásobek limitového tempa
  const hrubaCastka = Math.round(naDen * dnuLetos * 1.21 / 12);
  const rychle = nakupy(12, Math.max(1000, hrubaCastka));
  f = await predpoved(rychle);
  if (dnuLetos >= 30 && !f.prekrocen) {
    check('odhad roku limit přestřeluje', f.odhadRoku > f.limit, f.odhadRoku + ' vs ' + f.limit);
    check('spočítá se datum překročení', !!f.datum, String(f.datum));
    check('datum leží v tomto roce a v budoucnu',
      f.datum > new Date().toISOString().slice(0, 10) && f.datum.startsWith(String(ROK)), String(f.datum));
    check('dnů do limitu sedí se zbývající částkou',
      Math.abs(f.dnuDoLimitu - f.zbyva / f.tempo) < 1.5, f.dnuDoLimitu + ' dnů');
    v = await veta(rychle);
    check('věta varuje a uvádí datum', /narazíš na limit kolem/.test(v.text), v.text);
    check('je oranžová', v.barva.includes('warning'), v.barva);
  } else {
    console.log('  (přeskočeno — ' + (f.prekrocen ? 'limit už překročen' : 'začátek roku') + ')');
  }

  // ══════════════════════════════════════════════════════════════
  section('4) Limit už překročený');
  const prekroceno = nakupy(10, Math.round(400000 * 1.21 / 10));
  f = await predpoved(prekroceno);
  check('pozná překročení', f.prekrocen, JSON.stringify({ net: f.net, limit: f.limit }));
  v = await veta(prekroceno);
  check('věta hlásí překročení i o kolik', /Limit je překročený o/.test(v.text), v.text);
  check('zmiňuje povinnost registrace', /15 dnů/.test(v.text), v.text);
  check('je červená', v.barva.includes('danger'), v.barva);

  // ══════════════════════════════════════════════════════════════
  section('5) Do limitu jde jen to, co tam patří');
  const smes = await page.evaluate(({ rok }) => {
    const d = new Date(rok, 0, 15).toISOString().slice(0, 10);
    items = [
      { id: 'a', name: 'EU', category: 'sneakers', buyPrice: 12100, buyCurrency: 'CZK', buyWhere: 'Footshop EU',
        saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: d, tags: [] },
      { id: 'b', name: 'Osobní', category: 'sneakers', buyPrice: 50000, buyCurrency: 'CZK', buyWhere: 'Footshop EU',
        saleState: 'stock', location: 'Doma', dateAdded: 2, buyDate: d, tags: [], personal: true },
      { id: 'c', name: 'Neznámý obchod', category: 'sneakers', buyPrice: 90000, buyCurrency: 'CZK', buyWhere: 'Nějaký eshop',
        saleState: 'stock', location: 'Doma', dateAdded: 3, buyDate: d, tags: [] },
    ];
    return { net: Math.round(ioForecast(rok).net) };
  }, { rok: ROK });
  check('osobní nákup ani nepřiřazený obchod se do limitu nepočítají',
    smes.net === Math.round(12100 / 1.21), smes.net + ' Kč (čekáno ' + Math.round(12100 / 1.21) + ')');

  // ══════════════════════════════════════════════════════════════
  section('6) Zobrazení ve správě retailerů');
  await page.evaluate((l) => { items = l; openRetailersMgr(); }, prekroceno);
  await page.waitForTimeout(400);
  const okno = await page.evaluate(() => {
    const ov = document.getElementById('retailersMgrOv');
    return { otevreno: !!ov, text: ov ? ov.textContent : '' };
  });
  check('okno se otevře a obsahuje předpověď',
    okno.otevreno && /Limit je překročený o/.test(okno.text), okno.text.slice(0, 120));
  await page.evaluate(() => { const o = document.getElementById('retailersMgrOv'); if (o) o.remove(); });

  // Ryska odhadu na pruhu při klidném tempu
  if (dnuLetos >= 30) {
    await page.evaluate((l) => { items = l; openRetailersMgr(); }, klidne);
    await page.waitForTimeout(400);
    const ryska = await page.evaluate(() => {
      const ov = document.getElementById('retailersMgrOv');
      const el = ov && ov.querySelector('[title="Odhad na konec roku"]');
      return { je: !!el, left: el ? el.style.left : null };
    });
    check('na pruhu je ryska s odhadem na konec roku', ryska.je, JSON.stringify(ryska));
    if (ryska.je) {
      const pct = parseFloat(ryska.left);
      check('ryska je v rozsahu 0–100 %', pct > 0 && pct <= 99.5, ryska.left);
    }
    await page.evaluate(() => { const o = document.getElementById('retailersMgrOv'); if (o) o.remove(); });
  }

  // ══════════════════════════════════════════════════════════════
  section('7) Stat karta');
  const karta = await page.evaluate((l) => {
    items = l; renderStats();
    const c = [...document.querySelectorAll('#statsBar .stat-card')].find(x => /EU nákupy/.test(x.textContent));
    return { je: !!c, tip: c ? c.getAttribute('data-tip') : '', vyska: c ? c.offsetHeight : 0,
      ostatni: [...document.querySelectorAll('#statsBar .stat-card')].map(x => x.offsetHeight) };
  }, prekroceno);
  check('karta EU nákupy existuje', karta.je);
  check('tooltip nese informaci o překročení', /překročený/.test(karta.tip), karta.tip);
  check('karta nezvětšila výšku oproti ostatním',
    karta.ostatni.every(h => h === karta.vyska), JSON.stringify(karta.ostatni));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
