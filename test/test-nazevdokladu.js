// Test: název souboru pro nákupní doklad.
//
// Doklady leží v OneDrive a jmenují se DD.MM.RR_kde_objednávka_SKU_velikost
// (03.09.26_Nike_C0415156_1544H-54_EU43). Skládá se to z položky, takže
// stačí kliknout na nadpis „Nákup" v detailu a název je ve schránce.
//
// Hlídá se tvar do písmene — název se vkládá do OneDrive, kde se pak
// podle něj doklady hledají, takže odchylka v oddělovači nebo v pořadí
// je poznat až po čase a na hromadě souborů.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SOUBOR = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Přesně ta položka, ze které je příklad v zadání
const VZOR = {
  id: 'vzor', name: 'Nike Dunk Low', category: 'sneakers', condition: 'DS',
  buyPrice: 3000, buyCurrency: 'CZK', buyDate: '2026-09-03', buyWhere: 'Nike',
  orderNum: 'C0415156', sku: '1544H-54', size: '43',
  saleState: 'stock', location: 'Doma', dateAdded: 1, tags: [],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), [VZOR]);
  await page.goto(SOUBOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof nazevSouboruDokladu === 'function', { timeout: 20000 });

  // ══════════════════════════════════════════════════════════════
  section('1) Tvar názvu');
  const nazvy = await page.evaluate((vzor) => {
    const s = (zmena) => nazevSouboruDokladu(Object.assign({}, vzor, zmena || {}));
    return {
      vzor: s(),
      bezSku: s({ sku: '' }),
      bezObj: s({ orderNum: '' }),
      bezVelikosti: s({ size: '' }),
      mrizka: s({ orderNum: '#01KM5ZKQ5ECM4OYQNZ23RH9MOJ' }),
      mezery: s({ buyWhere: 'Foot Locker' }),
      lomitko: s({ buyWhere: 'A/B:C' }),
      podtrzitko: s({ sku: 'AB_CD' }),
      obleceni: s({ category: 'obleceni', size: 'M' }),
      usVelikost: s({ size: '43 / US 9.5' }),
      prazdna: nazevSouboruDokladu({ id: 'x', category: 'sneakers' }),
    };
  }, VZOR);
  check('sedí na příklad ze zadání', nazvy.vzor === '03.09.26_Nike_C0415156_1544H-54_EU43', nazvy.vzor);
  check('bez SKU se nevynechá jen ono', nazvy.bezSku === '03.09.26_Nike_C0415156_EU43', nazvy.bezSku);
  check('a nezůstane po něm prázdné místo', !/__/.test(nazvy.bezSku), nazvy.bezSku);
  check('bez čísla objednávky taky', nazvy.bezObj === '03.09.26_Nike_1544H-54_EU43', nazvy.bezObj);
  check('bez velikosti taky', nazvy.bezVelikosti === '03.09.26_Nike_C0415156_1544H-54', nazvy.bezVelikosti);
  check('mřížka z čísla objednávky pryč',
    nazvy.mrizka === '03.09.26_Nike_01KM5ZKQ5ECM4OYQNZ23RH9MOJ_1544H-54_EU43', nazvy.mrizka);
  check('mezery v místě nákupu pryč', nazvy.mezery === '03.09.26_FootLocker_C0415156_1544H-54_EU43',
    nazvy.mezery);
  check('a znaky, co v názvu souboru být nesmí, taky',
    nazvy.lomitko === '03.09.26_ABC_C0415156_1544H-54_EU43', nazvy.lomitko);
  check('podtržítko uvnitř části se nepoplete s oddělovačem',
    nazvy.podtrzitko === '03.09.26_Nike_C0415156_AB-CD_EU43', nazvy.podtrzitko);
  check('u oblečení se EU nepředsazuje', nazvy.obleceni === '03.09.26_Nike_C0415156_1544H-54_M',
    nazvy.obleceni);
  check('americká velikost za lomítkem se nebere', nazvy.usVelikost === nazvy.vzor, nazvy.usVelikost);
  check('u prázdné položky nevznikne nic', nazvy.prazdna === '', JSON.stringify(nazvy.prazdna));

  // ══════════════════════════════════════════════════════════════
  /* Kliká se na nadpis „Nákup" — schválně, tlačítko navíc by v detailu
     zabíralo místo. Nadpis proto musí být opravdu ten klikací. */
  section('2) Kliknutí na nadpis Nákup');
  const detail = await page.evaluate(async () => {
    openDetail('vzor');
    await new Promise(r => setTimeout(r, 200));
    const mo = document.getElementById('moDetail');
    const nadpisy = [].slice.call(mo.querySelectorAll('[data-action="copytext"]'));
    const nakup = nadpisy.find(n => n.textContent.trim() === 'Nákup');
    if (!nakup) return { nasel: false, kolik: nadpisy.length };
    let text = '';
    try { text = decodeURIComponent(nakup.dataset.text); } catch (e) { text = nakup.dataset.text; }
    const kurzor = getComputedStyle(nakup).cursor;
    const tip = nakup.getAttribute('data-tip') || '';
    nakup.click();
    await new Promise(r => setTimeout(r, 200));
    return { nasel: true, text: text, kurzor: kurzor, tip: tip, poKliknuti: nakup.textContent.trim() };
  });
  check('nadpis Nákup je klikací', detail.nasel, 'v detailu se nenašel');
  check('a nese celý název souboru', detail.text === '03.09.26_Nike_C0415156_1544H-54_EU43', detail.text);
  check('ukazuje to i kurzor', detail.kurzor === 'pointer', detail.kurzor);
  check('a napoví, co se zkopíruje', /Zkopírovat název souboru/.test(detail.tip), detail.tip);
  check('po kliknutí to potvrdí', /Zkopírováno/.test(detail.poKliknuti || ''), detail.poKliknuti);

  // ══════════════════════════════════════════════════════════════
  /* Ostatní nadpisy klikací nejsou — u „Položky" nebo „Skladu" by se
     kopírovalo něco, co člověk nečeká. */
  section('3) Ostatní nadpisy zůstaly obyčejné');
  const ostatni = await page.evaluate(() => {
    const mo = document.getElementById('moDetail');
    const klikaci = [].slice.call(mo.querySelectorAll('[data-action="copytext"]'))
      .map(n => n.textContent.trim());
    return { klikaci, jePolozka: klikaci.indexOf('Položka') !== -1, jeSklad: klikaci.indexOf('Sklad') !== -1 };
  });
  check('nadpis Položka klikací není', !ostatni.jePolozka, JSON.stringify(ostatni.klikaci));
  check('nadpis Sklad taky ne', !ostatni.jeSklad, JSON.stringify(ostatni.klikaci));

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
