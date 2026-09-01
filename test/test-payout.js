// Test: údaje u způsobu vyplacení („Payout na" → detail účtu).
//
// Ke každé možnosti se dá dopsat, kam peníze chodí. Na prodejním dokladu
// pak nestojí jen „Revolut", ale účet, na který má kupující poslat —
// bez něj je doklad k zaplacení nepoužitelný.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  // Funkce jsou v dřívějším scriptu než konec body — čekat se musí i na DOM
  await page.waitForFunction(() => document.readyState === 'complete'
    && typeof openPayoutDetail === 'function' && typeof getPayoutDetails === 'function'
    && !!document.getElementById('moSettings'), { timeout: 20000 });
  await page.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════
  section('1) Detail se otevře a uloží');
  const ulozeni = await page.evaluate(async () => {
    localStorage.removeItem('sklad_payout_detail_v1');
    openPayoutDetail('Revolut');
    await new Promise(r => setTimeout(r, 120));
    const ov = document.getElementById('payoutDetailOv');
    if (!ov) return { chyba: 'okno se neotevřelo' };
    document.getElementById('pyUcet').value = '123456789/0100';
    document.getElementById('pyIban').value = 'CZ6508000000192000145399';
    document.getElementById('pyProfil').value = 'business';
    document.getElementById('pySave').click();
    await new Promise(r => setTimeout(r, 80));
    return {
      zavreno: !document.getElementById('payoutDetailOv'),
      ulozeno: getPayoutDetail('Revolut'),
    };
  });
  check('okno se otevřelo a zavřelo', !ulozeni.chyba && ulozeni.zavreno, ulozeni.chyba || '');
  check('číslo účtu se uložilo', ulozeni.ulozeno.ucet === '123456789/0100', JSON.stringify(ulozeni.ulozeno));
  check('IBAN taky', ulozeni.ulozeno.iban === 'CZ6508000000192000145399', JSON.stringify(ulozeni.ulozeno));
  check('i profil', ulozeni.ulozeno.profil === 'business', JSON.stringify(ulozeni.ulozeno));

  /* Zpět ukládá stejně jako Uložit. U správy platforem se ukázalo, že
     odchod z detailu je pro uživatele okamžik, kdy je to nastavené —
     zahodit mu to je tichá ztráta dat. */
  const zpetUklada = await page.evaluate(async () => {
    openPayoutDetail('Fio Banka');
    await new Promise(r => setTimeout(r, 120));
    document.getElementById('pyUcet').value = '2900123456/2010';
    document.getElementById('pyBack').click();
    await new Promise(r => setTimeout(r, 80));
    return getPayoutDetail('Fio Banka').ucet;
  });
  check('Zpět taky uloží', zpetUklada === '2900123456/2010', zpetUklada);

  const prazdny = await page.evaluate(async () => {
    openPayoutDetail('Hotovost');
    await new Promise(r => setTimeout(r, 120));
    document.getElementById('pySave').click();
    await new Promise(r => setTimeout(r, 80));
    return Object.keys(getPayoutDetails()).indexOf('Hotovost') === -1;
  });
  check('prázdný detail se neukládá', prazdny, 'ať se nastavení nezanáší prázdnými objekty');

  // ══════════════════════════════════════════════════════════════
  section('2) Co se vypíše na doklad');
  const volba = await page.evaluate(() => {
    savePayoutDetails({
      Revolut: { ucet: '123456789/0100', iban: 'CZ6508000000192000145399' },
      'Fio Banka': { ucet: '2900123456/2010' },
      Wise: { iban: 'BE71096123456769' },
    });
    const kus = (metoda, mena) => payoutUcetProDoklad({ payoutMethod: metoda, sellCurrency: mena });
    return {
      czk: kus('Revolut', 'CZK'),
      eur: kus('Revolut', 'EUR'),
      // Chybí ten správný — půl údaje je pořád lepší než nic
      eurBezIban: kus('Fio Banka', 'EUR'),
      czkBezUctu: kus('Wise', 'CZK'),
      neznama: kus('Něco jiného', 'CZK'),
      zadna: payoutUcetProDoklad({ sellCurrency: 'CZK' }),
    };
  });
  check('korunový prodej bere číslo účtu',
    volba.czk && volba.czk.popis === 'Číslo účtu' && volba.czk.hodnota === '123456789/0100', JSON.stringify(volba.czk));
  check('eurový bere IBAN',
    volba.eur && volba.eur.popis === 'IBAN' && volba.eur.hodnota === 'CZ6508000000192000145399', JSON.stringify(volba.eur));
  check('bez IBANu se u eur použije účet',
    volba.eurBezIban && volba.eurBezIban.popis === 'Číslo účtu', JSON.stringify(volba.eurBezIban));
  check('bez účtu se u korun použije IBAN',
    volba.czkBezUctu && volba.czkBezUctu.popis === 'IBAN', JSON.stringify(volba.czkBezUctu));
  check('neznámý způsob nic nevrátí', volba.neznama === null, JSON.stringify(volba.neznama));
  check('a bez způsobu taky ne', volba.zadna === null, JSON.stringify(volba.zadna));

  // ══════════════════════════════════════════════════════════════
  /* Údaje visí na názvu možnosti. Kdyby se při přejmenování nepřenesly,
     zmizely by z dokladu a nikdo by nevěděl proč. */
  section('3) Přejmenování si údaje odnese s sebou');
  const prejmenovani = await page.evaluate(async () => {
    localStorage.setItem('sklad_payment_opts_v1', JSON.stringify(['Revolut', 'Fio Banka']));
    savePayoutDetails({ Revolut: { ucet: '123456789/0100' } });
    items = [{ id: 'a', name: 'Kus', saleState: 'paid', payoutMethod: 'Revolut', tags: [] }];
    openDropdownsEditor();
    await new Promise(r => setTimeout(r, 150));
    const radky = document.querySelectorAll('#_de_list_1 input[type="text"]');
    radky[0].value = 'Revolut Business';
    radky[0].dispatchEvent(new Event('input', { bubbles: true }));
    radky[0].blur();
    await new Promise(r => setTimeout(r, 60));
    // „Uložit vše"
    const btn = Array.from(document.querySelectorAll('.mo.open .btn-pri'))
      .find(b => /Uložit vše/.test(b.textContent));
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    /* Zavřít jen překryvy vyrobené za běhu. Hromadné mazání .mo.open
       by sundalo i #moSettings, které se po uložení samo otevře —
       a další sekce by ho pak nenašla. */
    document.querySelectorAll('.mo.open:not([id])').forEach(m => m.remove());
    document.querySelectorAll('.mo.open[id]:not(.brana)').forEach(m => m.classList.remove('open'));
    const det = getPayoutDetails();
    return {
      podNovym: (det['Revolut Business'] || {}).ucet || null,
      staryPryc: !det['Revolut'],
      naPolozce: items[0].payoutMethod,
    };
  });
  check('údaje jsou pod novým názvem', prejmenovani.podNovym === '123456789/0100', String(prejmenovani.podNovym));
  check('a pod starým už ne', prejmenovani.staryPryc);
  check('položka se přejmenovala taky', prejmenovani.naPolozce === 'Revolut Business', prejmenovani.naPolozce);

  // ══════════════════════════════════════════════════════════════
  section('4) Tlačítko na detail je vidět');
  const tlacitka = await page.evaluate(async () => {
    localStorage.setItem('sklad_payment_opts_v1', JSON.stringify(['Revolut', 'Hotovost']));
    savePayoutDetails({ Revolut: { ucet: '123456789/0100' } });
    openDropdownsEditor();
    await new Promise(r => setTimeout(r, 150));
    const vPayout = document.querySelectorAll('#_de_list_1 ._de_detail');
    const vSkladu = document.querySelectorAll('#_de_list_0 ._de_detail');
    const r = {
      pocetPayout: vPayout.length,
      pocetSklad: vSkladu.length,
      popisky: Array.from(vPayout).map(b => b.textContent.trim()),
    };
    /* Zavřít jen překryvy vyrobené za běhu. Hromadné mazání .mo.open
       by sundalo i #moSettings, které se po uložení samo otevře —
       a další sekce by ho pak nenašla. */
    document.querySelectorAll('.mo.open:not([id])').forEach(m => m.remove());
    document.querySelectorAll('.mo.open[id]:not(.brana)').forEach(m => m.classList.remove('open'));
    return r;
  });
  check('u každého způsobu vyplacení je tlačítko', tlacitka.pocetPayout === 2, String(tlacitka.pocetPayout));
  check('u skladů ne, tam by nedávalo smysl', tlacitka.pocetSklad === 0, String(tlacitka.pocetSklad));
  check('vyplněné je poznat na první pohled',
    tlacitka.popisky[0] === 'Účet ✓' && tlacitka.popisky[1] === 'Účet', JSON.stringify(tlacitka.popisky));

  // ══════════════════════════════════════════════════════════════
  section('5) Údaje jdou do cloudu');
  const sync = await page.evaluate(() => {
    savePayoutDetails({ Revolut: { ucet: '123456789/0100' } });
    const payload = {};
    syncSettingsToPayload(payload);
    return payload.payoutDetail && payload.payoutDetail.Revolut ? payload.payoutDetail.Revolut.ucet : null;
  });
  check('účty se synchronizují', sync === '123456789/0100',
    'jinak by zůstaly jen v tomhle prohlížeči');

  // ══════════════════════════════════════════════════════════════
  /* Kurz ČNB — adresa denní kurzovní stránky a parsování jejího textu.
     Skutečné síťové volání se netestuje, ale tvar odpovědi ano. */
  section('6) Kurz ČNB');
  const cnb = await page.evaluate(() => {
    const vzorek = '12.08.2026 #155\n'
      + 'země|měna|množství|kód|kurz\n'
      + 'Austrálie|dolar|1|AUD|14,321\n'
      + 'EMU|euro|1|EUR|24,190\n'
      + 'Maďarsko|forint|100|HUF|6,158\n';
    return {
      url: cnbKurzUrl('2026-08-12'),
      prazdneDatum: cnbKurzUrl(''),
      kurz: parseCnbKurz(vzorek),
      // Množství se musí vydělit, jinak by z forintu byl stonásobek
      forint: parseCnbKurz(vzorek.replace('|EUR|', '|XXX|').replace('|HUF|', '|EUR|')),
      nesmysl: parseCnbKurz('úplně jiný text'),
    };
  });
  check('adresa míří na denní kurz toho dne',
    cnb.url === 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt?date=12.08.2026',
    cnb.url);
  check('bez data se adresa nevyrábí', cnb.prazdneDatum === '', cnb.prazdneDatum);
  check('kurz eura se přečte', cnb.kurz === 24.19, String(cnb.kurz));
  check('množství se vydělí', cnb.forint === 0.062, String(cnb.forint));
  check('z nesmyslu nic', cnb.nesmysl === null, String(cnb.nesmysl));

  // ══════════════════════════════════════════════════════════════
  /* Kurzy zapamatované z doby, kdy aplikace ČNB nevolala, leží
     v localStorage. Bez vynucení by je přepočet vzal z cache a jen
     přepsal staré hodnoty týmiž — do ČNB by se nikdy nedostal. */
  section('7) Vynucený přepočet nevezme starý kurz z cache');
  const cache = await page.evaluate(async () => {
    const den = '2026-03-04';
    localStorage.setItem('eurRate_' + den, '99.99');      // kurz z kurzovního API
    localStorage.removeItem('eurRate_' + den + '_cnb');
    const bezVynuceni = await fetchRateForDate(den);
    // S vynucením se cache přeskočí a zkusí se ČNB; ta je v testu
    // nedostupná, takže se spadne na zálohu — hlavně že to není 99.99
    const sVynucenim = await fetchRateForDate(den, true);

    // Kurz, o kterém víme, že z ČNB je, se z cache brát smí
    const den2 = '2026-03-05';
    localStorage.setItem('eurRate_' + den2, '24.19');
    localStorage.setItem('eurRate_' + den2 + '_cnb', '1');
    const cnbZCache = await fetchRateForDate(den2, true);
    return { bezVynuceni, sVynucenim, cnbZCache, zdroj: _kurzZdroj };
  });
  check('bez vynucení se cache použije', cache.bezVynuceni === 99.99, String(cache.bezVynuceni));
  check('s vynucením se starý kurz z cache nebere', cache.sVynucenim !== 99.99,
    'jinak by přepočet do ČNB nikdy nedošel');
  check('kurz už jednou z ČNB se z cache brát smí', cache.cnbZCache === 24.19, String(cache.cnbZCache));
  check('a pozná se to na zdroji', cache.zdroj === 'cnb', cache.zdroj);

  // ══════════════════════════════════════════════════════════════
  /* Prohlížeč na cnb.cz nedosáhne (CORS) — ověřeno v provozu, ze 111
     kurzů prošlo z ČNB 0. Kurz proto stahuje konektor. */
  section('8) Cesta ke kurzu přes konektor');
  const konektor = await page.evaluate(async () => {
    const zkus = (adresa, datum) => { saveKonektorUrl(adresa); return konektorKurzUrl(datum); };
    return {
      nenastaveno: zkus('', '2026-08-12'),
      bezneho: zkus('https://sklad.ucet.workers.dev', '2026-08-12'),
      bezData: zkus('https://sklad.ucet.workers.dev', ''),
      bezSchematu: zkus('sklad.ucet.workers.dev', '2026-08-12'),
      // Kdyby někdo vložil celou adresu i s tokenem, do dotazu na kurz
      // se token dostat nesmí — jde přes prohlížeč a je veřejný
      sTokenem: zkus('https://sklad.ucet.workers.dev/tajnytoken123/mcp', '2026-08-12'),
      nesmysl: zkus('rozhodně ne adresa', '2026-08-12'),
    };
  });
  check('bez nastavení se adresa nevyrábí', konektor.nenastaveno === '', konektor.nenastaveno);
  check('adresa míří na /kurz s datem',
    konektor.bezneho === 'https://sklad.ucet.workers.dev/kurz/2026-08-12', konektor.bezneho);
  check('bez data se ptá na dnešek',
    konektor.bezData === 'https://sklad.ucet.workers.dev/kurz', konektor.bezData);
  check('chybějící https se doplní',
    konektor.bezSchematu === 'https://sklad.ucet.workers.dev/kurz/2026-08-12', konektor.bezSchematu);
  check('token se do dotazu nedostane', !/tajnytoken/.test(konektor.sTokenem), konektor.sTokenem);
  check('a zbude z toho jen doména',
    konektor.sTokenem === 'https://sklad.ucet.workers.dev/kurz/2026-08-12', konektor.sTokenem);
  check('nesmysl adresu nevyrobí', konektor.nesmysl === '', konektor.nesmysl);

  // Kurz z konektoru se bere jako ČNB a označí položku
  const zKonektoru = await page.evaluate(async () => {
    saveKonektorUrl('https://sklad.ucet.workers.dev');
    const puvodni = window.fetch;
    window.fetch = function (u) {
      if (String(u).indexOf('/kurz/') !== -1) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ kurz: 24.19, datum: '2026-03-09', zdroj: 'cnb' }) });
      }
      return Promise.reject(new Error('jinam se chodit nemá'));
    };
    localStorage.removeItem('eurRate_2026-03-09');
    localStorage.removeItem('eurRate_2026-03-09_cnb');
    const kurz = await fetchRateForDate('2026-03-09');
    const zdroj = _kurzZdroj;
    window.fetch = puvodni;
    saveKonektorUrl('');
    return { kurz, zdroj, zapamatovano: localStorage.getItem('eurRate_2026-03-09_cnb') };
  });
  check('kurz z konektoru se použije', zKonektoru.kurz === 24.19, String(zKonektoru.kurz));
  check('a bere se jako ČNB', zKonektoru.zdroj === 'cnb', zKonektoru.zdroj);
  check('pamatuje se, že byl z ČNB', zKonektoru.zapamatovano === '1', String(zKonektoru.zapamatovano));

  // ══════════════════════════════════════════════════════════════
  /* Všechno kolem kurzu je v jednom okně. Dřív to bylo rozsypané mezi
     nastavením a tlačítkem v Nástrojích a nebylo poznat, že to spolu
     souvisí. */
  section('9) Okno Kurzy měn');
  const kurzyOkno = await page.evaluate(async () => {
    localStorage.setItem('eurRate', '24.16');
    localStorage.setItem('eurRateDate', String(Date.now()));
    localStorage.setItem('eurRateZdroj', 'cnb');
    localStorage.setItem('autoRate', 'true');
    eurRate = 24.16; autoRate = true;
    saveKonektorUrl('https://sklad.ucet.workers.dev');
    openKurzyMen();
    await new Promise(r => setTimeout(r, 150));
    const ov = document.getElementById('kurzyOverlay');
    if (!ov) return { chyba: 'okno se neotevřelo' };
    const je = (id) => !!document.getElementById(id);
    // Text „Poslední aktualizace" smí být na jednom místě, ne na dvou
    const radky = (ov.textContent.match(/Poslední aktualizace/g) || []).length;
    return {
      maVelkyKurz: (document.getElementById('kurzVelky') || {}).textContent,
      maZnackuZdroje: (document.getElementById('kurzZdroj') || {}).textContent,
      radkyAktualizace: radky,
      adresaVyplnena: (document.getElementById('konektorUrlInput') || {}).value,
      prepinac: je('autoCourseChk'), rucniPole: je('eurRateInput'),
      aktualizovat: je('btnRefreshRate'), prepocitat: je('btnRecalcRates'),
      vyzkouset: !!ov.querySelector('[data-action="zkusitkonektor"]'),
      // V automatickém režimu se ruční pole schovává
      rucniSkryte: getComputedStyle(document.getElementById('manualRateWrap')).display === 'none',
    };
  });
  check('okno se otevřelo', !kurzyOkno.chyba, kurzyOkno.chyba || '');
  check('ukazuje dnešní kurz', kurzyOkno.maVelkyKurz === '24.16 Kč', kurzyOkno.maVelkyKurz);
  check('a odkud je', kurzyOkno.maZnackuZdroje === 'ČNB', kurzyOkno.maZnackuZdroje);
  check('„Poslední aktualizace" je jen jednou', kurzyOkno.radkyAktualizace === 1,
    kurzyOkno.radkyAktualizace + '× — dřív svítila dvakrát pod sebou');
  check('adresa konektoru je předvyplněná',
    kurzyOkno.adresaVyplnena === 'https://sklad.ucet.workers.dev', kurzyOkno.adresaVyplnena);
  check('je tam přepínač i ruční kurz', kurzyOkno.prepinac && kurzyOkno.rucniPole);
  check('tlačítko Vyzkoušet', kurzyOkno.vyzkouset);
  check('tlačítko Aktualizovat kurz', kurzyOkno.aktualizovat);
  check('i Přepočítat kurzy ČNB', kurzyOkno.prepocitat);
  check('v automatickém režimu je ruční kurz schovaný', kurzyOkno.rucniSkryte);

  // Ruční kurz se uloží a označí jako ruční
  const rucni = await page.evaluate(async () => {
    document.getElementById('autoCourseChk').checked = false;
    toggleCourseMode();
    const videt = getComputedStyle(document.getElementById('manualRateWrap')).display !== 'none';
    document.getElementById('eurRateInput').value = '25.5';
    saveSettings();
    await new Promise(r => setTimeout(r, 100));
    return {
      videt,
      kurz: eurRate,
      zdroj: localStorage.getItem('eurRateZdroj'),
      zavreno: !document.getElementById('kurzyOverlay'),
    };
  });
  check('po vypnutí automatiky se ruční pole ukáže', rucni.videt);
  check('ruční kurz se uloží', rucni.kurz === 25.5, String(rucni.kurz));
  check('a označí se jako ruční', rucni.zdroj === 'rucne', String(rucni.zdroj));
  check('Uložit okno zavře', rucni.zavreno);

  // Zpět se vrací do nastavení, ne ven z aplikace
  const zpet = await page.evaluate(async () => {
    openKurzyMen();
    await new Promise(r => setTimeout(r, 120));
    document.getElementById('kurzyBack').click();
    await new Promise(r => setTimeout(r, 120));
    const r = {
      kurzyZavrene: !document.getElementById('kurzyOverlay'),
      nastaveniOtevrene: document.getElementById('moSettings').classList.contains('open'),
    };
    cm('moSettings');
    return r;
  });
  check('Zpět zavře kurzy', zpet.kurzyZavrene);
  check('a vrátí se do nastavení', zpet.nastaveniOtevrene, 'jinak by člověk vypadl ven');

  // ══════════════════════════════════════════════════════════════
  /* Celá cesta peněz najednou: kurz z konektoru → uložení u položky →
     zisk → doklad. Jednotlivé kusy mají testy výš; tohle hlídá, že
     do sebe zapadají. Nákup a payout mají schválně různé kurzy —
     kdyby se použil jeden na obojí, zisk vyjde jinak. */
  section('10) Celý řetěz od kurzu po doklad');
  const retez = await page.evaluate(async () => {
    const KURZY = { '2026-06-01': 24.80, '2026-08-12': 24.19 };
    const puvodniFetch = window.fetch, puvodniOpen = window.open;
    window.fetch = function (u) {
      const m = /\/kurz\/(\d{4}-\d{2}-\d{2})/.exec(String(u));
      if (m && KURZY[m[1]]) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ kurz: KURZY[m[1]], datum: m[1], zdroj: 'cnb' }) });
      }
      return Promise.reject(new Error('mimo ČNB: ' + u));
    };
    window.open = function () { return { document: { write: function (h) { window.__d = h; }, close: function () {} } }; };
    saveKonektorUrl('https://sklad.ucet.workers.dev');
    savePayoutDetails({ Revolut: { ucet: '123456789/0100', iban: 'CZ6508000000192000145399' } });
    localStorage.setItem('sklad_seller_v1', JSON.stringify({ name: 'Michal Novák', ico: '12345678' }));
    Object.keys(localStorage).filter(k => k.indexOf('eurRate_') === 0).forEach(k => localStorage.removeItem(k));

    items = [{ id: 'e1', name: 'Jordan 4', category: 'sneakers', sku: 'CU1110', size: '43',
      buyPrice: 400, buyCurrency: 'EUR', buyDate: '2026-06-01',
      sellPriceOrig: 880, sellCurrency: 'EUR', sellPrice: 0, saleDate: '2026-08-05',
      saleState: 'waiting', waitState: 'payout', soldWhere: 'Klekt', dateAdded: 3, tags: [] }];

    // Vyplacení: kurz ke dni payoutu, nákup si drží kurz ke svému dni
    const it = items[0];
    const kurzP = await fetchRateForDate('2026-08-12');
    const zdrojP = _kurzZdroj;
    it.payoutRateEur = kurzP;
    if (zdrojP === 'cnb') it.payoutRateCnb = 1;
    it.buyRateEur = await fetchRateForDate('2026-06-01');
    it.payoutDate = '2026-08-12'; it.saleState = 'paid'; it.waitState = 'completed';
    it.payoutMethod = 'Revolut';
    it.sellPrice = Math.round(880 * kurzP * 100) / 100;
    it.profit = Math.round(it.sellPrice - 400 * it.buyRateEur);

    window.__d = null; openSaleDocument('e1');
    const html = window.__d || '';
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/[\u00a0\u202f]/g, ' ');
    window.fetch = puvodniFetch; window.open = puvodniOpen;
    saveKonektorUrl('');
    return {
      kurzP, zdrojP, kurzN: it.buyRateEur, prodejVKc: it.sellPrice, zisk: it.profit,
      dokladKurz: /kurz ČNB 24,19 Kč\/€ k 12\.08\.2026/.test(txt),
      dokladKc: /21 287,20 Kč/.test(txt),
      dokladIban: /IBAN CZ6508000000192000145399/.test(txt),
      dokladDatum: /Datum 12\.08\.2026/.test(txt),
      dokladStrany: /Dodavatel/.test(txt) && /Odběratel/.test(txt),
      bezPlatformy: !/Platforma/.test(txt),
      odkazCnb: /href="https:\/\/www\.cnb\.cz[^"]*date=12\.08\.2026"/.test(html),
    };
  });
  check('kurz payoutu přišel z ČNB přes konektor',
    retez.kurzP === 24.19 && retez.zdrojP === 'cnb', JSON.stringify([retez.kurzP, retez.zdrojP]));
  check('nákup si drží vlastní kurz ke svému dni', retez.kurzN === 24.8, String(retez.kurzN));
  check('prodej v korunách sedí', retez.prodejVKc === 21287.2, String(retez.prodejVKc));
  // 880 × 24,19 − 400 × 24,80 = 21 287,20 − 9 920 = 11 367,20
  check('zisk počítá každou stranu svým kurzem', retez.zisk === 11367,
    retez.zisk + ' — čekáno 11367 (880×24,19 − 400×24,80)');
  check('doklad má datum vyplacení', retez.dokladDatum);
  check('doklad má kurz ČNB i s datem', retez.dokladKurz);
  check('doklad má přepočet na koruny', retez.dokladKc);
  check('doklad odkazuje na kurzovní lístek ČNB', retez.odkazCnb);
  check('doklad má IBAN, protože prodej byl v eurech', retez.dokladIban);
  check('doklad má Dodavatele a Odběratele', retez.dokladStrany);
  check('a místo prodeje na něm není', retez.bezPlatformy);

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
