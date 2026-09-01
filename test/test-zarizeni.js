// Test: souběh dvou zařízení — co se smí a nesmí stát cizím datům.
//
// Tohle je oblast, kde se ztrácely prodeje: člověk ráno zapnul aplikaci
// na druhém zařízení, něco udělal dřív, než Firestore stihl odpovědět,
// a včerejší stav přepsal ten dnešní. Žádný výpadek sítě k tomu nebyl
// potřeba, stačilo pár vteřin po startu.

const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

// Stav, který má zařízení v práci od včerejška: boty ještě na skladě
const VCEREJSI = [{ id: 'a', name: 'Boty', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }];

// Co mezitím zapsalo zařízení doma: prodej a nové místo prodeje
const CLOUD_DOMA = {
  savedAt: '2026-08-31T18:00:00.000Z',
  items: [{ id: 'a', name: 'Boty', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'waiting', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }],
  platGroups: JSON.stringify({ local: ['Vinted', 'Instagram'] }),
  paymentOpts: ['Revolut', 'Fio Banka'],
};

async function zarizeni(browser, opts) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**/firebasejs/**', route => route.abort());
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), opts.items);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof fbSaveToCloud === 'function' && Array.isArray(items) && items.length > 0,
    { timeout: 20000 });
  await page.evaluate((o) => {
    localStorage.setItem('sklad_v3_savedAt', o.savedAt);
    localStorage.setItem('sklad_plat_groups_v1', JSON.stringify({ local: ['Vinted'] }));
    localStorage.removeItem('sklad_v3_dirty');
  }, opts);
  await page.evaluate(installFakeFirestore);
  await page.evaluate((c) => { window.__store['users/u1/sklad/data'] = c; }, opts.cloud);
  /* Posluchač se rozjede až přihlášením. Snímek se ale sám neemituje —
     zařízení je tak přesně ve stavu „cloud ještě neodpověděl". */
  await page.evaluate(() => {
    window._fbUser = { uid: 'u1', email: 'ja@sklad.cz' };
    document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: window._fbUser } }));
  });
  await page.waitForFunction(() => typeof window.__emitSnapshot === 'function', { timeout: 10000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];

  // ══════════════════════════════════════════════════════════════
  /* Jádro věci. Zařízení, které ještě nedostalo snímek, netuší, co
     v cloudu je — a zápis by ho přepsal včerejškem. */
  section('1) Zápis před prvním snímkem cloud nepřepíše');
  const p1 = await zarizeni(browser, { items: VCEREJSI, savedAt: '2026-08-30T08:00:00.000Z', cloud: CLOUD_DOMA });
  p1.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  const predSnimkem = await p1.evaluate(async () => {
    const ready = window._fbCloudReady;
    items[0].note = 'něco jsem udělal hned po zapnutí';
    sv();
    await new Promise(r => setTimeout(r, 1200));
    const d = window.__store['users/u1/sklad/data'];
    return {
      cloudReady: ready,
      stav: ((d.itemsStock || d.items || [])[0] || {}).saleState,
      mista: d.platGroups,
      savedAt: d.savedAt,
      dirty: !!localStorage.getItem('sklad_v3_dirty'),
    };
  });
  check('zařízení opravdu snímek ještě nemělo', predSnimkem.cloudReady === false, String(predSnimkem.cloudReady));
  check('prodej v cloudu zůstal', predSnimkem.stav === 'waiting',
    'včerejší stav přepsal dnešní — přesně tak mizely prodeje');
  check('nové místo prodeje v cloudu zůstalo', /Instagram/.test(predSnimkem.mista || ''),
    'takhle mizel Instagram z nastavení');
  check('razítko cloudu se nezměnilo', predSnimkem.savedAt === CLOUD_DOMA.savedAt, predSnimkem.savedAt);
  check('změna se lokálně neztratila', predSnimkem.dirty, 'zůstává příznak neuložených změn');

  // ══════════════════════════════════════════════════════════════
  /* Snímek dorazil a je novější — vyhrává cloud. Lokální změna z toho
     okna se zahodí, ale je v záloze; to je správně, cloud je novější. */
  section('2) Po doletu snímku se to srovná podle cloudu');
  const poSnimku = await p1.evaluate(async () => {
    window.__emitSnapshot();
    await new Promise(r => setTimeout(r, 1500));
    const d = window.__store['users/u1/sklad/data'];
    return {
      vPameti: items[0].saleState,
      vCloudu: ((d.itemsStock || d.items || [])[0] || {}).saleState,
      mistaLokalne: localStorage.getItem('sklad_plat_groups_v1'),
      platby: JSON.parse(localStorage.getItem('sklad_payment_opts_v1') || '[]'),
      cloudReady: window._fbCloudReady,
    };
  });
  check('aplikace ukazuje prodej z cloudu', poSnimku.vPameti === 'waiting', String(poSnimku.vPameti));
  check('a cloud zůstal nedotčený', poSnimku.vCloudu === 'waiting', String(poSnimku.vCloudu));
  check('místa prodeje se dotáhla včetně Instagramu', /Instagram/.test(poSnimku.mistaLokalne || ''),
    String(poSnimku.mistaLokalne));
  check('i ostatní nastavení', poSnimku.platby.indexOf('Fio Banka') !== -1, JSON.stringify(poSnimku.platby));
  check('od téhle chvíle se ukládat smí', poSnimku.cloudReady === true);

  // ══════════════════════════════════════════════════════════════
  /* Až teď je zápis v pořádku — a musí projít, jinak by zařízení
     přestalo ukládat úplně. */
  section('3) Po snímku už zápis projde');
  const poteZapis = await p1.evaluate(async () => {
    items[0].saleState = 'paid';
    sv();
    await new Promise(r => setTimeout(r, 1200));
    const d = window.__store['users/u1/sklad/data'];
    return ((d.itemsStock || d.items || [])[0] || {}).saleState;
  });
  check('změna se do cloudu dostane', poteZapis === 'paid', String(poteZapis));
  await p1.close();

  // ══════════════════════════════════════════════════════════════
  /* Když je cloud starší a zařízení má neuložené změny, dopošlou se —
     jinak by se ztratilo to, co člověk udělal hned po zapnutí. */
  section('4) Starší cloud změnu z okna po startu dostane');
  const p2 = await zarizeni(browser, {
    items: VCEREJSI, savedAt: '2026-08-30T08:00:00.000Z',
    cloud: Object.assign({}, CLOUD_DOMA, { savedAt: '2026-08-20T08:00:00.000Z' }),
  });
  p2.on('pageerror', e => errs.push('PAGEERROR(2): ' + e.message));
  const dopravena = await p2.evaluate(async () => {
    // Změna dřív, než dorazí snímek
    items[0].saleState = 'waiting';
    sv();
    await new Promise(r => setTimeout(r, 700));
    // Uživatel v dotazu zvolí „nahrát moje změny"
    window.confirm = function () { return true; };
    window.__emitSnapshot();
    await new Promise(r => setTimeout(r, 2000));
    const d = window.__store['users/u1/sklad/data'];
    return ((d.itemsStock || d.items || [])[0] || {}).saleState;
  });
  check('změna z okna po startu se doposlala', dopravena === 'waiting', String(dopravena));
  await p2.close();

  // ══════════════════════════════════════════════════════════════
  /* Zařízení, které jen leží zapnuté a nic nedělá, nesmí cloudu ublížit. */
  section('5) Nečinné zařízení cloudu neublíží');
  const p3 = await zarizeni(browser, { items: VCEREJSI, savedAt: '2026-08-30T08:00:00.000Z', cloud: CLOUD_DOMA });
  p3.on('pageerror', e => errs.push('PAGEERROR(3): ' + e.message));
  const necinne = await p3.evaluate(async () => {
    await new Promise(r => setTimeout(r, 1500));
    const d = window.__store['users/u1/sklad/data'];
    return { stav: ((d.itemsStock || d.items || [])[0] || {}).saleState, savedAt: d.savedAt, commits: window.__commits };
  });
  check('cloud se nezměnil', necinne.stav === 'waiting' && necinne.savedAt === CLOUD_DOMA.savedAt,
    JSON.stringify(necinne));
  check('a nic se nezapisovalo', necinne.commits === 0, String(necinne.commits));
  await p3.close();

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
