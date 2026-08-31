// Test: přihlašovací brána a uvítací okno.
//
// Bez přihlášení se z aplikace nesmí ukázat nic — ani na okamžik, ani
// oklikou přes Escape nebo kliknutí vedle. Zároveň nesmí brána zamknout
// majitele venku, když se Firebase vůbec nenačte; tam se ověřovat nemá
// kde a data v localStorage jsou jeho.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SOUBOR = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];

  // ══════════════════════════════════════════════════════════════
  /* Firebase je v testech nedostupný, takže se brána sama zvedne.
     Aby šlo ověřit, jak se chová k nepřihlášenému, musí se dostupnost
     předstírat: _fbReady říká, že SDK běží, _fbAuthZnamy že se auth
     ozval, a _fbUser že to nebyl nikdo. */
  section('1) Nepřihlášený se do aplikace nedostane');
  const page = await browser.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await page.goto(SOUBOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _branaObnov === 'function', { timeout: 20000 });

  const odhlasen = await page.evaluate(() => {
    window._fbReady = true; window._fbSelhalo = 0;
    window._fbAuthZnamy = true; window._fbUser = null;
    _branaObnov();
    const g = document.getElementById('moLogin');
    const r = g.getBoundingClientRect();
    return {
      otevrena: g.classList.contains('open'),
      formular: getComputedStyle(document.getElementById('branaFormular')).display !== 'none',
      cekani: getComputedStyle(document.getElementById('branaCekani')).display !== 'none',
      pruhledna: getComputedStyle(g).backgroundColor,
      zIndex: Number(getComputedStyle(g).zIndex),
      // Musí pokrýt celé okno, ne jen kus
      sirka: Math.round(r.width) >= window.innerWidth,
      vyska: Math.round(r.height) >= window.innerHeight,
    };
  });
  check('brána je nahoře', odhlasen.otevrena);
  check('a ukazuje formulář', odhlasen.formular);
  check('čekací proužek je pryč', !odhlasen.cekani);
  check('pozadí je neprůhledné', !/rgba\([^)]*,\s*0(\.\d+)?\)/.test(odhlasen.pruhledna), odhlasen.pruhledna);
  check('kryje celé okno', odhlasen.sirka && odhlasen.vyska);
  check('leží nad modaly i překryvy', odhlasen.zIndex > 9999, String(odhlasen.zIndex));

  const popis = await page.evaluate(() => document.querySelector('.brana-popis').textContent.trim());
  check('podtitulek sedí', popis === 'Pro tvůj resell', popis);

  // Tlačítka a pole musí reagovat na najetí myší, ne jen tam ležet
  const reakce = await page.evaluate(() => {
    const styl = (sel, prop) => {
      const pravidla = Array.from(document.styleSheets).flatMap(s => {
        try { return Array.from(s.cssRules); } catch (e) { return []; }
      });
      const r = pravidla.find(x => x.selectorText === sel);
      return r ? r.style.getPropertyValue(prop) : '';
    };
    return {
      tabHover: !!styl('.brana-tab:hover', 'color'),
      tlacitkoHover: !!styl('.brana-hl:hover', 'transform'),
      poleFocus: !!styl('.brana-inp:focus', 'box-shadow'),
      odkazHover: !!styl('.brana-odkaz:hover', 'color'),
      prechod: !!styl('.brana-hl', 'transition'),
    };
  });
  check('záložky reagují na najetí', reakce.tabHover);
  check('hlavní tlačítko taky', reakce.tlacitkoHover && reakce.prechod);
  check('pole se rozsvítí při psaní', reakce.poleFocus);
  check('odkazy reagují', reakce.odkazHover);

  // Co je pod bránou, nesmí jít trefit
  const podBranou = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return { id: el && el.id, uvnitr: !!(el && el.closest('#moLogin')) };
  });
  check('klik doprostřed obrazovky trefí bránu, ne aplikaci', podBranou.uvnitr,
    'trefil ' + podBranou.id);

  // ══════════════════════════════════════════════════════════════
  /* Bránu nesmí jít obejít. Kdyby šla zavřít, člověk s odkazem
     by se do aplikace proklikal — a přesně tomu má zabránit. */
  section('2) Nejde ji obejít');
  const escape = await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return document.getElementById('moLogin').classList.contains('open');
  });
  check('Escape ji nezavře', escape);

  const klikVedle = await page.evaluate(() => {
    const g = document.getElementById('moLogin');
    g.click();   // klik na pozadí, mimo kartu
    return g.classList.contains('open');
  });
  check('klik na pozadí ji nezavře', klikVedle);

  const zadneZrusit = await page.evaluate(() => {
    const g = document.getElementById('moLogin');
    return Array.from(g.querySelectorAll('button')).map(b => b.textContent.trim());
  });
  check('tlačítko Zrušit tam není', !zadneZrusit.some(t => /zrušit/i.test(t)), JSON.stringify(zadneZrusit));
  check('přihlásit se dá', zadneZrusit.some(t => t === 'Přihlásit se'), JSON.stringify(zadneZrusit));
  check('registrace zůstala', zadneZrusit.some(t => /registrace/i.test(t)), JSON.stringify(zadneZrusit));

  // ══════════════════════════════════════════════════════════════
  /* Okno nesmí při přepnutí záložky podskočit. Řádek se souhlasem
     proto střídá řádek se zapomenutým heslem a oba jsou na jednu
     řádku — dřív byl souhlas na tři a okno se viditelně zvětšilo. */
  section('2b) Přepnutí na registraci oknem nehne');
  const vyskyZalozek = await page.evaluate(async () => {
    const box = document.getElementById('branaFormular');
    const zmer = () => Math.round(box.getBoundingClientRect().height);
    switchAuthTab('login');
    await new Promise(r => setTimeout(r, 260));
    const prihlaseni = zmer();
    switchAuthTab('register');
    await new Promise(r => setTimeout(r, 260));
    const registrace = zmer();
    const souhlas = document.getElementById('registerConsentWrap');
    const forgot = document.getElementById('loginForgot');
    const r = {
      prihlaseni, registrace,
      souhlasVidet: getComputedStyle(souhlas).display !== 'none',
      forgotSkryty: getComputedStyle(forgot).display === 'none',
      souhlasText: souhlas.textContent.replace(/\s+/g, ' ').trim(),
      souhlasRadku: Math.round(souhlas.getBoundingClientRect().height),
    };
    switchAuthTab('login');
    return r;
  });
  check('při registraci se ukáže souhlas', vyskyZalozek.souhlasVidet);
  check('a zapomenuté heslo se schová', vyskyZalozek.forgotSkryty);
  check('výška okna se nezmění', Math.abs(vyskyZalozek.prihlaseni - vyskyZalozek.registrace) <= 4,
    vyskyZalozek.prihlaseni + 'px vs ' + vyskyZalozek.registrace + 'px');
  check('souhlas je na jednu řádku', vyskyZalozek.souhlasRadku <= 26,
    vyskyZalozek.souhlasRadku + 'px | ' + vyskyZalozek.souhlasText);
  check('souhlas je krátký', vyskyZalozek.souhlasText === 'Souhlasím se zpracováním osobních údajů',
    vyskyZalozek.souhlasText);

  // ══════════════════════════════════════════════════════════════
  /* Zapomenuté heslo má vlastní panel. Vyplňovat e-mail v přihlášení
     a teprve pak klikat na odkaz je naruby. */
  section('2c) Obnova hesla je vlastní obrazovka');
  const obnova = await page.evaluate(() => {
    document.getElementById('loginEmail').value = 'kdo@si.cz';
    otevriObnovuHesla();
    const auth = document.getElementById('branaAuth');
    const reset = document.getElementById('branaReset');
    return {
      authSkryty: getComputedStyle(auth).display === 'none',
      resetVidet: getComputedStyle(reset).display !== 'none',
      // E-mail napsaný v přihlášení se přenese, ať se nepíše dvakrát
      email: document.getElementById('resetEmail').value,
      maHeslo: !!reset.querySelector('input[type="password"]'),
      tlacitka: Array.from(reset.querySelectorAll('button')).map(b => b.textContent.trim()),
      pokyn: reset.children[1].textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  check('přihlašovací panel se schová', obnova.authSkryty);
  check('a ukáže se obnova hesla', obnova.resetVidet);
  check('pole na heslo tam není', !obnova.maHeslo, 'v obnově hesla nemá co dělat');
  check('pokyn je krátký', obnova.pokyn === 'Zadej svůj přihlašovací email', obnova.pokyn);
  check('napsaný e-mail se přenese', obnova.email === 'kdo@si.cz', obnova.email);
  check('jde odeslat odkaz', obnova.tlacitka.some(t => /poslat odkaz/i.test(t)), JSON.stringify(obnova.tlacitka));
  check('a vrátit se zpět', obnova.tlacitka.some(t => /zpět na přihlášení/i.test(t)), JSON.stringify(obnova.tlacitka));

  const bezEmailu = await page.evaluate(() => {
    document.getElementById('resetEmail').value = '';
    doForgotPassword();
    const z = document.getElementById('resetZprava');
    return { videt: getComputedStyle(z).display !== 'none', text: z.textContent };
  });
  check('bez e-mailu se ozve', bezEmailu.videt && /e-mail/i.test(bezEmailu.text), bezEmailu.text);

  /* Firebase má zapnutou ochranu proti vyzrazení e-mailů, takže na reset
     neexistujícího účtu odpoví, jako by odkaz odešel. Zjistit se to
     z prohlížeče nedá — co jde, je ohlídat tvar adresy a neslibovat
     doručení, aby člověk nečekal na odkaz, který nikdy nedorazí. */
  const tvar = await page.evaluate(() => {
    const spatne = ['bezzavinace.cz', 'a@b', 'kdo@ si.cz', '@si.cz', 'kdo@si.', ''];
    const dobre = ['kdo@si.cz', 'michal.novak+sklad@example.co.uk'];
    return {
      spatne: spatne.filter(e => jeTvarEmailu(e)),
      dobre: dobre.filter(e => !jeTvarEmailu(e)),
    };
  });
  check('rozbité adresy neprojdou', tvar.spatne.length === 0, JSON.stringify(tvar.spatne));
  check('a normální ano', tvar.dobre.length === 0, JSON.stringify(tvar.dobre));

  const spatnyTvar = await page.evaluate(() => {
    document.getElementById('resetEmail').value = 'bezzavinace.cz';
    let odeslano = false;
    const puvodni = window._fbAuth;
    window._fbAuth = { _test: 1 };
    doForgotPassword();
    window._fbAuth = puvodni;
    const z = document.getElementById('resetZprava');
    return { text: z.textContent, videt: getComputedStyle(z).display !== 'none', odeslano };
  });
  check('rozbitá adresa se zastaví hned',
    spatnyTvar.text === 'Neplatný email' && spatnyTvar.videt, spatnyTvar.text);

  // Hláška po odeslání nesmí tvrdit, že odkaz dorazil
  const zdroj0 = require('fs').readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  check('úspěch doručení neslibuje',
    /Pokud je ' \+ email \+ ' zaregistrovaný/.test(zdroj0) && !/Odkaz jsme poslali na/.test(zdroj0),
    'jinak by člověk čekal na odkaz, který nemusí přijít');
  /* Čte se tělo samotné funkce, ne celý soubor — auth/user-not-found
     je i v doLogin, takže hledání přes celý index.html by prošlo
     i tehdy, kdyby ho obnova hesla přestala rozlišovat. */
  const telo = await page.evaluate(() => String(doForgotPassword));
  check('a neregistrovaný e-mail se odmítne, až to Firebase dovolí',
    /auth\/user-not-found/.test(telo), 'aby stačilo vypnout ochranu v konzoli');
  check('hláška je jen „Neplatný email“',
    (telo.match(/'Neplatný email'/g) || []).length === 2
      && !/není zaregistrovaný/.test(telo) && !/Zkontroluj překlep\./.test(telo),
    'u tvaru adresy i u odmítnutí od Firebase stejná');

  const zpatky = await page.evaluate(() => {
    zpetNaPrihlaseni();
    return {
      auth: getComputedStyle(document.getElementById('branaAuth')).display !== 'none',
      reset: getComputedStyle(document.getElementById('branaReset')).display === 'none',
    };
  });
  check('Zpět vede na přihlášení', zpatky.auth && zpatky.reset);

  // Přepnutí záložky nesmí nechat oba panely viset přes sebe
  const zalozkaZObnovy = await page.evaluate(() => {
    otevriObnovuHesla();
    switchAuthTab('register');
    const r = {
      auth: getComputedStyle(document.getElementById('branaAuth')).display !== 'none',
      reset: getComputedStyle(document.getElementById('branaReset')).display === 'none',
    };
    switchAuthTab('login');
    return r;
  });
  check('záložka z obnovy taky vrátí formulář', zalozkaZObnovy.auth && zalozkaZObnovy.reset);

  // ══════════════════════════════════════════════════════════════
  section('3) Přihlášený projde');
  const prihlasen = await page.evaluate(() => {
    window._fbUser = { uid: 'u1', email: 'kdo@si.cz' };
    _branaObnov();
    return document.getElementById('moLogin').classList.contains('open');
  });
  check('po přihlášení brána zmizí', !prihlasen);

  const znovuOdhlasen = await page.evaluate(() => {
    window._fbUser = null;
    document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: null } }));
    return document.getElementById('moLogin').classList.contains('open');
  });
  check('a po odhlášení se zase vrátí', znovuOdhlasen);

  // ══════════════════════════════════════════════════════════════
  /* Než Firebase odpoví, kdo je přihlášený, nesmí formulář bliknout —
     majitel přihlášený je, jen se to ještě neověřilo. */
  section('4) Dokud se neví, ukazuje se jen proužek');
  const cekani = await page.evaluate(() => {
    window._fbReady = true; window._fbSelhalo = 0;
    window._fbAuthZnamy = false; window._fbUser = null;
    _branaObnov();
    return {
      stav: _branaStav(),
      otevrena: document.getElementById('moLogin').classList.contains('open'),
      formular: getComputedStyle(document.getElementById('branaFormular')).display !== 'none',
      cekani: getComputedStyle(document.getElementById('branaCekani')).display !== 'none',
    };
  });
  check('stav je čekání', cekani.stav === 'cekani', cekani.stav);
  check('brána drží', cekani.otevrena);
  check('formulář ještě nesvítí', !cekani.formular, 'jinak by blikl při každém načtení');
  check('proužek ano', cekani.cekani);

  // ══════════════════════════════════════════════════════════════
  /* Když se Firebase nenačte vůbec, není koho ověřovat. Zamčená
     aplikace by v tu chvíli znamenala, že se majitel nedostane ani
     ke svým datům v localStorage. */
  section('5) Bez Firebase se aplikace nezamkne');
  const bezCloudu = await page.evaluate(() => {
    window._fbReady = undefined; window._fbAuthZnamy = false;
    window._fbUser = null; window._fbSelhalo = 1;
    _branaObnov();
    return { stav: _branaStav(), otevrena: document.getElementById('moLogin').classList.contains('open') };
  });
  check('stav je bez cloudu', bezCloudu.stav === 'bezCloudu', bezCloudu.stav);
  check('brána se zvedne', !bezCloudu.otevrena, 'jinak by offline appka nešla používat');

  // Ale jakmile Firebase odpoví, že nikdo přihlášený není, brána zpátky
  const potePrijde = await page.evaluate(() => {
    window._fbSelhalo = 0; window._fbReady = true; window._fbAuthZnamy = true;
    _branaObnov();
    return document.getElementById('moLogin').classList.contains('open');
  });
  check('odpověď „nikdo“ má přednost před offline režimem', potePrijde);

  await page.close();

  // ══════════════════════════════════════════════════════════════
  /* Kdyby se brána zvedla až z JS, blikla by aplikace při každém
     načtení dřív, než se stihne zakrýt. Proto je otevřená rovnou
     v HTML a stojí na začátku <body>, ještě před hlavičkou aplikace —
     prohlížeč ji tak vykreslí dřív než cokoli, co má zakrýt. */
  section('6) Brána stojí od prvního vykreslení');
  const zdroj = require('fs').readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const poziceBrany = zdroj.indexOf('id="moLogin"');
  const poziceHlavicky = zdroj.indexOf('<header');
  const poziceMrizky = zdroj.indexOf('id="itemsGrid"');
  check('v HTML je otevřená, ne až z JS', /id="moLogin"[^>]*class="mo brana open"/.test(zdroj),
    'jinak by aplikace blikla, než ji JS zakryje');
  check('a je před hlavičkou aplikace', poziceBrany > 0 && poziceBrany < poziceHlavicky,
    poziceBrany + ' vs ' + poziceHlavicky);
  check('i před mřížkou položek', poziceBrany > 0 && poziceBrany < poziceMrizky,
    poziceBrany + ' vs ' + poziceMrizky);

  const p2 = await browser.newPage();
  p2.on('pageerror', e => errs.push('PAGEERROR(2): ' + e.message));
  await p2.route('**/firebasejs/**', route => route.abort());
  await p2.goto(SOUBOR, { waitUntil: 'domcontentloaded' });
  // Bez Firebase se do chvíle sama zvedne — jinak by offline appka nešla používat
  let zvedlaSe = true;
  await p2.waitForFunction(
    () => !document.getElementById('moLogin').classList.contains('open'), { timeout: 12000 }
  ).catch(() => { zvedlaSe = false; });
  check('bez Firebase se sama zvedne', zvedlaSe, 'zůstala viset na čekacím proužku');
  await p2.close();

  // ══════════════════════════════════════════════════════════════
  /* Uvítací okno se rozpadalo, protože řádek byl flex a každý <b>
     a <kbd> v něm se stal samostatnou položkou ve vlastním sloupci.
     Věta se pak četla po útržcích. */
  section('7) Uvítací okno drží pohromadě');
  const p3 = await browser.newPage();
  p3.on('pageerror', e => errs.push('PAGEERROR(3): ' + e.message));
  await p3.route('**/firebasejs/**', route => route.abort());
  await p3.goto(SOUBOR, { waitUntil: 'domcontentloaded' });
  await p3.waitForFunction(() => typeof showOnboarding === 'function', { timeout: 20000 });

  const uvitani = await p3.evaluate(() => {
    showOnboarding();
    const ov = document.getElementById('onboardOverlay');
    const radky = Array.from(ov.querySelectorAll('.onb-radek'));
    const info = radky.map(r => {
      const deti = Array.from(r.children);
      const text = r.lastElementChild;
      const tr = text.getBoundingClientRect();
      const rr = r.getBoundingClientRect();
      return {
        // Ikona a text — víc dětí znamená, že se věta rozpadla na
        // samostatné položky, každou ve vlastním sloupci
        deti: deti.length,
        vyska: Math.round(tr.height),
        // Text musí zabírat skoro celou šířku řádku, ne jeden úzký sloupec
        podilSirky: rr.width ? tr.width / rr.width : 0,
        text: text.textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    return { pocet: radky.length, info, maTlacitko: !!ov.querySelector('#onboardStart') };
  });
  check('má tři řádky', uvitani.pocet === 3, String(uvitani.pocet));
  check('a tlačítko Začít', uvitani.maTlacitko);
  uvitani.info.forEach(function (r, i) {
    var c = i + 1;
    /* Tohle je jádro té chyby: v flexu se z <b> a <kbd> uvnitř věty
       stanou samostatné položky a rozhodí se do vlastních sloupců.
       Celá věta proto musí být v jednom prvku vedle ikony. */
    check('řádek ' + c + ' má ikonu a jeden blok textu', r.deti === 2,
      r.deti + ' dětí | ' + r.text);
    check('řádek ' + c + ' se nerozpadl do sloupců', r.podilSirky > 0.7,
      Math.round(r.podilSirky * 100) + ' % šířky | ' + r.text);
    // Jeden až dva řádky textu; rozsekaný by byl výrazně vyšší
    check('řádek ' + c + ' má rozumnou výšku', r.vyska > 0 && r.vyska <= 48,
      r.vyska + 'px | ' + r.text);
  });
  check('věta o přidávání je celá',
    uvitani.info[0].text === 'Položky přidáš tlačítkem + Přidat nebo klávesou N',
    uvitani.info[0].text);

  const zavreni = await p3.evaluate(() => {
    document.getElementById('onboardStart').click();
    return !!document.getElementById('onboardOverlay');
  });
  check('Začít okno zavře', !zavreni);
  await p3.close();

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
