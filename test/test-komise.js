// Test: přenos prodejů z komisního prodeje do skladu.
//
// Co se prodá u komisionáře, se má samo přesunout do Čeká — jinak se kus
// tváří, že je pořád doma, a majitel ho může nabídnout podruhé.
//
// Sahat si do dat po síti je ale nebezpečné, takže se tu hlídají hlavně
// pojistky: čeká se na první snímek z cloudu, přesun předchází záloha,
// z odpovědi konektoru se bere jen dohodnutá hrstka polí a kusu, se
// kterým majitel mezitím pohnul, se to nedotkne.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SOUBOR = 'file://' + path.resolve(__dirname, '..', 'index.html');
const KONEKTOR = 'https://sklad.mtkm-resell.workers.dev';
const TOKEN = 'token-pro-aplikaci';

/* Tričko nese pozůstatky po dřívějším prodeji, ze kterého se vrátilo na
   sklad — starší verze aplikace je při návratu neuklidily. Nová změna
   stavu je musí smést, jinak by lhůta na payout běžela od loňska. */
const POLOZKY = [
  { id: 'a', name: 'Tričko', sku: 'T-1', size: 'S', category: 'obleceni', buyPrice: 300,
    buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: 1,
    buyDate: '2026-01-01', targetPrice: 750, platforms: ['Pikastore', 'Bazoš.cz'], tags: [],
    sentAt: '2026-03-01', dorucenoOd: '2026-03-04' },
  { id: 'b', name: 'Boty', sku: 'B-2', size: '43', category: 'sneakers', buyPrice: 2000,
    buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: 2,
    buyDate: '2026-01-02', targetPrice: 4000, platforms: [], tags: [] },
];

// Co by poslal konektor za jeden prodaný kus
function prodej(zmena) {
  return Object.assign({
    polozka: { id: 'a', nazev: 'Tričko', sku: 'T-1', velikost: 'S' },
    u_nich: { id: 'L-1', na_pulte_kc: 1000, provize_pct: 25 },
    vyplnit: {
      saleState: 'waiting', waitState: 'sending', sellPrice: 750, sellCurrency: 'CZK',
      saleDate: '2026-09-05', soldWhere: 'Pikastore', extraCosts: 0,
    },
    doplnit_rucne: ['saleRef'],
  }, zmena || {});
}

// Na co se aplikace ptala konektoru. Ostatní dotazy (kurz ČNB) sem
// nepatří — chodí ze startu aplikace a s přenosem nesouvisí.
function dotazyNaProdeje() {
  return (window.__dotazy || []).filter(u => u.indexOf('/prodeje') !== -1);
}

/* Falešný konektor. Zaznamenává, na co se aplikace ptala — u nenastaveného
   tokenu se totiž nesmí ptát vůbec. */
function nasadKonektor(odpoved) {
  window.__dotazy = [];
  window.__odpoved = odpoved;
  window.fetch = async function (u) {
    window.__dotazy.push(String(u && u.url ? u.url : u));
    const o = window.__odpoved;
    if (o && o.__selze) throw new Error('síť spadla');
    return new Response(JSON.stringify(o || { stav: 'ok', k_preneseni: [] }),
      { status: (o && o.__stav) || 200, headers: { 'Content-Type': 'application/json' } });
  };
  // sv() by se jinak pokusil zapsat do cloudu, který v testu není
  window.__zapisyDoCloudu = 0;
  window.fbSaveToCloud = function () { window.__zapisyDoCloudu++; };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];

  async function otevri(nastav) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.route('**/firebasejs/**', route => route.abort());
    await ctx.addInitScript((d) => {
      localStorage.setItem('sklad_v3', JSON.stringify(d.polozky));
      if (d.url) localStorage.setItem('sklad_konektor_url_v1', d.url);
      if (d.token) localStorage.setItem('sklad_komise_token_v1', d.token);
    }, Object.assign({ polozky: POLOZKY }, nastav || {}));
    await page.goto(SOUBOR, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof komisePrenesProdeje === 'function'
      && Array.isArray(items) && items.length > 0, { timeout: 20000 });
    return page;
  }

  // Přihlášení a dorazivší snímek předstíráme — do dat se smí sáhnout až po něm
  async function cloudDorazil(page) {
    await page.evaluate(() => { window._fbUser = { uid: 'u1' }; _fbCloudReady = true; });
  }

  // ══════════════════════════════════════════════════════════════
  section('1) Bez nastavení se nic neděje');
  /* Token je vlastní pro tohle zařízení. Dokud není, nesmí se aplikace
     nikoho na nic ptát — jinak by na cizí adresu chodily dotazy. */
  let page = await otevri({ url: KONEKTOR });        // adresa ano, token ne
  await page.evaluate(nasadKonektor, null);
  await cloudDorazil(page);
  let v = await page.evaluate(() => komisePrenesProdeje(true));
  check('bez tokenu se přenos nespustí', v.stav === 'nenastaveno', JSON.stringify(v));
  check('a konektor se ani neptá', (await page.evaluate(dotazyNaProdeje)).length === 0);
  await page.context().close();

  page = await otevri({ token: TOKEN });             // token ano, adresa ne
  await page.evaluate(nasadKonektor, null);
  await cloudDorazil(page);
  v = await page.evaluate(() => komisePrenesProdeje(true));
  check('bez adresy konektoru taky ne', v.stav === 'nenastaveno', JSON.stringify(v));
  await page.context().close();

  // ══════════════════════════════════════════════════════════════
  section('2) Před prvním snímkem z cloudu se do dat nesahá');
  /* Zařízení do té chvíle netuší, co v cloudu je. Zápis by ho přepsal
     stavem klidně o den starším — přesně jak mizely prodeje dřív. */
  page = await otevri({ url: KONEKTOR, token: TOKEN });
  await page.evaluate(nasadKonektor, { stav: 'ok', k_preneseni: [prodej()] });
  v = await page.evaluate(() => komisePrenesProdeje(true));
  check('bez snímku se přenos odloží', v.stav === 'ceka-na-cloud', JSON.stringify(v));
  check('a položka zůstala na skladě',
    (await page.evaluate(() => items.find(x => x.id === 'a').saleState)) === 'stock');
  check('konektor se ani neptal', (await page.evaluate(dotazyNaProdeje)).length === 0);
  await page.context().close();

  // ══════════════════════════════════════════════════════════════
  section('3) Prodaný kus se přesune do Čeká');
  page = await otevri({ url: KONEKTOR, token: TOKEN });
  await page.evaluate(nasadKonektor, { stav: 'ok', k_preneseni: [prodej()] });
  await cloudDorazil(page);
  const pred = await page.evaluate(() => getSnapshots().length);
  v = await page.evaluate(() => komisePrenesProdeje(true));
  const po = await page.evaluate(() => {
    const it = items.find(x => x.id === 'a');
    const snaps = getSnapshots();
    return {
      it, snapu: snaps.length, popisek: (snaps[0] || {}).label,
      vZaloze: ((snaps[0] || {}).data || []).find(x => x.id === 'a'),
      cloud: window.__zapisyDoCloudu,
      dotazy: window.__dotazy.filter(u => u.indexOf('/prodeje') !== -1),
    };
  });
  check('přesun se povedl', v.stav === 'ok' && v.preneseno === 1, JSON.stringify(v));
  check('ptá se konektoru na vlastní adrese',
    po.dotazy.length === 1 && po.dotazy[0] === KONEKTOR + '/' + TOKEN + '/prodeje',
    JSON.stringify(po.dotazy));
  check('kus je v Čeká', po.it.saleState === 'waiting' && po.it.waitState === 'sending',
    po.it.saleState + '/' + po.it.waitState);
  check('s payoutem jako prodejní cenou', po.it.sellPrice === 750, String(po.it.sellPrice));
  check('v korunách', po.it.sellCurrency === 'CZK', po.it.sellCurrency);
  check('s datem prodeje od nich', po.it.saleDate === '2026-09-05', po.it.saleDate);
  check('s místem prodeje Pikastore', po.it.soldWhere === 'Pikastore', po.it.soldWhere);
  check('a nulovými dalšími náklady', po.it.extraCosts === 0, String(po.it.extraCosts));
  /* Stav je „čeká na odeslání", takže datum odeslání ani doručení tu
     nemá co dělat — a zbytky po dřívějším prodeji musí zmizet, jinak by
     u kusu svítilo, že je doručený od března. */
  check('datum odeslání se nedrží', po.it.sentAt === undefined, String(po.it.sentAt));
  check('ani datum doručení', po.it.dorucenoOd === undefined, String(po.it.dorucenoOd));
  check('prodaný kus už nikde nevisí', (po.it.platforms || []).length === 0,
    JSON.stringify(po.it.platforms));
  // Bez zálohy by se omyl nedal vrátit — proto je hned první na řadě
  check('před zásahem se uložila záloha', po.snapu === pred + 1, pred + ' → ' + po.snapu);
  check('a je z ní poznat proč', /komis/i.test(po.popisek || ''), po.popisek);
  check('v záloze je kus ještě na skladě', po.vZaloze && po.vZaloze.saleState === 'stock',
    JSON.stringify(po.vZaloze && po.vZaloze.saleState));
  /* Přesun se musí dostat i do cloudu, jinak by ho druhé zařízení
     přepsalo zpátky na sklad. sv() má na cloud půlvteřinovou pauzu. */
  await page.waitForFunction(() => window.__zapisyDoCloudu > 0, { timeout: 5000 })
    .catch(() => {});
  check('a změna míří do cloudu',
    (await page.evaluate(() => window.__zapisyDoCloudu)) === 1,
    String(await page.evaluate(() => window.__zapisyDoCloudu)));
  check('i do úložiště prohlížeče',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('sklad_v3'))
      .find(x => x.id === 'a').saleState)) === 'waiting');
  await page.context().close();

  // ══════════════════════════════════════════════════════════════
  section('4) Co už není na skladě, se nechá být');
  /* Kus mohl majitel mezitím zpracovat sám. Přepsat hotový prodej je
     horší chyba než nechat kus doma o den dýl. */
  page = await otevri({ url: KONEKTOR, token: TOKEN, polozky: [
    Object.assign({}, POLOZKY[0], { saleState: 'waiting', waitState: 'payout',
      sellPrice: 900, saleRef: 'OBJ-1' }), POLOZKY[1],
  ] });
  await page.evaluate(nasadKonektor, { stav: 'ok', k_preneseni: [prodej()] });
  await cloudDorazil(page);
  v = await page.evaluate(() => komisePrenesProdeje(true));
  let it = await page.evaluate(() => items.find(x => x.id === 'a'));
  check('nic se nepřenáší', v.preneseno === 0, JSON.stringify(v));
  check('ruční prodej zůstal nedotčený',
    it.waitState === 'payout' && it.sellPrice === 900 && it.saleRef === 'OBJ-1',
    JSON.stringify({ w: it.waitState, c: it.sellPrice, r: it.saleRef }));
  check('a záloha se kvůli ničemu nedělá',
    (await page.evaluate(() => getSnapshots().length)) === 0);
  await page.context().close();

  // ══════════════════════════════════════════════════════════════
  section('5) Z odpovědi se bere jen dohodnutá hrstka polí');
  /* Odpověď přijde po síti. Kdyby se z ní kopírovalo, co pošle, změna
     konektoru (nebo někdo, kdo odpoví místo něj) by přepsala nákupní
     cenu i název — a v evidenci by to nebylo poznat. */
  page = await otevri({ url: KONEKTOR, token: TOKEN });
  await page.evaluate(nasadKonektor, { stav: 'ok', k_preneseni: [prodej({
    vyplnit: { saleState: 'waiting', waitState: 'sending', sellPrice: 750,
      sellCurrency: 'CZK', saleDate: '2026-09-05', soldWhere: 'Pikastore', extraCosts: 0,
      buyPrice: 1, name: 'Přepsáno', id: 'jiné', personal: true, profit: 999999,
      saleRef: 'PODVRŽENO' },
  })] });
  await cloudDorazil(page);
  await page.evaluate(() => komisePrenesProdeje(true));
  // Schválně podle pořadí, ne podle id — přepsané id se má poznat taky
  it = await page.evaluate(() => items[0]);
  check('id se nepřepíše', it.id === 'a', String(it.id));
  check('nákupní cena se nepřepíše', it.buyPrice === 300, String(it.buyPrice));
  check('název taky ne', it.name === 'Tričko', it.name);
  check('ani profil', it.personal === undefined, String(it.personal));
  check('zisk se nepodstrčí', it.profit === undefined, String(it.profit));
  /* Číslo objednávky konektor nezná (chodí na Discord) — doplňuje se
     ručně v úpravě položky. Nesmí se tedy ani vyplnit odjinud, ani na
     něm nesmí přesun viset. */
  check('ID prodeje se nevyplní', it.saleRef === undefined, String(it.saleRef));
  check('a přesun proběhl i bez něj', it.saleState === 'waiting', it.saleState);
  await page.context().close();

  // Nesmyslná hodnota se zahodí, ne aby se zapsala
  page = await otevri({ url: KONEKTOR, token: TOKEN });
  await page.evaluate(nasadKonektor, { stav: 'ok', k_preneseni: [
    prodej({ vyplnit: { saleState: 'paid', sellPrice: 750 } }),
    prodej({ polozka: { id: 'b' }, vyplnit: { saleState: 'waiting', waitState: 'sending',
      sellPrice: -5, sellCurrency: 'BTC', saleDate: 'včera', soldWhere: 'Pikastore', extraCosts: 0 } }),
  ] });
  await cloudDorazil(page);
  v = await page.evaluate(() => komisePrenesProdeje(true));
  const oba = await page.evaluate(() => items.map(x => ({ id: x.id, s: x.saleState,
    c: x.sellPrice, m: x.sellCurrency, d: x.saleDate })));
  check('rovnou na Vyplaceno to kus neposune', oba[0].s === 'stock', JSON.stringify(oba[0]));
  check('kus s nesmysly se přesune, ale nesmysly se nezapíšou',
    oba[1].s === 'waiting' && oba[1].c === undefined && oba[1].m === undefined
      && oba[1].d === undefined, JSON.stringify(oba[1]));
  check('a přeneslo se právě to jedno', v.preneseno === 1, JSON.stringify(v));
  await page.context().close();

  // ══════════════════════════════════════════════════════════════
  section('6) Když konektor neodpoví');
  page = await otevri({ url: KONEKTOR, token: TOKEN });
  await page.evaluate(nasadKonektor, { __selze: true });
  await cloudDorazil(page);
  v = await page.evaluate(() => komisePrenesProdeje(true));
  check('výpadek shodí přenos, ne aplikaci', v.stav === 'chyba', JSON.stringify(v));
  check('položka zůstala na skladě',
    (await page.evaluate(() => items.find(x => x.id === 'a').saleState)) === 'stock');
  /* Na mobilu se do konzole prohlížeče nikdo nedostane — bez zapsané
     potíže by se nedalo zjistit, že přenos neběží. */
  const stav = await page.evaluate(() => komiseStav());
  check('potíž se zapamatuje', stav && stav.stav === 'chyba' && !!stav.chyba,
    JSON.stringify(stav));
  await page.context().close();

  // ══════════════════════════════════════════════════════════════
  section('7) Token zůstává v tomhle prohlížeči');
  page = await otevri({ url: KONEKTOR, token: TOKEN });
  const klice = await page.evaluate(() => ({
    vSync: syncSettings().map(s => s.key),
    lokalni: syncLocalOnlyKeys(),
    token: SK_KOMISE_TOKEN,
  }));
  /* Synchronizované nastavení čte i účetní. Token do něj nepatří —
     zamčené je jen to, co pravidla Firestore nepustí. */
  check('token není v synchronizovaném nastavení', klice.vSync.indexOf(klice.token) === -1,
    JSON.stringify(klice.vSync.filter(k => /komise/.test(k))));
  check('ale při odhlášení se maže', klice.lokalni.indexOf(klice.token) !== -1,
    JSON.stringify(klice.lokalni));
  await page.evaluate(() => clearSkladLocalStorage());
  check('a opravdu zmizí', (await page.evaluate(() => getKomiseToken())) === '');
  await page.context().close();

  // ══════════════════════════════════════════════════════════════
  section('8) Okno v Nastavení');
  page = await otevri({ url: KONEKTOR, token: TOKEN });
  await page.evaluate(nasadKonektor, { stav: 'ok', k_preneseni: [] });
  const okno = await page.evaluate(async () => {
    openKomiseSettings();
    await new Promise(r => setTimeout(r, 150));
    const pole = document.getElementById('komiseTokenInput');
    const stav = document.getElementById('komiseStavRadek');
    return {
      otevreno: !!document.getElementById('komiseOverlay'),
      // Token se nesmí ukazovat jako čitelný text přes rameno
      typ: pole && pole.type,
      predvyplneno: pole && pole.value,
      radek: stav && stav.textContent,
    };
  });
  check('okno se otevře', okno.otevreno);
  check('token se předvyplní', okno.predvyplneno === TOKEN, okno.predvyplneno);
  check('a není vidět', okno.typ === 'password', okno.typ);
  check('řekne, že se zatím nic nedělo', /Zatím neproběhlo/.test(okno.radek || ''), okno.radek);
  const poZmene = await page.evaluate(async () => {
    document.getElementById('komiseTokenInput').value = 'jiny-token';
    document.getElementById('komiseSave').click();
    await new Promise(r => setTimeout(r, 100));
    return { ulozeno: getKomiseToken(), zavreno: !document.getElementById('komiseOverlay') };
  });
  check('uložení zapíše nový token', poZmene.ulozeno === 'jiny-token', poZmene.ulozeno);
  check('a okno se zavře', poZmene.zavreno);
  await page.context().close();

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
