// Test: zprávy a poznámky mezi účetním a majitelem (index.html ZPRÁVY A POZNÁMKY).
//
// Účetní hlásí a píše, majitel to má s počtem u tlačítka, přepíná stav
// a odpovídá. Hlídá se hlavně to, co se rozbije tiše:
// - účetní zapisuje jedině do kolekce zpráv, sklad majitele zůstane netknutý,
// - stav mění jen majitel,
// - Připomenout se samo vrátí mezi Nové, až přijde den,
// - snímek, který dorazí uprostřed psaní, rozepsaný text nesmaže.

const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const MAJITEL = 'majitel1';
const UCETNI = 'uctetni1';
const POLOZKY = [
  { id: 's1', name: 'Dunk Low Panda', category: 'sneakers', buyPrice: 2400, buyCurrency: 'CZK',
    saleState: 'stock', location: 'Doma', dateAdded: 101, buyDate: '2026-01-05', tags: [], size: '42', platforms: [] },
  { id: 'p1', name: 'Jordan 1 Chicago', category: 'sneakers', buyPrice: 5200, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 8900, profit: 3700, saleDate: '2026-05-01', payoutDate: '2026-05-10',
    soldWhere: 'StockX', dateAdded: 104, buyDate: '2026-01-01', tags: [] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(installFakeFirestore);

  const prihlas = async (uid) => {
    await page.evaluate((u) => {
      window._fbUser = { uid: u, email: u + '@test.cz' };
      document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: { uid: u } } }));
    }, uid);
    await page.waitForTimeout(250);
  };
  const emit = async () => { await page.evaluate(() => window.__emitSnapshot && window.__emitSnapshot()); await page.waitForTimeout(400); };
  const zpravy = () => page.evaluate((m) => {
    const pre = 'users/' + m + '/zpravy/';
    const out = { v: {}, m: [] };
    for (const k of Object.keys(window.__store)) {
      if (k.indexOf(pre) !== 0) continue;
      const id = k.slice(pre.length);
      if (id.startsWith('v_')) out.v[id] = window.__store[k];
      else if (id.startsWith('m_')) out.m.push(window.__store[k]);
    }
    return out;
  }, MAJITEL);
  const pocet = () => page.evaluate(() => {
    const el = document.getElementById('zpravyPocet');
    return el && el.style.display !== 'none' ? el.textContent : '0';
  });

  // ══════════════════════════════════════════════════════════════
  section('1) Účetní založí hlášení');
  await page.evaluate((d) => {
    localStorage.clear(); items = []; window.__store = {};
    window.__store['users/' + d.UCETNI + '/sklad/odkaz'] = { uctujePro: d.MAJITEL };
    window.__store['users/' + d.MAJITEL + '/sklad/data'] = { items: JSON.parse(JSON.stringify(d.POLOZKY)), savedAt: '2026-08-02T10:00:00.000Z' };
  }, { MAJITEL, UCETNI, POLOZKY });
  await prihlas(UCETNI);
  await emit(); await emit();
  check('účetní je v režimu účetního', await page.evaluate(() => jeUctetni()));
  const skladPred = await page.evaluate((m) => JSON.stringify(window.__store['users/' + m + '/sklad/data']), MAJITEL);

  check('tlačítko Zprávy v hlavičce je vidět', await page.evaluate(() => getComputedStyle(document.getElementById('btnZpravy')).display !== 'none'));
  check('a Zprávy jsou i v oranžovém pruhu', await page.evaluate(() => /Zprávy/.test(document.getElementById('uctetniLista').textContent)));

  await page.click('#btnZpravy');
  await page.waitForTimeout(150);
  check('okno Zprávy se otevře', await page.evaluate(() => !!document.querySelector('#zprOv .zpr-okno')));
  check('účetní má Nové hlášení', await page.evaluate(() => !!document.querySelector('#zprOv .zpr-nove-btn')));
  await page.click('#zprOv .zpr-nove-btn');
  await page.waitForTimeout(100);
  check('formulář nového hlášení', await page.evaluate(() => !!document.getElementById('zprNPredmet')));

  // Bez předmětu se neodešle
  await page.fill('#zprNText', 'Text bez předmětu');
  await page.click('text=Odeslat hlášení');
  await page.waitForTimeout(100);
  check('bez předmětu se nic neodešle', Object.keys((await zpravy()).v).length === 0);

  await page.click('#zprOv [data-druh="doklad"]');
  await page.fill('#zprNPredmet', 'Chybí faktura k Jordanům');
  await page.fill('#zprNText', 'U Jordan 1 Chicago nevidím nákupní doklad.');
  await page.click('text=Odeslat hlášení');
  await page.waitForTimeout(300);
  let z = await zpravy();
  const vlId = Object.keys(z.v)[0];
  const vl = z.v[vlId];
  check('vlákno je v kolekci zpráv majitele', !!vl && vl.typ === 'hlaseni', JSON.stringify(z));
  check('druh a předmět', vl && vl.druh === 'doklad' && vl.predmet === 'Chybí faktura k Jordanům');
  check('hlášení začíná jako Nové', vl && vl.stav === 'nove');
  check('zpráva je podepsaná účetním', z.m.length === 1 && z.m[0].od === 'ucetni' && z.m[0].vlakno === vlId, JSON.stringify(z.m));
  check('po odeslání je otevřené vlákno', await page.evaluate(() => _zprPohled === 'vlakno' && !!document.getElementById('zprOdpoved')));
  check('účetní nevidí přepínač stavu', await page.evaluate(() => !document.querySelector('#zprOv .zpr-stavy')));

  // Stav účetní nezmění, ani přímým voláním
  await page.evaluate((id) => zprNastavStav(id, 'hotovo'), vlId);
  await page.waitForTimeout(100);
  check('účetní stav nezmění', (await zpravy()).v[vlId].stav === 'nove');

  // ══════════════════════════════════════════════════════════════
  section('2) Poznámka a hlášení z detailu položky');
  await page.evaluate(() => zavriZpravy());
  await page.evaluate(() => openDetail('s1'));
  await page.waitForTimeout(150);
  check('detail má Poznámky', await page.evaluate(() => !!document.getElementById('detPoznamky')));
  check('účetní má Nahlásit problém s položkou', await page.evaluate(() => !!document.querySelector('#detPoznamky .zpr-det-nahlasit')));
  await page.fill('#zprDetText', 'Tohle je podle mě osobní kus.');
  await page.click('#detPoznamky .btn-sec');
  await page.waitForTimeout(300);
  z = await zpravy();
  check('vlákno poznámek u položky', z.v.v_pol_s1 && z.v.v_pol_s1.typ === 'polozka' && z.v.v_pol_s1.polozkaId === 's1', JSON.stringify(z.v.v_pol_s1));
  check('vlákno položky nemá stav', z.v.v_pol_s1 && !('stav' in z.v.v_pol_s1));
  check('poznámka je v detailu vidět', await page.evaluate(() => /osobní kus/.test(document.getElementById('detPoznamky').textContent)));
  check('pole se po odeslání vyprázdní', await page.evaluate(() => document.getElementById('zprDetText').value === ''));

  await page.click('#detPoznamky .zpr-det-nahlasit');
  await page.waitForTimeout(150);
  check('Nahlásit otevře formulář s položkou', await page.evaluate(() => _zprPohled === 'nove' && _zprNove && _zprNove.polozkaId === 's1'));
  check('detail se zavřel', await page.evaluate(() => !document.getElementById('moDetail').classList.contains('open')));
  await page.evaluate(() => zavriZpravy());

  const skladPo = await page.evaluate((m) => JSON.stringify(window.__store['users/' + m + '/sklad/data']), MAJITEL);
  check('sklad majitele zůstal netknutý', skladPred === skladPo);
  check('účetní nezapsal nic mimo zprávy', await page.evaluate((d) => Object.keys(window.__store).every(function(k) {
    return k.indexOf('users/' + d.MAJITEL + '/zpravy/') === 0 || k === 'users/' + d.MAJITEL + '/sklad/data' || k.indexOf('users/' + d.UCETNI + '/') === 0;
  }), { MAJITEL, UCETNI }));

  // ══════════════════════════════════════════════════════════════
  section('3) Majitel to má na očích');
  await prihlas(MAJITEL);
  await emit();
  await page.waitForTimeout(100);
  check('majitel není účetní', await page.evaluate(() => !jeUctetni()));
  check('počet u tlačítka: hlášení + nepřečtená poznámka', (await pocet()) === '2', await pocet());
  check('tlačítko svítí', await page.evaluate(() => document.getElementById('btnZpravy').classList.contains('zpr-svitit')));

  await page.click('#btnZpravy');
  await page.waitForTimeout(150);
  check('majitel nemá Nové hlášení', await page.evaluate(() => !document.querySelector('#zprOv .zpr-nove-btn')));
  check('v Otevřených je hlášení', await page.evaluate((id) => !!document.querySelector('#zprOv [data-vlakno="' + id + '"]'), vlId));
  await page.click('#zprOv [data-vlakno="' + vlId + '"]');
  await page.waitForTimeout(200);
  z = await zpravy();
  check('otevřením se vlákno přečte', z.v[vlId].cteniM > 0);
  check('Nové svítí dál, dokud se nepřepne', (await pocet()) === '2', await pocet());
  check('majitel má přepínač stavu', await page.evaluate(() => !!document.querySelector('#zprOv .zpr-stavy')));

  await page.click('#zprOv [data-stav="rozprac"]');
  await page.waitForTimeout(200);
  z = await zpravy();
  check('stav Rozpracované', z.v[vlId].stav === 'rozprac' && z.v[vlId].stavZmenen > 0);
  check('počet klesl', (await pocet()) === '1', await pocet());

  // Stopa konektoru: kdy naposledy kontroloval zprávy
  await page.evaluate(() => zprZpet());
  const stopa = async (mail) => {
    await page.evaluate((d) => {
      if (d.mail) window.__store['users/' + d.m + '/zpravy/_mail'] = d.mail;
      else delete window.__store['users/' + d.m + '/zpravy/_mail'];
      window.__ozviKolekci('users/' + d.m + '/zpravy');
    }, { m: MAJITEL, mail });
    await page.waitForTimeout(80);
    return page.evaluate(() => { const el = document.querySelector('#zprOv .zpr-stopa'); return el ? el.className + '|' + el.textContent : ''; });
  };
  let s = await stopa(null);
  check('bez značky: konektor se zatím neozval', /s-nic/.test(s) && /neozval/.test(s), s);
  s = await stopa({ odeslanoDo: 1, zkontrolovano: Date.now() - 3 * 60000 });
  check('čerstvá kontrola: v pořádku', /s-ok/.test(s) && /naposledy kontroloval/.test(s), s);
  s = await stopa({ odeslanoDo: 1, zkontrolovano: Date.now() - 60 * 60000 });
  check('hodinu ticho: varování, že cron asi neběží', /s-ticho/.test(s) && /cron asi neběží/.test(s), s);
  s = await stopa({ odeslanoDo: 1, kdy: new Date(Date.now() - 2 * 60000).toISOString() });
  check('starší konektor bez zkontrolovano: bere se kdy', /s-ok/.test(s), s);
  s = await stopa({ odeslanoDo: 1, zkontrolovano: Date.now(), chyba: 'mail se neodeslal: výpadek' });
  check('potíž s poštou je vidět', /s-chyba/.test(s) && /výpadek/.test(s), s);
  await stopa(null);
  await page.click('#zprOv [data-vlakno="' + vlId + '"]');
  await page.waitForTimeout(150);

  // Odpověď; snímek uprostřed psaní nesmí smazat rozepsané
  await page.fill('#zprOdpoved', 'Rozepsaná odpo');
  await page.evaluate((m) => window.__ozviKolekci('users/' + m + '/zpravy'), MAJITEL);
  await page.waitForTimeout(100);
  check('snímek nesmaže rozepsaný text', await page.evaluate(() => document.getElementById('zprOdpoved').value === 'Rozepsaná odpo'));
  await page.fill('#zprOdpoved', 'Díky, doplním to dnes.');
  await page.click('#zprOv .zpr-psani .uc-btn');
  await page.waitForTimeout(300);
  z = await zpravy();
  check('odpověď majitele', z.m.some(m => m.od === 'majitel' && m.vlakno === vlId && /doplním/.test(m.text)));
  check('odpověď je ve vlákně vidět', await page.evaluate(() => /doplním/.test(document.querySelector('#zprOv .zpr-zpravy').textContent)));

  // Připomenout: minulé datum ne, budoucí ano
  await page.click('#zprOv [data-stav="pripomenout"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.getElementById('zprDatum').value = _zprDnes(0); });
  await page.click('#zprOv .zpr-datum .uc-btn');
  await page.waitForTimeout(150);
  check('dnešek se jako připomenutí nepřijme', (await zpravy()).v[vlId].stav === 'rozprac');
  await page.evaluate(() => { document.getElementById('zprDatum').value = _zprDnes(3); });
  await page.click('#zprOv .zpr-datum .uc-btn');
  await page.waitForTimeout(200);
  z = await zpravy();
  check('Připomenout s datem', z.v[vlId].stav === 'pripomenout' && z.v[vlId].pripomenout === await page.evaluate(() => _zprDnes(3)));
  check('odložené je v záložce Připomenout', await page.evaluate((id) => zprStav(_zpr.vlakna[id]) === 'pripomenout', vlId));

  // Den připomenutí přišel → zase Nové
  await page.evaluate((d) => {
    window.__store['users/' + d.m + '/zpravy/' + d.id].pripomenout = _zprDnes(-1);
    window.__ozviKolekci('users/' + d.m + '/zpravy');
  }, { m: MAJITEL, id: vlId });
  await page.waitForTimeout(100);
  check('po dni připomenutí je hlášení zase Nové', await page.evaluate((id) => zprStav(_zpr.vlakna[id]) === 'nove', vlId));
  check('a svítí na tlačítku', (await pocet()) === '2', await pocet());

  await page.click('#zprOv [data-stav="hotovo"]');
  await page.waitForTimeout(200);
  check('Hotovo', (await zpravy()).v[vlId].stav === 'hotovo');
  check('připomenutí se smazalo', (await zpravy()).v[vlId].pripomenout === null);

  // Poznámka u položky se přečte otevřením detailu
  await page.evaluate(() => zavriZpravy());
  await page.evaluate(() => openDetail('s1'));
  await page.waitForTimeout(250);
  check('detail ukazuje poznámku účetního', await page.evaluate(() => /osobní kus/.test(document.getElementById('detPoznamky').textContent)));
  check('majitel tlačítko Nahlásit nemá', await page.evaluate(() => !document.querySelector('#detPoznamky .zpr-det-nahlasit')));
  check('otevřením detailu je poznámka přečtená', (await pocet()) === '0', await pocet());
  await page.fill('#zprDetText', 'Není, je to na fakturu.');
  await page.click('#detPoznamky .btn-sec');
  await page.waitForTimeout(300);
  z = await zpravy();
  check('majitel odpověděl u položky', z.m.some(m => m.od === 'majitel' && m.vlakno === 'v_pol_s1'));
  await page.evaluate(() => cm('moDetail'));
  check('Escape zavírá okno Zpráv', await (async () => {
    await page.evaluate(() => openZpravy());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    return page.evaluate(() => !document.getElementById('zprOv'));
  })());

  // ══════════════════════════════════════════════════════════════
  section('4) Účetní vidí odpověď a stav');
  await prihlas(UCETNI);
  await emit(); await emit();
  await page.waitForTimeout(100);
  check('účetnímu svítí obě vlákna', (await pocet()) === '2', await pocet());
  check('i v oranžovém pruhu', await page.evaluate(() => document.getElementById('zpravyPocetU').textContent === '2'));
  await page.evaluate(() => { openZpravy(); zprFiltr('otevrene'); });
  await page.waitForTimeout(100);
  check('účetní stopu konektoru nevidí', await page.evaluate(() => !document.querySelector('#zprOv .zpr-stopa')));
  // Hotové, ale s nepřečtenou odpovědí — musí být vidět mezi Otevřenými
  check('Hotové s nepřečtenou odpovědí je mezi Otevřenými', await page.evaluate((id) => !!document.querySelector('#zprOv [data-vlakno="' + id + '"]'), vlId));
  await page.click('#zprOv [data-vlakno="' + vlId + '"]');
  await page.waitForTimeout(200);
  check('účetní vidí stav Hotovo', await page.evaluate(() => /Hotovo/.test(document.querySelector('#zprOv .zpr-meta').textContent)));
  z = await zpravy();
  check('přečtení zapíše jen cteniU', z.v[vlId].cteniU > 0 && z.v[vlId].stav === 'hotovo');
  check('zbývá jedno nepřečtené', (await pocet()) === '1', await pocet());
  check('po přečtení se vrátí mezi Hotové', await page.evaluate((id) => _zprVFiltru(_zpr.vlakna[id], 'hotove') && !_zprVFiltru(_zpr.vlakna[id], 'otevrene'), vlId));

  // Escape v rozepsaném poli jen odejde z pole, okno zůstane
  await page.fill('#zprOdpoved', 'rozepsané');
  await page.focus('#zprOdpoved');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('první Escape v psaní okno nezavře', await page.evaluate(() => !!document.getElementById('zprOv') && document.getElementById('zprOdpoved').value === 'rozepsané'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('druhý Escape ano', await page.evaluate(() => !document.getElementById('zprOv')));
  await page.evaluate(() => zavriZpravy());

  // ══════════════════════════════════════════════════════════════
  section('5) Odhlášení');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: null } })));
  await page.waitForTimeout(150);
  check('tlačítko Zprávy zmizí', await page.evaluate(() => getComputedStyle(document.getElementById('btnZpravy')).display === 'none'));
  check('zprávy v paměti nezůstanou', await page.evaluate(() => Object.keys(_zpr.vlakna).length === 0 && !_zprUnsub));

  check('žádné chyby na stránce', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failures ? '\n' + failures + ' FAIL' : '\nOK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
