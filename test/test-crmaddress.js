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

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
