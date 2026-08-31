// Test: databáze příspěvků na Instagramu.
//
// Na Instagramu se příspěvek nikdy nemaže. Když se kus jednou nafotil,
// nabídka tam visí napořád — i když se mezitím prodal a naskladnil znovu
// o rok později. Aplikace by jinak hlásila, že není nikde vystavený.
//
// Nejdůležitější je, co se NEspáruje. Když párování něco přehlédne,
// uživatel Instagram odklikne ručně. Když spáruje omylem, bude si myslet,
// že je kus vystavený, a nebude — a přijde o prodej, aniž by tušil proč.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.readyState === 'complete' && typeof igNajdiPrispevek === 'function'
      && typeof igProjedSklad === 'function' && !!document.getElementById('itemsGrid'),
    { timeout: 20000 });
  await page.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════
  section('1) Co se spárovat má');
  const sedi = await page.evaluate(() => {
    const posty = [
      'Jordan 4 Black Cat 2025',
      'Nike Dunk Low Panda',
      'Corteiz Cargo Cargos Black',
    ];
    const zkus = (n) => { const r = igNajdiPrispevek(n, igPriprav(posty)); return r && r.shoda; };
    return {
      presne: zkus('Jordan 4 Black Cat 2025'),
      jinaVelikostPismen: zkus('JORDAN 4 BLACK CAT 2025'),
      diakritika: zkus('Nike Dúnk Lów Pandá'),
      interpunkce: zkus('Nike Dunk Low - "Panda"'),
      mezeryNavic: zkus('  Nike   Dunk   Low   Panda  '),
      kratsiNazev: zkus('Jordan 4 Black Cat'),
      delsiNazev: zkus('Nike Dunk Low Panda 2021 DD1391-100'),
    };
  });
  check('přesná shoda', sedi.presne === 'přesná');
  check('velká písmena nevadí', sedi.jinaVelikostPismen === 'přesná');
  check('diakritika nevadí', sedi.diakritika === 'přesná', String(sedi.diakritika));
  check('interpunkce nevadí', sedi.interpunkce === 'přesná', String(sedi.interpunkce));
  check('mezery navíc nevadí', sedi.mezeryNavic === 'přesná', String(sedi.mezeryNavic));
  // Jeho příklad: post má navíc rok, položka ne
  check('kratší název se najde', sedi.kratsiNazev === 'volná', String(sedi.kratsiNazev));
  check('delší název taky', sedi.delsiNazev === 'volná', String(sedi.delsiNazev));

  // ══════════════════════════════════════════════════════════════
  /* Tohle je ta důležitější půlka. Falešná shoda znamená, že se kus
     tváří jako vystavený, a přitom o něm na Instagramu není ani slovo. */
  section('2) Co se spárovat nesmí');
  const nesedi = await page.evaluate(() => {
    const posty = ['Jordan 4 Black Cat 2025', 'Nike Dunk Low Panda', 'Jordan 1'];
    const zkus = (n) => { const r = igNajdiPrispevek(n, igPriprav(posty)); return r && r.shoda; };
    return {
      jinyModel: zkus('Jordan 1 Black Cat 2025'),
      jinaBarva: zkus('Jordan 4 White Cement 2025'),
      uplneJine: zkus('Adidas Samba OG'),
      prazdno: zkus(''),
      // Dvě slova jsou na volnou shodu příliš obecná
      obecne: zkus('Nike Dunk'),
      // Krátký post by jinak spároval půlku skladu
      kratkyPost: zkus('Jordan 1 Chicago Lost and Found'),
    };
  });
  check('jiný model ne', !nesedi.jinyModel, String(nesedi.jinyModel));
  check('jiná barva ne', !nesedi.jinaBarva, String(nesedi.jinaBarva));
  check('úplně jiná bota ne', !nesedi.uplneJine, String(nesedi.uplneJine));
  check('prázdný název ne', !nesedi.prazdno);
  check('dvouslovný název je moc obecný', !nesedi.obecne, String(nesedi.obecne));
  check('a dvouslovný post taky', !nesedi.kratkyPost, String(nesedi.kratkyPost));

  // ══════════════════════════════════════════════════════════════
  section('3) Nová položka se zaškrtne sama');
  const nova = await page.evaluate(() => {
    localStorage.clear();
    saveIgPosts(['Jordan 4 Black Cat 2025', 'Nike Dunk Low Panda']);
    const kus = (n) => { const o = { id: 'x', name: n, platforms: [] }; igDoplnUNove(o, igPriprav(getIgPosts())); return o.platforms; };
    return {
      sedici: kus('Jordan 4 Black Cat'),
      nesedici: kus('Adidas Samba OG'),
      uzMa: (function () {
        const o = { id: 'y', name: 'Nike Dunk Low Panda', platforms: ['Instagram', 'Vinted'] };
        const zmena = igDoplnUNove(o, igPriprav(getIgPosts()));
        return { plats: o.platforms, zmena };
      })(),
    };
  });
  check('kus z databáze dostane Instagram', nova.sedici.includes('Instagram'), JSON.stringify(nova.sedici));
  check('cizí kus ne', !nova.nesedici.includes('Instagram'), JSON.stringify(nova.nesedici));
  check('kdo Instagram má, nedostane ho dvakrát',
    nova.uzMa.plats.filter(p => p === 'Instagram').length === 1, JSON.stringify(nova.uzMa.plats));
  check('a nehlásí se to jako změna', nova.uzMa.zmena === false);

  // ══════════════════════════════════════════════════════════════
  /* Kdyby doplňování běželo při každém načtení, ručně odškrtnutý
     Instagram by se pokaždé vrátil a nešlo by ho odstranit. */
  section('4) Ručně odškrtnutý Instagram se nevrací');
  const rucne = await page.evaluate(() => {
    localStorage.clear();
    saveIgPosts(['Nike Dunk Low Panda']);
    items = [{ id: 'a', name: 'Nike Dunk Low Panda', saleState: 'stock', platforms: ['Instagram'], tags: [] }];
    togglePlatItem('a', 'Instagram');            // uživatel odškrtne
    const poOdskrtnuti = (items[0].platforms || []).includes('Instagram');
    renderItems();                                // překreslení nesmí nic vrátit
    return { poOdskrtnuti, poPrekresleni: (items[0].platforms || []).includes('Instagram') };
  });
  check('odškrtnutí projde', rucne.poOdskrtnuti === false);
  check('a překreslení ho nevrátí', rucne.poPrekresleni === false,
    'jinak by Instagram nešlo odstranit');

  // ══════════════════════════════════════════════════════════════
  section('5) Jednorázové projetí skladu');
  const projeti = await page.evaluate(() => {
    localStorage.clear();
    saveIgPosts(['Jordan 4 Black Cat 2025', 'Nike Dunk Low Panda']);
    items = [
      { id: 'a', name: 'Jordan 4 Black Cat', saleState: 'stock', platforms: [], tags: [] },
      { id: 'b', name: 'Adidas Samba OG', saleState: 'stock', platforms: [], tags: [] },
      { id: 'c', name: 'Nike Dunk Low Panda', saleState: 'stock', platforms: ['Vinted'], tags: [] },
      // Prodaný kus se neinzeruje, tomu je to jedno
      { id: 'd', name: 'Nike Dunk Low Panda', saleState: 'paid', platforms: [], tags: [] },
    ];
    const pocet = igProjedSklad();
    const ma = (id) => (items.find(i => i.id === id).platforms || []).includes('Instagram');
    return { pocet, a: ma('a'), b: ma('b'), c: ma('c'), d: ma('d') };
  });
  check('doplnilo se u dvou kusů', projeti.pocet === 2, String(projeti.pocet));
  check('u shodného ano', projeti.a === true);
  check('u cizího ne', projeti.b === false);
  check('a stávající platformy zůstanou', projeti.c === true);
  check('prodaného se to netýká', projeti.d === false, 'ten se už neinzeruje');

  // ══════════════════════════════════════════════════════════════
  section('6) Seznam se ukládá a synchronizuje');
  const ulozeni = await page.evaluate(() => {
    localStorage.clear();
    saveIgPosts(['Jordan 4 Black Cat 2025', 'Nike Dunk Low Panda']);
    const payload = {};
    syncSettingsToPayload(payload);
    return {
      vUlozisti: getIgPosts().length,
      vBalicku: Array.isArray(payload.igPosts) ? payload.igPosts.length : null,
    };
  });
  check('seznam se uloží', ulozeni.vUlozisti === 2, String(ulozeni.vUlozisti));
  check('a jde do cloudu', ulozeni.vBalicku === 2,
    'bez toho by zůstal jen v tomhle prohlížeči');

  section('7) Vkládání seznamu');
  const vkladani = await page.evaluate(() => {
    localStorage.clear();
    openIgMgr();
    document.getElementById('igPostsInp').value =
      'Jordan 4 Black Cat\n\n  Nike Dunk Low Panda  \nJORDAN 4 BLACK CAT\n\n';
    saveIgMgr();
    const s = getIgPosts();
    document.getElementById('igMgrOverlay').remove();
    return s;
  });
  check('prázdné řádky se zahodí', vkladani.length === 2, JSON.stringify(vkladani));
  check('duplicity taky', vkladani.filter(r => /black cat/i.test(r)).length === 1, JSON.stringify(vkladani));
  check('a mezery se ořežou', vkladani.includes('Nike Dunk Low Panda'), JSON.stringify(vkladani));

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
