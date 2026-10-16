// Test: listování mezi kartami zákazníků šipkami (jako v detailu položky)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  for (const [w, h, jmeno] of [[1400, 900, 'počítač'], [390, 844, 'mobil']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await ctx.addInitScript(() => localStorage.setItem('sklad_v3', JSON.stringify([])));
    await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    section('1) Šipky na klávesnici (' + jmeno + ')');
    const ids = await page.evaluate(async () => {
      const ids = ['Adam Prvni', 'Bara Druha', 'Cyril Treti'].map(n => _crmCreateMinimal(n, 'b2c'));
      switchTab('customers');
      await new Promise(r => setTimeout(r, 300));
      renderCustomers();
      return [...document.querySelectorAll('#crmList .customer-card[data-cid]')].map(x => x.dataset.cid);
    });
    check('v seznamu jsou tři karty', ids.length === 3, JSON.stringify(ids));
    const jmenoVDetailu = () => page.evaluate(() => {
      const c = customers.find(x => x.id === crmDetailId); return c ? c.name : null; });
    await page.evaluate(id => openCustomerDetail(id), ids[0]);
    await page.waitForTimeout(200);
    const prvni = await jmenoVDetailu();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    check('→ otevře další kartu v pořadí seznamu', (await page.evaluate(() => crmDetailId)) === ids[1], await jmenoVDetailu());
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    check('← se vrátí', (await page.evaluate(() => crmDetailId)) === ids[0], await jmenoVDetailu());
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    check('z první ← jde dokola na poslední', (await page.evaluate(() => crmDetailId)) === ids[2], await jmenoVDetailu());
    const hlavicka = await page.evaluate(() => document.getElementById('crmDetailHeader').textContent);
    check('hlavička ukazuje novou kartu', /Cyril Treti/.test(hlavicka), hlavicka.slice(0, 80));
    check('okno zůstalo otevřené', await page.evaluate(() =>
      document.getElementById('customerDetailModal').classList.contains('open')));

    // Záložka se drží
    await page.evaluate(() => crmDetailTab('contacts'));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    check('zůstane stejná záložka', (await page.evaluate(() => crmDetailCurrentTab)) === 'contacts',
      await page.evaluate(() => crmDetailCurrentTab));

    section('2) Tlačítka v okně (' + jmeno + ')');
    const tlacitka = await page.evaluate(() => {
      const p = document.getElementById('crmDetailPrev'), n = document.getElementById('crmDetailNext');
      return { p: !!p && p.offsetParent !== null, n: !!n && n.offsetParent !== null };
    });
    check('tlačítka ‹ › jsou vidět', tlacitka.p && tlacitka.n, JSON.stringify(tlacitka));
    const pred = await page.evaluate(() => crmDetailId);
    await page.click('#crmDetailNext');
    await page.waitForTimeout(150);
    const po = await page.evaluate(() => crmDetailId);
    check('› přepne na další', po !== pred && ids.indexOf(po) === (ids.indexOf(pred) + 1) % 3, JSON.stringify([pred, po]));
    await page.click('#crmDetailPrev');
    await page.waitForTimeout(150);
    check('‹ přepne zpět', (await page.evaluate(() => crmDetailId)) === pred);

    section('3) Co se dít nesmí (' + jmeno + ')');
    // Filtr: listuje se jen mezi tím, co je vidět
    await page.evaluate(async () => {
      closeCustomerDetail();
      document.getElementById('crmSearch').value = 'a';   // Adam, Bara — Cyril ne
      renderCustomers();
    });
    const vidno = await page.evaluate(() => [...document.querySelectorAll('#crmList .customer-card[data-cid]')]
      .map(x => customers.find(c => c.id === x.dataset.cid).name));
    await page.evaluate(id => openCustomerDetail(id), ids[0]);
    await page.waitForTimeout(150);
    const projite = [];
    for (let i = 0; i < vidno.length + 1; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      projite.push(await jmenoVDetailu());
    }
    check('s filtrem se listuje jen mezi viditelnými', projite.every(n => vidno.includes(n)),
      JSON.stringify({ vidno, projite }));

    // Psaní v poli nepřepíná
    await page.evaluate(() => { document.getElementById('crmSearch').value = ''; renderCustomers(); });
    await page.evaluate(id => openCustomerDetail(id), ids[0]);
    await page.waitForTimeout(150);
    const pole = await page.evaluate(() => !!document.querySelector('#crmDetailContent input, #crmDetailContent textarea'));
    if (!pole) {
      await page.evaluate(() => {
        const i = document.createElement('input'); i.id = 'zkusebniPole';
        document.getElementById('crmDetailContent').appendChild(i); i.focus();
      });
    } else {
      await page.evaluate(() => document.querySelector('#crmDetailContent input, #crmDetailContent textarea').focus());
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    check('šipka v textovém poli kartu nepřepne', (await page.evaluate(() => crmDetailId)) === ids[0]);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    // Nad otevřenou úpravou se nelistuje
    await page.evaluate(id => openEditCustomerModal(id), ids[0]);
    await page.waitForTimeout(200);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    check('nad oknem úpravy šipka nic neotevře ani nepřepne', await page.evaluate((id) =>
      !document.getElementById('customerDetailModal').classList.contains('open')
      && crmEditId === id && document.getElementById('newCustomerModal').classList.contains('open'), ids[0]));
    await page.evaluate(() => document.getElementById('newCustomerModal').classList.remove('open'));

    // Zavřené okno: šipky nic nedělají
    await page.evaluate(() => closeCustomerDetail());
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    check('se zavřeným detailem šipka nic neotevře', await page.evaluate(() =>
      !document.getElementById('customerDetailModal').classList.contains('open') && crmDetailId === null));

    // Jediná karta: tlačítka schovaná
    await page.evaluate(() => { document.getElementById('crmSearch').value = 'Cyril'; renderCustomers(); });
    await page.evaluate(id => openCustomerDetail(id), ids[2]);
    await page.waitForTimeout(150);
    check('u jediné karty v seznamu tlačítka nejsou', await page.evaluate(() =>
      document.getElementById('crmDetailPrev').style.display === 'none'));
    // Detail karty, kterou seznam neukazuje (otevřený odjinud)
    await page.evaluate(id => openCustomerDetail(id), ids[0]);
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    check('karta mimo seznam se šipkou nepřepne', (await page.evaluate(() => crmDetailId)) === ids[0]);

    check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
