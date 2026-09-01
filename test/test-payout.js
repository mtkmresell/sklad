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

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
