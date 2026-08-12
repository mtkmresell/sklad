// Test: cardmarket v dropdownu kontaktů + proklik na profil
const { chromium } = require('playwright');
const path = require('path');
let failures = 0;
function check(n,c,e){ console.log((c?'PASS':'FAIL')+' — '+n+(c||e===undefined?'':' | '+e)); if(!c) failures++; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => { localStorage.setItem('sklad_v3', JSON.stringify([])); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3500);

  const cid = await page.evaluate(() => {
    var id = _crmCreateMinimal('Karetní Zákazník', 'b2c');
    switchTab('customers');
    return id;
  });
  await page.waitForTimeout(300);

  // ── 1) Dropdown v Upravit obsahuje cardmarket
  const opts = await page.evaluate(async (id) => {
    openEditCustomerModal(id);
    await new Promise(r => setTimeout(r, 700));
    var rows = document.getElementById('crmContactRows');
    var sel = rows.querySelector('select');
    return {
      values: [...sel.options].map(o => o.value),
      // custom dropdown zná stejné volby
      csOpts: [...(sel.closest('.cs-wrap')?.querySelectorAll('.cs-opt') || [])].map(o => o.textContent),
    };
  }, cid);
  check('dropdown obsahuje cardmarket', opts.values.includes('cardmarket'), JSON.stringify(opts.values));
  check('cardmarket je i v custom dropdownu', opts.csOpts.includes('cardmarket'), JSON.stringify(opts.csOpts));
  check('ostatní volby zůstaly', ['instagram','email','telefon','whatsapp','vinted','facebook','bazos','osobne','jine'].every(t => opts.values.includes(t)), JSON.stringify(opts.values));

  // ── 2) Uložení kontaktu typu cardmarket
  const saved = await page.evaluate(async (id) => {
    var rows = document.getElementById('crmContactRows');
    var sel = rows.querySelector('select');
    var inp = rows.querySelector('input[type="text"]');
    sel.value = 'cardmarket'; if (sel._csSync) sel._csSync();
    inp.value = 'mtkm_resell';
    saveNewCustomer();
    await new Promise(r => setTimeout(r, 700));
    var c = customers.find(x => x.id === id);
    return (c.contacts || []).map(ct => ({ type: ct.type, value: ct.value }));
  }, cid);
  check('kontakt cardmarket se uloží', saved.some(c => c.type === 'cardmarket' && c.value === 'mtkm_resell'), JSON.stringify(saved));

  // ── 3) V detailu je proklik na profil
  const link = await page.evaluate(async (id) => {
    openCustomerDetail(id);
    await new Promise(r => setTimeout(r, 400));
    crmDetailTab('contacts');
    await new Promise(r => setTimeout(r, 400));
    var row = [...document.querySelectorAll('.crm-contact-row')].find(r => /cardmarket/.test(r.textContent));
    var a = row ? row.querySelector('a') : null;
    return { href: a ? a.getAttribute('href') : null, target: a ? a.getAttribute('target') : null, txt: a ? a.textContent : null };
  }, cid);
  check('cardmarket má proklik na profil', link.href === 'https://www.cardmarket.com/en/Pokemon/Users/mtkm_resell', link.href);
  check('proklik se otevře v novém okně', link.target === '_blank', String(link.target));
  check('v textu je uživatelské jméno', link.txt === 'mtkm_resell', String(link.txt));

  // ── 4) Vložená celá adresa má přednost
  const full = await page.evaluate(() => _crmContactUrl('cardmarket', 'https://www.cardmarket.com/en/Magic/Users/nekdo'));
  check('vložená celá adresa se použije rovnou', full === 'https://www.cardmarket.com/en/Magic/Users/nekdo', full);

  // ── 5) Zavináč na začátku se odřízne
  const at = await page.evaluate(() => _crmContactUrl('cardmarket', '@mtkm_resell'));
  check('zavináč se odřízne', at === 'https://www.cardmarket.com/en/Pokemon/Users/mtkm_resell', at);

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0,3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
