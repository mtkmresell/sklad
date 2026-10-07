// Test: výkup od partnera — „Od koho" u nákupu se napojí na partnera v CRM
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const datum = (dnu) => new Date(Date.now() - dnu * DEN).toISOString().slice(0, 10);
const prazdnaKarta = (id, name) => ({ id, name, status: 'aktivni', rating: 0, contacts: [], contact_history: [] });
const CRM = {
  customers: [prazdnaKarta('c1', 'Honza')],
  partners: [Object.assign(prazdnaKarta('p1', 'StockBoy'), { contacts: [{ type: 'instagram', value: '@stockboy' }] })],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript((crm) => {
    localStorage.setItem('sklad_v3', JSON.stringify([]));
    localStorage.setItem('sklad_crm', JSON.stringify(crm));
  }, CRM);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // Přidá kus přes skutečný formulář. `pred` dostane šanci něco udělat před uložením.
  const pridej = (o) => page.evaluate(async (o) => {
    switchTab('stock');
    openAddModal();
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('fName').value = o.nazev;
    document.getElementById('fBuy').value = String(o.cena || 1000);
    document.getElementById('fWhere').value = o.kde || '';
    if (o.ks) document.getElementById('fQty').value = String(o.ks);
    const pole = document.getElementById('fFrom');
    pole.value = o.odKoho || '';
    pole.dispatchEvent(new Event('input', { bubbles: true }));
    const hint = document.getElementById('fFromHint');
    const napoveda = hint.style.display === 'none' ? '' : hint.textContent;
    document.getElementById('fFromDrop').style.display = 'none';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    return { napoveda, kusy: items.filter(i => i.name === o.nazev).map(i => ({ id: i.id, from: i.from, pid: i.fromPartnerId, ceka: i.fromPartnerCeka })) };
  }, o);
  const partneri = () => page.evaluate(() => partners.map(p => ({ id: p.id, name: p.name })));
  const zakaznici = () => page.evaluate(() => customers.map(c => ({ id: c.id, name: c.name })));
  const podleJmena = (seznam, jmeno) => seznam.filter(p => p.name.trim().toLowerCase() === jmeno.toLowerCase());

  // ══════════════════════════════════════════════════════════════
  section('1) Nový kus s „Od koho" založí partnera a napojí se na něj');
  let r = await pridej({ nazev: 'Kus A', cena: 2200, kde: 'Discord', odKoho: 'mazuric' });
  check('nápověda předem řekne, že se partner založí',
    /Uložením se založí partner/.test(r.napoveda) && /mazuric/.test(r.napoveda), r.napoveda);
  let p = await partneri();
  const mazuric = podleJmena(p, 'mazuric');
  check('mezi partnery je mazuric, právě jednou', mazuric.length === 1, JSON.stringify(p));
  check('kus je na něj napojený', r.kusy.length === 1 && r.kusy[0].pid === (mazuric[0] || {}).id, JSON.stringify(r.kusy));
  check('a jméno v „Od koho" zůstalo', r.kusy[0].from === 'mazuric', JSON.stringify(r.kusy));
  /* Na screenshotu majitele bylo „Kde koupeno: Discord", ne „Výkup" —
     napojení na tom nesmí záviset */
  check('napojí se, i když „Kde koupeno" není Výkup', !!r.kusy[0].pid, JSON.stringify(r.kusy));
  const mazuricId = (mazuric[0] || {}).id;

  // ══════════════════════════════════════════════════════════════
  section('2) Stejný prodejce jinak napsaný — žádný druhý partner');
  r = await pridej({ nazev: 'Kus B', cena: 1800, kde: 'Discord', odKoho: '  Mazuric ' });
  check('nápověda hlásí napojení na existujícího', /Napojí se na partnera/.test(r.napoveda), r.napoveda);
  p = await partneri();
  check('mazuric je mezi partnery pořád jednou', podleJmena(p, 'mazuric').length === 1, JSON.stringify(p));
  check('druhý kus je na stejném partnerovi', r.kusy[0].pid === mazuricId, JSON.stringify(r.kusy));

  // ══════════════════════════════════════════════════════════════
  section('3) Výběr z nabídky');
  const nabidka = await page.evaluate(async () => {
    switchTab('stock');
    openAddModal();
    await new Promise(r => setTimeout(r, 150));
    const pole = document.getElementById('fFrom');
    pole.value = 'stock';
    pole.dispatchEvent(new Event('input', { bubbles: true }));
    const drop = document.getElementById('fFromDrop');
    const volby = [...drop.querySelectorAll('.vykup-opt')].map(o => o.textContent);
    const zalozit = !!drop.querySelector('.vykup-novy');
    const o = [...drop.querySelectorAll('.vykup-opt')].find(x => /StockBoy/.test(x.textContent));
    if (o) o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const out = { volby, zalozit, viditelna: drop.style.display, pole: pole.value,
      skryte: document.getElementById('fFromPartnerId').value,
      napoveda: document.getElementById('fFromHint').textContent };
    document.getElementById('fName').value = 'Kus C';
    document.getElementById('fBuy').value = '900';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    out.pid = (items.find(i => i.name === 'Kus C') || {}).fromPartnerId;
    return out;
  });
  check('nabídka ukazuje partnera i s kontaktem',
    nabidka.volby.some(v => /StockBoy/.test(v) && /@stockboy/.test(v)), JSON.stringify(nabidka.volby));
  check('a nabízí založit nového, protože „stock" nikdo není', nabidka.zalozit, JSON.stringify(nabidka));
  check('po výběru je v poli celé jméno', nabidka.pole === 'StockBoy' && nabidka.skryte === 'p1', JSON.stringify(nabidka));
  check('nápověda ukazuje napojeného partnera', /Partner v CRM: StockBoy/.test(nabidka.napoveda), nabidka.napoveda);
  check('kus se uložil na vybraného partnera', nabidka.pid === 'p1', JSON.stringify(nabidka));

  // ══════════════════════════════════════════════════════════════
  section('4) Zákazník stejného jména se nepoužije');
  /* Výkup je obchod s jiným prodejcem. „Honza" mezi zákazníky je jiný
     člověk — do jeho historie výkup nepatří. */
  r = await pridej({ nazev: 'Kus D', cena: 500, odKoho: 'Honza' });
  p = await partneri();
  const honza = podleJmena(p, 'Honza');
  check('založil se partner Honza', honza.length === 1, JSON.stringify(p));
  check('kus není napojený na zákazníka c1', r.kusy[0].pid && r.kusy[0].pid !== 'c1', JSON.stringify(r.kusy));
  check('zákazník Honza zůstal jen jeden a beze změny',
    JSON.stringify(await zakaznici()) === JSON.stringify([{ id: 'c1', name: 'Honza' }]), JSON.stringify(await zakaznici()));

  // ══════════════════════════════════════════════════════════════
  section('5) Prázdné pole nic nezakládá, vymazání odpojí');
  const predtim = (await partneri()).length;
  r = await pridej({ nazev: 'Kus E', cena: 700, odKoho: '' });
  check('kus bez „Od koho" nemá partnera', !r.kusy[0].pid, JSON.stringify(r.kusy));
  check('a žádný partner nepřibyl', (await partneri()).length === predtim, String((await partneri()).length));
  const prazdneKlice = await page.evaluate(() => {
    const it = items.find(i => i.name === 'Kus E');
    return ['fromPartnerId', 'fromPartnerCeka'].filter(k => k in it);
  });
  check('prázdné klíče se do položky neukládají', prazdneKlice.length === 0, JSON.stringify(prazdneKlice));

  const odpojeni = await page.evaluate(async () => {
    const it = items.find(i => i.name === 'Kus B');
    openEdit(it.id);
    await new Promise(r => setTimeout(r, 150));
    const predtim = document.getElementById('fFrom').value;
    document.getElementById('fFrom').value = '';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    const po = items.find(i => i.name === 'Kus B');
    return { predtim, pid: po.fromPartnerId, from: po.from };
  });
  check('v úpravě je jméno partnera předvyplněné', /mazuric/i.test(odpojeni.predtim), JSON.stringify(odpojeni));
  check('po vymazání pole je kus odpojený', !odpojeni.pid && !odpojeni.from, JSON.stringify(odpojeni));
  check('partner mazuric přitom zůstal', podleJmena(await partneri(), 'mazuric').length === 1);

  // ══════════════════════════════════════════════════════════════
  section('6) Víc kusů najednou');
  r = await pridej({ nazev: 'Kus F', cena: 300, ks: 3, odKoho: 'Trio' });
  p = await partneri();
  check('tři kusy, jeden partner Trio', r.kusy.length === 3 && podleJmena(p, 'Trio').length === 1, JSON.stringify(r.kusy));
  check('všechny tři jsou na něm', r.kusy.every(k => k.pid === podleJmena(p, 'Trio')[0].id), JSON.stringify(r.kusy));

  // ══════════════════════════════════════════════════════════════
  section('7) Karta partnera — historie, přehled, seznam');
  const karta = await page.evaluate(async (pid) => {
    // Druhý výkup v eurech (kurz ke dni nákupu) a prodej zpátky témuž partnerovi
    items.unshift({ id: 'eur1', name: 'Eurový kus', category: 'sneakers', buyPrice: 100, buyCurrency: 'EUR',
      buyRateEur: 25, buyDate: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10),
      saleState: 'stock', location: 'Doma', dateAdded: Date.now(), tags: [], from: 'mazuric', fromPartnerId: pid });
    const a = items.find(i => i.name === 'Kus A');
    a.buyDate = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
    items.unshift({ id: 'sale1', name: 'Prodaný kus', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
      saleState: 'paid', sellPrice: 3000, saleDate: new Date().toISOString().slice(0, 10),
      dateAdded: Date.now(), tags: [], linkedCustomerId: pid, buyerType: 'b2b' });
    switchTab('customers');
    crmSwitchMode('b2b');
    await new Promise(r => setTimeout(r, 200));
    const card = document.querySelector('.customer-card[data-cid="' + pid + '"]');
    const naKarte = card ? card.textContent : '';
    openCustomerDetail(pid);
    await new Promise(r => setTimeout(r, 200));
    const prehled = document.querySelector('#crmDetailContent .crm-vykupy');
    const prehledText = prehled ? prehled.textContent.replace(/\s+/g, ' ') : '';
    crmDetailTab('history');
    await new Promise(r => setTimeout(r, 200));
    const radky = [...document.querySelectorAll('#crmDetailContent > div > div')]
      .map(d => d.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    closeCustomerDetail();
    return { naKarte, prehledText, radky };
  }, mazuricId);
  check('na kartě v seznamu je počet výkupů', /🛒 2 výkupy/.test(karta.naKarte), karta.naKarte);
  check('přehled má sekci Výkupy od partnera', /Výkupy od partnera/.test(karta.prehledText), karta.prehledText);
  check('dva kusy za 2 200 Kč + 100 € × 25 = 4 700 Kč',
    /Kusů ?2/.test(karta.prehledText) && /4\s?700 Kč/.test(karta.prehledText.replace(/ | /g, ' ')), karta.prehledText);
  const vykupy = karta.radky.filter(t => /Výkup/.test(t));
  const prodeje = karta.radky.filter(t => /Prodej/.test(t) && !/Výkup/.test(t));
  check('historie má oba výkupy', vykupy.length === 2 && vykupy.some(t => /Kus A/.test(t)) && vykupy.some(t => /Eurový kus/.test(t)),
    JSON.stringify(karta.radky));
  check('i s cenou v původní měně', vykupy.some(t => /100 €/.test(t)) && vykupy.some(t => /2\s?200 Kč/.test(t.replace(/ | /g, ' '))),
    JSON.stringify(vykupy));
  check('a vedle nich prodej témuž partnerovi', prodeje.some(t => /Prodaný kus/.test(t)), JSON.stringify(karta.radky));
  check('nejnovější nahoře: prodej, eurový výkup, Kus A',
    karta.radky.findIndex(t => /Prodaný kus/.test(t)) < karta.radky.findIndex(t => /Eurový kus/.test(t))
    && karta.radky.findIndex(t => /Eurový kus/.test(t)) < karta.radky.findIndex(t => /Kus A/.test(t)),
    JSON.stringify(karta.radky));
  const zakaznikHonza = await page.evaluate(() => {
    crmSwitchMode('b2c');
    openCustomerDetail('c1');
    crmDetailTab('history');
    const t = document.getElementById('crmDetailContent').textContent;
    closeCustomerDetail();
    return t;
  });
  check('zákazník Honza výkup v historii nemá', !/Výkup/.test(zakaznikHonza) && !/Kus D/.test(zakaznikHonza), zakaznikHonza.slice(0, 200));

  // ══════════════════════════════════════════════════════════════
  section('8) Detail položky odkazuje na partnera');
  const detail = await page.evaluate(async () => {
    switchTab('stock');
    const it = items.find(i => i.name === 'Kus A');
    openDetail(it.id);
    await new Promise(r => setTimeout(r, 300));
    const odkaz = document.querySelector('#moDetail .od-koho-partner');
    const text = odkaz ? odkaz.textContent : '';
    if (odkaz) odkaz.click();
    await new Promise(r => setTimeout(r, 300));
    const out = { text, crm: document.getElementById('customerDetailModal').classList.contains('open'),
      mode: crmMode, nadpis: document.getElementById('crmDetailHeader').textContent };
    closeCustomerDetail();
    return out;
  });
  check('„Od koho" je odkaz s jménem partnera', /mazuric/.test(detail.text), JSON.stringify(detail));
  check('klik otevře jeho kartu', detail.crm && /mazuric/.test(detail.nadpis), JSON.stringify(detail));
  check('a seznam pod ní je přepnutý na partnery', detail.mode === 'b2b', JSON.stringify(detail));

  // ══════════════════════════════════════════════════════════════
  section('9) Přejmenovaný partner');
  const prejm = await page.evaluate(async (pid) => {
    partners.find(x => x.id === pid).name = 'Mazuric (Discord)';
    const it = items.find(i => i.name === 'Kus A');
    switchTab('stock');
    openEdit(it.id);
    await new Promise(r => setTimeout(r, 150));
    const vPoli = document.getElementById('fFrom').value;
    document.getElementById('fBuy').value = '2300';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    return { vPoli, pid: items.find(i => i.name === 'Kus A').fromPartnerId,
      pocet: partners.filter(x => /mazuric/i.test(x.name)).length };
  }, mazuricId);
  check('v úpravě je nové jméno', prejm.vPoli === 'Mazuric (Discord)', JSON.stringify(prejm));
  check('uložení nezaloží druhého a napojení drží', prejm.pocet === 1 && prejm.pid === mazuricId, JSON.stringify(prejm));

  // ══════════════════════════════════════════════════════════════
  section('10) Stará položka se jménem bez karty');
  /* Úprava ceny u starého výkupu nesmí sama zakládat karty — jinak by se
     smazaný partner vracel s každou úpravou kusu, který se od něj koupil. */
  const stara = await page.evaluate(async () => {
    items.unshift({ id: 'old1', name: 'Starý výkup', category: 'sneakers', buyPrice: 800, buyCurrency: 'CZK',
      saleState: 'stock', location: 'Doma', dateAdded: Date.now(), tags: [], buyWhere: 'Výkup', from: 'Pepa z bazaru' });
    items.unshift({ id: 'old2', name: 'Starý od StockBoye', category: 'sneakers', buyPrice: 800, buyCurrency: 'CZK',
      saleState: 'stock', location: 'Doma', dateAdded: Date.now(), tags: [], from: 'stockboy' });
    const pred = partners.length;
    switchTab('stock');
    openEdit('old1');
    await new Promise(r => setTimeout(r, 150));
    const napoveda = document.getElementById('fFromHint').textContent;
    document.getElementById('fBuy').value = '850';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    const po1 = partners.length;
    const it1 = items.find(i => i.id === 'old1');
    openEdit('old2');
    await new Promise(r => setTimeout(r, 150));
    const napoveda2 = document.getElementById('fFromHint').textContent;
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    const it2 = items.find(i => i.id === 'old2');
    // Výslovné „Založit" v nabídce kartu založí
    openEdit('old1');
    await new Promise(r => setTimeout(r, 150));
    const pole = document.getElementById('fFrom');
    pole.dispatchEvent(new Event('input', { bubbles: true }));
    const novy = document.querySelector('#fFromDrop .vykup-novy');
    if (novy) novy.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const napoveda3 = document.getElementById('fFromHint').textContent;
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    const it3 = items.find(i => i.id === 'old1');
    return { napoveda, pred, po1, pid1: it1.fromPartnerId || '', from1: it1.from,
      napoveda2, pid2: it2.fromPartnerId || '', napoveda3, pid3: it3.fromPartnerId || '',
      pepa: partners.filter(x => x.name === 'Pepa z bazaru').length };
  });
  check('nápověda řekne, že karta chybí a jak ji založit', /Bez karty partnera/.test(stara.napoveda), stara.napoveda);
  check('úprava ceny kartu nezaložila', stara.po1 === stara.pred && !stara.pid1, JSON.stringify(stara));
  check('jméno zůstalo', stara.from1 === 'Pepa z bazaru', JSON.stringify(stara));
  check('na existujícího partnera stejného jména se ale napojí', stara.pid2 === 'p1' && /Napojí se na partnera/.test(stara.napoveda2),
    JSON.stringify(stara));
  check('výslovné „Založit" v nabídce kartu založí',
    /Uložením se založí/.test(stara.napoveda3) && stara.pid3 && stara.pepa === 1, JSON.stringify(stara));

  // ══════════════════════════════════════════════════════════════
  section('11) Smazaný partner se nevrací');
  const smaz = await page.evaluate(async () => {
    const t = partners.find(x => x.name === 'Trio');
    switchTab('customers');
    crmSwitchMode('b2b');
    deleteCustomer(t.id);
    await new Promise(r => setTimeout(r, 100));
    const ov = [...document.querySelectorAll('div')].find(d => d.style.position === 'fixed' && /Smazat partnera/.test(d.textContent));
    const hlaska = ov ? ov.textContent : '';
    const ano = ov && [...ov.querySelectorAll('button')].find(b => b.textContent === 'Smazat');
    if (ano) ano.click();
    await new Promise(r => setTimeout(r, 600));
    const kusy = items.filter(i => i.name === 'Kus F');
    const out = { hlaska, zbyl: partners.some(x => x.name === 'Trio'),
      odpojene: kusy.every(i => !i.fromPartnerId), jmeno: kusy.every(i => i.from === 'Trio') };
    // Úprava kusu po smazání partnera ho nesmí vzkřísit
    switchTab('stock');
    openEdit(kusy[0].id);
    await new Promise(r => setTimeout(r, 150));
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    out.vzkrisen = partners.some(x => x.name === 'Trio');
    return out;
  });
  check('potvrzení řekne, že se výkupy odpojí', /3 výkupy se odpojí/.test(smaz.hlaska), smaz.hlaska.slice(0, 200));
  check('partner je pryč a kusy odpojené', !smaz.zbyl && smaz.odpojene, JSON.stringify(smaz));
  check('jméno prodejce u kusů zůstalo', smaz.jmeno, JSON.stringify(smaz));
  check('úprava kusu smazaného partnera nevzkřísí', !smaz.vzkrisen, JSON.stringify(smaz));

  // ══════════════════════════════════════════════════════════════
  section('12) CRM ještě nedorazilo z cloudu');
  /* Zápis CRM přepisuje celý dokument. Karta založená nad starou kopií
     by smazala, co mezitím přibylo na jiném zařízení. */
  const cekani = await page.evaluate(async () => {
    window._fbUser = { uid: 'zkouska' };   // přihlášený, bez _fbDb — zápis do cloudu se nekoná
    _crmCloudReady = false;
    _fbCloudReady = false;
    const pred = partners.length;
    switchTab('stock');
    openAddModal();
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('fName').value = 'Pozdní kus';
    document.getElementById('fBuy').value = '600';
    document.getElementById('fFrom').value = 'Pozdní prodejce';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    const it = items.find(i => i.name === 'Pozdní kus');
    const out = { pred, po: partners.length, pid: it.fromPartnerId || '', ceka: it.fromPartnerCeka };
    // Existující partner se napojí i tak — nic se nezakládá
    openAddModal();
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('fName').value = 'Kus od známého';
    document.getElementById('fBuy').value = '600';
    document.getElementById('fFrom').value = 'StockBoy';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    const zn = items.find(i => i.name === 'Kus od známého');
    out.znamy = zn.fromPartnerId; out.znamyCeka = zn.fromPartnerCeka;
    // Úprava čekajícího kusu (CRM pořád nedorazilo) mu čekání nesmí vzít
    openEdit(it.id);
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('fBuy').value = '650';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    out.cekaPoUprave = items.find(i => i.name === 'Pozdní kus').fromPartnerCeka;
    // Kus napojený na partnera, kterého tohle zařízení ještě nezná (vznikl jinde)
    items.unshift({ id: 'cizi1', name: 'Kus z jiného zařízení', category: 'sneakers', buyPrice: 400, buyCurrency: 'CZK',
      saleState: 'stock', location: 'Doma', dateAdded: Date.now(), tags: [], from: 'Nový z mobilu', fromPartnerId: 'pZJinud' });
    openEdit('cizi1');
    await new Promise(r => setTimeout(r, 150));
    out.ciziNapoveda = document.getElementById('fFromHint').textContent;
    document.getElementById('fBuy').value = '450';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
    out.ciziPid = items.find(i => i.id === 'cizi1').fromPartnerId;
    out.ciziPartneru = partners.filter(x => x.name === 'Nový z mobilu').length;
    // CRM dorazilo, sklad ještě ne — položky se měnit nesmí
    _crmCloudReady = true;
    out.jenCrm = vykupDopojCekajici();
    out.poJenCrm = items.find(i => i.name === 'Pozdní kus').fromPartnerCeka;
    // Dorazil i sklad
    _fbCloudReady = true;
    out.oba = vykupDopojCekajici();
    const po = items.find(i => i.name === 'Pozdní kus');
    out.pidPo = po.fromPartnerId || ''; out.cekaPo = po.fromPartnerCeka;
    out.partner = (partners.find(x => x.id === po.fromPartnerId) || {}).name;
    out.podruhe = vykupDopojCekajici();
    window._fbUser = undefined;
    return out;
  });
  check('partner se nezaložil', cekani.po === cekani.pred && !cekani.pid, JSON.stringify(cekani));
  check('kus si poznamenal, že čeká', cekani.ceka === 1, JSON.stringify(cekani));
  check('na existujícího partnera se napojil hned', cekani.znamy === 'p1' && !cekani.znamyCeka, JSON.stringify(cekani));
  check('úprava čekajícího kusu mu čekání nevezme', cekani.cekaPoUprave === 1, JSON.stringify(cekani));
  check('kus napojený na partnera, kterého zařízení nezná, zůstane napojený',
    cekani.ciziPid === 'pZJinud' && cekani.ciziPartneru === 0, JSON.stringify(cekani));
  check('a nápověda řekne proč', /CRM se ještě načítá/.test(cekani.ciziNapoveda), cekani.ciziNapoveda);
  check('dokud nedorazil sklad, nic se nemění', cekani.jenCrm === 0 && cekani.poJenCrm === 1, JSON.stringify(cekani));
  check('po doletu obou snímků se partner založí a kus napojí',
    cekani.oba === 1 && cekani.partner === 'Pozdní prodejce' && !cekani.cekaPo, JSON.stringify(cekani));
  check('a podruhé už není co dělat', cekani.podruhe === 0, JSON.stringify(cekani));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
