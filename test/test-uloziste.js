// Test: úložiště prohlížeče — plné, a co se pak nesmí stát.
//
// Tohle je scénář, kdy aplikace „funguje", ale nic si nepamatuje:
// localStorage má strop (na iPhonu kolem 5 MB) a při jeho překročení
// setItem vyhodí výjimku. Dokud se ta výjimka polykala prázdným catch,
// zařízení tiše přestalo ukládat — a při dalším otevření se objevila
// data stará i několik týdnů, k nerozeznání od aktuálních.
//
// Hlídá se dvojí: že se místo uvolní obětováním záloh (data jsou
// přednější) a že se stará kopie neukáže jako by byla dnešní.

const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SOUBOR = 'file://' + path.resolve(__dirname, '..', 'index.html');
const POLOZKY = [{ id: 'a', name: 'Boty', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }];

/* Falešná kvóta. Počítá se z toho, co v úložišti opravdu leží, takže
   uvolnění místa (smazání záloh) se projeví přesně jako v prohlížeči. */
function nasadKvotu() {
  window.__kvota = 0;          // 0 = vypnuto
  const puvodni = Storage.prototype.setItem;
  window.__setItemPrimo = function (k, v) { puvodni.call(localStorage, k, v); };
  Storage.prototype.setItem = function (k, v) {
    if (window.__kvota) {
      let obsazeno = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (kk === k) continue;
        obsazeno += kk.length + (localStorage.getItem(kk) || '').length;
      }
      if (obsazeno + k.length + String(v).length > window.__kvota) {
        const e = new Error('The quota has been exceeded.');
        e.name = 'QuotaExceededError';
        throw e;
      }
    }
    return puvodni.apply(this, arguments);
  };
}

async function otevri(browser, errs, znacka) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR(' + znacka + '): ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), POLOZKY);
  await page.goto(SOUBOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof sv === 'function' && Array.isArray(items) && items.length > 0,
    { timeout: 20000 });
  await page.evaluate(nasadKvotu);
  return page;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];

  // ══════════════════════════════════════════════════════════════
  /* Zálohy jsou pět celých kopií skladu a zaberou nejvíc místa. Když
     se přestane vejít to podstatné, obětují se ony — jinak zařízení
     drží týden staré zálohy a přitom nemá kam uložit dnešek. */
  section('1) Když dojde místo, obětují se zálohy');
  const p1 = await otevri(browser, errs, 1);
  const uklid = await p1.evaluate(async () => {
    // Napřed pořádně velké zálohy, ještě bez kvóty
    const balast = new Array(3).fill(0).map((_, i) => ({
      ts: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      label: 'test', count: 1, data: [{ id: 'x', vypln: 'q'.repeat(3000) }],
    }));
    window.__setItemPrimo('sklad_v3_snapshots', JSON.stringify(balast));
    const predtim = (localStorage.getItem('sklad_v3_snapshots') || '').length;

    // A teď strop tak nízko, že se položky vedle záloh nevejdou
    let obsazeno = 0;
    for (let i = 0; i < localStorage.length; i++) {
      obsazeno += localStorage.key(i).length + (localStorage.getItem(localStorage.key(i)) || '').length;
    }
    window.__kvota = obsazeno - 4000;

    items[0].note = 'nová změna, kterou si zařízení musí zapamatovat';
    sv();
    await new Promise(r => setTimeout(r, 100));
    const ulozeno = JSON.parse(localStorage.getItem('sklad_v3') || '[]');
    const vysledek = {
      predtim,
      zalohyPotom: (localStorage.getItem('sklad_v3_snapshots') || '').length,
      zapsano: !!(ulozeno[0] && ulozeno[0].note),
      razitko: localStorage.getItem('sklad_v3_savedAt'),
      dirty: localStorage.getItem('sklad_v3_dirty'),
      potiz: getPosledniPotiz(),
    };
    window.__kvota = 0;
    return vysledek;
  });
  check('zálohy tam opravdu byly', uklid.predtim > 5000, String(uklid.predtim));
  check('místo se uvolnilo na jejich úkor', uklid.zalohyPotom < uklid.predtim,
    uklid.predtim + ' → ' + uklid.zalohyPotom);
  check('a změna se uložila', uklid.zapsano, 'bez tohohle zařízení tiše zapomíná');
  check('razítko se posunulo', !!uklid.razitko, String(uklid.razitko));
  check('příznak neuložených změn je nastavený', uklid.dirty === '1', String(uklid.dirty));
  check('a nic se nehlásí jako potíž', !uklid.potiz, JSON.stringify(uklid.potiz));
  await p1.close();

  // ══════════════════════════════════════════════════════════════
  /* Když nepomůže ani obětování záloh, musí to být vidět. A hlavně:
     razítko se nesmí posunout — jinak by zařízení při dalším startu
     tvrdilo, že má novější data než cloud, a nabídlo by, že jimi
     cloud přepíše. Přepsalo by ho tou starou kopií. */
  section('2) Když nepomůže nic, ozve se to a razítko zůstane');
  const p2 = await otevri(browser, errs, 2);
  const marne = await p2.evaluate(async () => {
    const hlasky = [];
    const orig = window.showToast;
    window.showToast = function (m) { hlasky.push(String(m)); return orig.apply(this, arguments); };
    const razitkoPred = localStorage.getItem('sklad_v3_savedAt');
    window.__kvota = 1;   // nevejde se vůbec nic

    items[0].note = 'tohle se uložit nepodaří';
    sv();
    await new Promise(r => setTimeout(r, 100));
    const po1 = {
      hlasek: hlasky.length,
      potiz: getPosledniPotiz(),
      razitko: localStorage.getItem('sklad_v3_savedAt'),
      vPameti: items[0].note,
    };
    // Druhá změna už znovu neotravuje — hláška při každém ťuknutí by se přestala číst
    items[0].note = 'a tahle taky ne';
    sv();
    await new Promise(r => setTimeout(r, 100));
    const po2 = { hlasek: hlasky.length };

    window.__kvota = 0;
    window.showToast = orig;
    return { po1, po2, razitkoPred };
  });
  check('ozve se to', marne.po1.hlasek === 1, JSON.stringify(marne.po1.hlasek));
  check('a je to o úložišti prohlížeče', !!marne.po1.potiz && /úložiště prohlížeče/.test(marne.po1.potiz.text || ''),
    JSON.stringify(marne.po1.potiz));
  check('razítko se neposunulo', marne.po1.razitko === marne.razitkoPred,
    marne.razitkoPred + ' → ' + marne.po1.razitko);
  check('v paměti změna je — aplikace jede dál', marne.po1.vPameti === 'tohle se uložit nepodaří',
    String(marne.po1.vPameti));
  check('a podruhé už to neotravuje', marne.po2.hlasek === 1, String(marne.po2.hlasek));
  await p2.close();

  // ══════════════════════════════════════════════════════════════
  /* Jádro toho, co majitele štve: otevře sklad, vidí čísla a nemá jak
     poznat, že jsou z 20. 7. Proužek to říká rovnou, dokud se cloud
     neozve. */
  section('3) Stará kopie se nevydává za dnešek');
  const p3 = await otevri(browser, errs, 3);
  await p3.evaluate(installFakeFirestore);
  const pruh = await p3.evaluate(async () => {
    localStorage.setItem('sklad_v3_savedAt', new Date(Date.now() - 45 * 86400000).toISOString());
    window.CLOUD_TICHO_MS = 400;
    const el = document.getElementById('stareDataPruh');
    const pred = el ? getComputedStyle(el).display : 'chybí';

    // Přihlášení bez odpovědi z cloudu — přesně stav „appka běží, cloud mlčí"
    window._fbUser = { uid: 'u1', email: 'ja@sklad.cz' };
    document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: window._fbUser } }));
    await new Promise(r => setTimeout(r, 200));
    const cekani = { videt: getComputedStyle(el).display !== 'none', text: el.textContent, trida: el.className };

    await new Promise(r => setTimeout(r, 500));
    const ticho = { videt: getComputedStyle(el).display !== 'none', text: el.textContent, trida: el.className };

    // A teď cloud konečně odpoví
    if (typeof window.__emitSnapshot === 'function') window.__emitSnapshot();
    await new Promise(r => setTimeout(r, 600));
    const poCloudu = { videt: getComputedStyle(el).display !== 'none' };
    return { pred, cekani, ticho, poCloudu };
  });
  check('na začátku proužek nesvítí', pruh.pred === 'none', String(pruh.pred));
  check('u staré kopie se ozve', pruh.cekani.videt, 'proužek se neukázal');
  check('a řekne, z kdy ta data jsou', /uloženou kopii z/.test(pruh.cekani.text) && /\d{4}/.test(pruh.cekani.text),
    pruh.cekani.text);
  check('dokud se čeká, je to jen upozornění', pruh.cekani.trida === '', pruh.cekani.trida);
  check('když cloud mlčí dál, přitvrdí', pruh.ticho.trida === 'zle', pruh.ticho.trida);
  check('a řekne, že to není dnešní stav', /není dnešní stav|ne dnešní stav/.test(pruh.ticho.text),
    pruh.ticho.text);
  await p3.close();

  // ══════════════════════════════════════════════════════════════
  /* Když cloud odpoví, proužek musí zmizet — jinak by strašil pořád
     a přestal by se číst. A u čerstvé kopie se nesmí ukázat vůbec. */
  section('4) Po odpovědi cloudu proužek mizí');
  const p4 = await otevri(browser, errs, 4);
  await p4.evaluate(installFakeFirestore);
  const poSnimku = await p4.evaluate(async () => {
    localStorage.setItem('sklad_v3_savedAt', new Date(Date.now() - 45 * 86400000).toISOString());
    window.__store['users/u1/sklad/data'] = {
      savedAt: new Date().toISOString(),
      items: [{ id: 'a', name: 'Boty', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
        saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }],
    };
    window._fbUser = { uid: 'u1', email: 'ja@sklad.cz' };
    document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: window._fbUser } }));
    await new Promise(r => setTimeout(r, 300));
    const el = document.getElementById('stareDataPruh');
    const pred = getComputedStyle(el).display !== 'none';
    window.__emitSnapshot();
    await new Promise(r => setTimeout(r, 800));
    return { pred, po: getComputedStyle(el).display !== 'none' };
  });
  check('než cloud odpoví, proužek svítí', poSnimku.pred, 'nesvítil');
  check('po snímku zmizí', !poSnimku.po, 'zůstal viset');

  const cerstva = await p4.evaluate(async () => {
    schovejStaraData();
    localStorage.setItem('sklad_v3_savedAt', new Date().toISOString());
    ukazStaraData();
    await new Promise(r => setTimeout(r, 100));
    const el = document.getElementById('stareDataPruh');
    return getComputedStyle(el).display !== 'none';
  });
  check('u čerstvé kopie se neukáže vůbec', !cerstva, 'proužek u dnešních dat nemá co dělat');
  await p4.close();

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
