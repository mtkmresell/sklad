// Test: doručovací údaje u zákazníka (výdejní místo a adresa)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript(() => localStorage.setItem('sklad_v3', JSON.stringify([])));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ══════════════════════════════════════════════════════════════
  section('1) Pole jsou ve formuláři');
  const pole = await page.evaluate(() => ({
    pickup: !!document.getElementById('crmFldPickup'),
    address: !!document.getElementById('crmFldAddress'),
    popisPickup: (document.getElementById('crmFldPickup') || {}).previousElementSibling
      ? document.getElementById('crmFldPickup').previousElementSibling.textContent : null,
    placeholder: (document.getElementById('crmFldPickup') || {}).placeholder,
  }));
  check('pole pro výdejní místo existuje', pole.pickup, JSON.stringify(pole));
  check('pole pro adresu existuje', pole.address, JSON.stringify(pole));
  check('popisek říká, k čemu to je', /Výdejní místo/.test(pole.popisPickup || ''), pole.popisPickup);
  check('placeholder napovídá tvar', /Zásilkovna/.test(pole.placeholder || ''), pole.placeholder);

  // ══════════════════════════════════════════════════════════════
  section('2) Uložení a načtení');
  const ulozeno = await page.evaluate(async () => {
    const id = _crmCreateMinimal('Petra Svobodová', 'b2c');
    crmEditId = id; crmEditMode = 'b2c';
    document.getElementById('crmFldName').value = 'Petra Svobodová';
    document.getElementById('crmFldPickup').value = 'Zásilkovna Praha 7, Dělnická 12';
    document.getElementById('crmFldAddress').value = 'Dlouhá 5\nPraha 1, 11000';
    saveNewCustomer();
    await new Promise(r => setTimeout(r, 300));
    const c = customers.find(x => x.id === id);
    return { id: id, pickup: c.pickup, address: c.address };
  });
  check('výdejní místo se uloží', ulozeno.pickup === 'Zásilkovna Praha 7, Dělnická 12', ulozeno.pickup);
  check('adresa se uloží i s zalomením', /Dlouhá 5\nPraha 1/.test(ulozeno.address || ''), JSON.stringify(ulozeno.address));

  const nacteno = await page.evaluate(async (id) => {
    document.getElementById('crmFldPickup').value = '';
    document.getElementById('crmFldAddress').value = '';
    openEditCustomerModal(id);
    await new Promise(r => setTimeout(r, 300));
    return { pickup: document.getElementById('crmFldPickup').value,
      address: document.getElementById('crmFldAddress').value };
  }, ulozeno.id);
  check('při úpravě se pole předvyplní',
    nacteno.pickup === 'Zásilkovna Praha 7, Dělnická 12' && /Dlouhá 5/.test(nacteno.address), JSON.stringify(nacteno));

  // Úprava jiného pole doručení nesmaže
  const poUprave = await page.evaluate(async (id) => {
    openEditCustomerModal(id);
    await new Promise(r => setTimeout(r, 250));
    document.getElementById('crmFldNoteQuick').value = 'Platí hotově';
    saveNewCustomer();
    await new Promise(r => setTimeout(r, 300));
    const c = customers.find(x => x.id === id);
    return { pickup: c.pickup, address: c.address, pozn: c.note_quick };
  }, ulozeno.id);
  check('úprava poznámky doručení nezahodí',
    poUprave.pickup === 'Zásilkovna Praha 7, Dělnická 12' && /Dlouhá 5/.test(poUprave.address || ''), JSON.stringify(poUprave));

  // ══════════════════════════════════════════════════════════════
  section('3) Zobrazení v detailu zákazníka');
  const detail = await page.evaluate(async (id) => {
    openCustomerDetail(id);
    await new Promise(r => setTimeout(r, 400));
    crmDetailTab('contacts');
    await new Promise(r => setTimeout(r, 250));
    const el = document.getElementById('crmDetailContent');
    return { text: el.textContent.replace(/\s+/g, ' '),
      kopirovatelne: [...el.querySelectorAll('[data-copy]')].map(x => x.getAttribute('data-copy')) };
  }, ulozeno.id);
  check('v detailu je sekce Doručení', /Doručení/.test(detail.text), detail.text.slice(0, 200));
  check('a v ní výdejní místo', /Zásilkovna Praha 7/.test(detail.text), detail.text.slice(0, 250));
  check('i adresa', /Dlouhá 5/.test(detail.text), detail.text.slice(0, 250));
  check('údaje jdou zkopírovat kliknutím',
    detail.kopirovatelne.some(v => /Zásilkovna Praha 7/.test(v)), JSON.stringify(detail.kopirovatelne));

  // Bez vyplněných údajů se sekce nezobrazuje
  const prazdny = await page.evaluate(async () => {
    const id = _crmCreateMinimal('Bez adresy', 'b2c');
    openCustomerDetail(id);
    await new Promise(r => setTimeout(r, 400));
    crmDetailTab('contacts');
    await new Promise(r => setTimeout(r, 200));
    const t = document.getElementById('crmDetailContent').textContent;
    closeCustomerDetail();
    return t;
  });
  check('u zákazníka bez doručení sekce chybí', !/Doručení/.test(prazdny), prazdny.slice(0, 120));

  // ══════════════════════════════════════════════════════════════
  section('4) Synchronizace do cloudu');
  const cloud = await page.evaluate((id) => {
    const data = JSON.parse(localStorage.getItem('sklad_crm') || '{}');
    const c = (data.customers || []).find(x => x.id === id);
    return { vUlozisti: !!c, pickup: c ? c.pickup : null, address: c ? c.address : null };
  }, ulozeno.id);
  check('doručovací údaje jsou v uloženém CRM',
    cloud.vUlozisti && /Zásilkovna/.test(cloud.pickup || '') && /Dlouhá 5/.test(cloud.address || ''), JSON.stringify(cloud));

  // ══════════════════════════════════════════════════════════════
  section('5) Odkaz na výdejní místo — rozbor');
  const rozbor = await page.evaluate(() => ({
    zas: vydejnaRozbor('https://www.zasilkovna.cz/pobocky/praha-papirnictvi-u-zvonu'),
    packeta: vydejnaRozbor('https://www.packeta.com/cs/pobocky/1234'),
    ppl: vydejnaRozbor('https://www.ppl.cz/vydejni-mista/KM12345'),
    gmaps: vydejnaRozbor('https://www.google.com/maps/place/Pap%C3%ADrnictv%C3%AD+U+Zvonu,+Plze%C5%88sk%C3%A1+130%2F74,+150+00+Praha+5/@50.07,14.40,17z/data=!3m1'),
    kratky: vydejnaRozbor('https://maps.app.goo.gl/AbCdEf123'),
    cizi: vydejnaRozbor('https://example.com/neco'),
    js: vydejnaRozbor('javascript:alert(1)'),
    text: vydejnaRozbor('Zásilkovna Praha 7'),
    mezera: vydejnaRozbor('https://www.zasilkovna.cz/a b'),
    hledaniGoogle: vydejnaRozbor('https://www.google.com/search?q=zasilkovna'),
  }));
  check('Zásilkovna se pozná podle domény', rozbor.zas && rozbor.zas.dopravce === 'Zásilkovna', JSON.stringify(rozbor.zas));
  check('i pod jménem Packeta', rozbor.packeta && rozbor.packeta.dopravce === 'Zásilkovna', JSON.stringify(rozbor.packeta));
  check('PPL se pozná', rozbor.ppl && rozbor.ppl.dopravce === 'PPL', JSON.stringify(rozbor.ppl));
  check('u stránky dopravce se název nehádá', rozbor.zas && rozbor.zas.nazev === '', JSON.stringify(rozbor.zas));
  check('z Map Google se vezme název i adresa',
    rozbor.gmaps && rozbor.gmaps.nazev === 'Papírnictví U Zvonu, Plzeňská 130/74, 150 00 Praha 5', JSON.stringify(rozbor.gmaps));
  check('zkrácený odkaz z Map Google je odkaz, jen bez názvu',
    rozbor.kratky && rozbor.kratky.dopravce === 'Mapy Google' && rozbor.kratky.nazev === '', JSON.stringify(rozbor.kratky));
  check('neznámá doména je pořád odkaz', rozbor.cizi && rozbor.cizi.dopravce === '' && rozbor.cizi.host === 'example.com', JSON.stringify(rozbor.cizi));
  check('javascript: odkaz není', rozbor.js === null, JSON.stringify(rozbor.js));
  check('obyčejný text odkaz není', rozbor.text === null, JSON.stringify(rozbor.text));
  check('odkaz s mezerou se nebere', rozbor.mezera === null, JSON.stringify(rozbor.mezera));
  check('vyhledávání Googlu nejsou mapy', rozbor.hledaniGoogle && rozbor.hledaniGoogle.dopravce !== 'Mapy Google', JSON.stringify(rozbor.hledaniGoogle));

  // ══════════════════════════════════════════════════════════════
  section('6) Odkaz ve formuláři');
  const GMAPS = 'https://www.google.com/maps/place/Pap%C3%ADrnictv%C3%AD+U+Zvonu,+Plze%C5%88sk%C3%A1+130%2F74,+150+00+Praha+5/@50.07,14.40,17z';
  const form = await page.evaluate(async (GMAPS) => {
    const out = {};
    openNewCustomerModal();
    await new Promise(r => setTimeout(r, 250));
    out.poleJe = !!document.getElementById('crmFldPickupUrl');
    const url = document.getElementById('crmFldPickupUrl');
    const naz = document.getElementById('crmFldPickup');
    const hint = document.getElementById('crmPickupHint');
    url.value = GMAPS; url.dispatchEvent(new Event('input', { bubbles: true }));
    out.doplneno = naz.value; out.hint1 = hint.textContent;
    // Ručně napsaný název se nepřepisuje
    naz.value = 'Papírnictví u Zvonu (Anděl)';
    url.value = ''; url.dispatchEvent(new Event('input', { bubbles: true }));
    out.hintPrazdny = hint.textContent;
    url.value = GMAPS; url.dispatchEvent(new Event('input', { bubbles: true }));
    out.nepřepsáno = naz.value;
    // Odkaz vložený do pole s názvem se přestěhuje
    url.value = ''; naz.value = 'https://www.zasilkovna.cz/pobocky/praha-7';
    naz.dispatchEvent(new Event('input', { bubbles: true }));
    out.presunNazev = naz.value; out.presunUrl = url.value; out.hint2 = hint.textContent;
    // Nesmysl dá najevo, že to odkaz není
    url.value = 'zasilkovna praha'; url.dispatchEvent(new Event('input', { bubbles: true }));
    out.hint3 = hint.textContent;
    // Nové okno začíná prázdné
    document.getElementById('newCustomerModal').classList.remove('open');
    openNewCustomerModal();
    await new Promise(r => setTimeout(r, 200));
    out.znovuUrl = document.getElementById('crmFldPickupUrl').value;
    out.znovuHint = document.getElementById('crmPickupHint').textContent;
    return out;
  }, GMAPS).catch(e => ({ chyba: String(e) }));
  check('pole pro odkaz je ve formuláři', form.poleJe, JSON.stringify(form));
  check('odkaz z Map Google doplní prázdný název', form.doplneno === 'Papírnictví U Zvonu, Plzeňská 130/74, 150 00 Praha 5', form.doplneno);
  check('a nápověda to řekne', /Mapy Google/.test(form.hint1 || '') && /doplnil/.test(form.hint1 || ''), form.hint1);
  check('bez odkazu je nápověda prázdná', form.hintPrazdny === '', form.hintPrazdny);
  check('ručně napsaný název se nepřepíše', form.nepřepsáno === 'Papírnictví u Zvonu (Anděl)', form.nepřepsáno);
  check('odkaz vložený do názvu se přestěhuje do odkazu',
    form.presunNazev === '' && form.presunUrl === 'https://www.zasilkovna.cz/pobocky/praha-7' && /Zásilkovna/.test(form.hint2 || ''), JSON.stringify(form));
  check('text místo odkazu se ohlásí', /nevypadá jako odkaz/.test(form.hint3 || ''), form.hint3);
  check('nový zákazník začíná bez odkazu', form.znovuUrl === '' && form.znovuHint === '', JSON.stringify(form));

  // ══════════════════════════════════════════════════════════════
  section('7) Uložení a proklik v kartě');
  const karta = await page.evaluate(async () => {
    const out = {};
    const otevri = async (id) => {
      openCustomerDetail(id);
      await new Promise(r => setTimeout(r, 350));
      crmDetailTab('contacts');
      await new Promise(r => setTimeout(r, 200));
      const a = document.querySelector('#crmDetailContent .crm-vydejna-odkaz');
      const t = document.getElementById('crmDetailContent').textContent.replace(/\s+/g, ' ');
      closeCustomerDetail();
      return a ? { href: a.href, text: a.textContent, target: a.target, rel: a.rel, je: a.classList.contains('je-odkaz'), cely: t } : { cely: t };
    };
    const uloz = async (jmeno, pickup, url, pref) => {
      const id = _crmCreateMinimal(jmeno, 'b2c');
      if (pref) customers.find(x => x.id === id).delivery_preference = pref;
      openEditCustomerModal(id);
      await new Promise(r => setTimeout(r, 250));
      document.getElementById('crmFldPickup').value = pickup;
      document.getElementById('crmFldPickupUrl').value = url;
      saveNewCustomer();
      await new Promise(r => setTimeout(r, 300));
      return id;
    };
    const a = await uloz('Odkaz Zásilkovna', 'Papírnictví U Zvonu', 'https://www.zasilkovna.cz/pobocky/praha-papirnictvi-u-zvonu', 'zasilkovna');
    out.ulozeno = customers.find(x => x.id === a).pickup_url;
    out.a = await otevri(a);
    // Úprava jiného pole odkaz nezahodí
    openEditCustomerModal(a);
    await new Promise(r => setTimeout(r, 250));
    out.predvyplneno = document.getElementById('crmFldPickupUrl').value;
    out.hintPriUprave = document.getElementById('crmPickupHint').textContent;
    document.getElementById('crmFldNoteQuick').value = 'Vyzvedává po šesté';
    saveNewCustomer();
    await new Promise(r => setTimeout(r, 300));
    out.poUprave = customers.find(x => x.id === a).pickup_url;

    const b = await uloz('Bez odkazu', 'Papírnictví U Zvonu, Plzeňská 130/74', '', 'zasilkovna');
    out.b = await otevri(b);
    const c = await uloz('GLS box', 'GLS Box Praha 16 Radotín', '', 'gls');
    out.c = await otevri(c);
    const d = await uloz('Spatny odkaz', 'Výdejna', 'javascript:alert(1)', '');
    out.dUlozeno = customers.find(x => x.id === d).pickup_url;
    out.d = await otevri(d);
    const e = await uloz('Jen odkaz', '', 'https://www.ppl.cz/vydejni-mista/KM1', '');
    out.e = await otevri(e);
    out.cloud = (JSON.parse(localStorage.getItem('sklad_crm') || '{}').customers || []).find(x => x.id === a);
    out.cloud = out.cloud ? out.cloud.pickup_url : null;
    return out;
  }).catch(e => ({ chyba: String(e) }));
  check('odkaz se uloží', karta.ulozeno === 'https://www.zasilkovna.cz/pobocky/praha-papirnictvi-u-zvonu', JSON.stringify(karta).slice(0, 300));
  check('karta na něj prokliká', karta.a && karta.a.href === 'https://www.zasilkovna.cz/pobocky/praha-papirnictvi-u-zvonu', JSON.stringify(karta.a));
  check('v nové záložce a bez opener', karta.a && karta.a.target === '_blank' && /noopener/.test(karta.a.rel), JSON.stringify(karta.a));
  check('proklik je popsaný dopravcem', karta.a && /Zásilkovna/.test(karta.a.text) && karta.a.je, JSON.stringify(karta.a));
  check('úprava ho předvyplní i s nápovědou', karta.predvyplneno === karta.ulozeno && /Zásilkovna/.test(karta.hintPriUprave || ''), JSON.stringify([karta.predvyplneno, karta.hintPriUprave]));
  check('úprava jiného pole odkaz nezahodí', karta.poUprave === karta.ulozeno, karta.poUprave);
  check('bez odkazu se aspoň hledá v mapě', karta.b && /google\.com\/maps\/search/.test(karta.b.href || '') && /mapě/.test(karta.b.text) && !karta.b.je, JSON.stringify(karta.b));
  const qB = karta.b && karta.b.href ? decodeURIComponent(new URL(karta.b.href).searchParams.get('query') || '') : '';
  check('hledá se s dopravcem z Doručení', qB === 'Zásilkovna Papírnictví U Zvonu, Plzeňská 130/74', qB);
  const qC = karta.c && karta.c.href ? new URL(karta.c.href).searchParams.get('query') : '';
  check('dopravce, který už v názvu je, se nezdvojí', qC === 'GLS Box Praha 16 Radotín', qC);
  check('javascript: se neuloží', karta.dUlozeno === '', JSON.stringify(karta.dUlozeno));
  check('a v kartě z něj odkaz není', karta.d && !/^javascript/i.test(karta.d.href || ''), JSON.stringify(karta.d));
  check('samotný odkaz bez názvu vytvoří řádek', karta.e && /Výdejní místo\s*PPL/.test(karta.e.cely) && /ppl\.cz/.test(karta.e.href || ''), JSON.stringify(karta.e));
  check('odkaz jde s CRM do úložiště (a tím do cloudu)', karta.cloud === karta.ulozeno, karta.cloud);

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
