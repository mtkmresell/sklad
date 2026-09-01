# SKLAD

Evidence skladu pro reselling (tenisky, Pokémon karty, LEGO). Jeden uživatel, čeština,
mobil i desktop. Provoz: `index.html` v kořeni, GitHub Pages z větve `main`,
https://mtkmresell.github.io/sklad/

**`mtkmresell.github.io` není z vývojového prostředí dostupná** — nasazení se ověřuje
jen přes GitHub API (workflow „pages build and deployment", id `256573624`), ne curlem.

## Tvar projektu

```
index.html     celá aplikace — 15 900 řádků, 86 % JS, 7 % CSS, 8 % HTML
fonty/         woff2 soubory (Syne, DM Sans, DM Mono) — servírují se z repozitáře
test/          testy (nenasazují se)
zaloha/        ruční zálohy index.html před velkými zásahy
nastroje/      čtečka dat z cloudu pro příkazovou řádku (nenasazuje se)
konektor/      MCP server pro Cloudflare — sklad v běžném chatu + denní upozornění
               e-mailem (nenasazuje se sem, vkládá se ručně do Cloudflare)
firestore.rules  znění pravidel Firestore (do provozu se vkládá ručně v konzoli)
```

Žádný build, žádné závislosti, žádný krok navíc. Aplikace běží i z `file://`.
Externě se načítá jen Firebase SDK. **Nezaváděj build ani balíčkovač** —
bezstavové nasazení a offline provoz jsou záměr, ne opomenutí.

**Fonty se neberou z Googlu.** Leží ve `fonty/` a jsou zapojené přes `@font-face`
s relativní cestou. Bylo to kvůli tomu, že se na jednom zařízení načetly a na jiném
ne (nebo v jiné verzi), takže čísla vypadala pokaždé jinak. Nevracej odkaz na
`fonts.googleapis.com` — hlídá to `test-fonts.js`.

## Pravidla

- **Vše uživatelsky viditelné je česky** — texty, hlášky, popisky. Komentáře v kódu taky.
- Kód je ES5-ish (`var`, `function`) ve starších částech, novější části používají moderní
  zápis. Piš ve stylu okolního kódu, nesjednocuj to plošně.
- Funkce jsou globální (klasické `<script>`, ne moduly). Nové věci drž v IIFE, kde to jde.
- **Každý `<select>` musí projít `initCustomSelect()`** — systémová nabídka se rozbalí
  bíle a do vzhledu aplikace nezapadá. U selectu psaného v HTML se jeho id přidá do
  seznamu při startu, u vzniklého za běhu se `initCustomSelect()` volá ručně. Není to
  vidět, dokud se na nabídku neklikne; hlídá to `test-selecty.js`. Nabídky se pak taky
  samy umí prohledávat psaním (`PSANÍ V DROPDOWNU`) — bez vlastního vzhledu ne.
- Před commitem vždy `node test/run.js`.
- Commituj a pushuj až na vyžádání; pushuje se do `main`.

## Data

`items` je pole v paměti, zrcadlené do `localStorage['sklad_v3']` a do cloudu.
Stav položky je `saleState`: `stock` → `waiting` → `paid`.

U čekajících je ještě `waitState`: `sending` → `sent` → `payout` → `completed`.
**`reklamace` je z té řady vyjmutá** — ztracený balík je pořád čekající prodej
(peníze dorazí od dopravce), takže se chová jako `payout`, jen je jinak
označený. Nedá se do něj procyklovat, nastavuje se ručně v úpravě položky;
`test-reklamace.js` to hlídá.

Reklamace se ale **počítá jinak než ostatní payouty**: běží jí vlastní
třicetidenní lhůta (`REKLAMACNI_LHUTA`) od `reklamaceOd`, ne lhůta
platformy od data prodeje — za zdržení nemůže platforma, ale dopravce.
Ze stejného důvodu se vyplacená reklamace (`zReklamace`) nezapočítává do
`payoutSpeedStats()`; jedna stodenní by z poctivého mediánu udělala
nesmysl. Ta třicítka je i v konektoru, `test-upozorneni.js` je porovnává.

### Cloud (Firestore, kolekce `users/{uid}/sklad`)

| dokument | obsah |
|---|---|
| `data` | sklad, čekající prodeje, nastavení, `savedAt` |
| `sold_ROK` | prodeje podle roku payoutu (`sold_2025`) |
| `photo_IDPOLOŽKY` | vlastní fotka jedné položky (base64) |
| `cache` | databáze našeptávače (názvy, SKU, obrázky) |

CRM je zvlášť v `users/{uid}/crm/main`.

Kdo smí co číst, řeší pravidla Firestore. Kromě majitele jsou dvě role:
**čtečka** pro AI (`nastroje/PRAVIDLA.md`) a **účetní** (`nastroje/UCETNI.md`).
Zapisovat smí jedině majitel.

Znění pravidel je ve `firestore.rules`. **Nenasazuje se samo** — do provozu se
vkládá ručně v konzoli, takže při změně je potřeba upravit obojí. Soubor nese
skutečná UID schválně: dokud tam byly zástupné texty, jednou se publikovala
verze s nimi a odstřihlo to čtečku i účetního. UID nejsou tajemství, přístup
dokazuje přihlášení. `test-pravidla.js` hlídá, že v souboru nezůstal
nevyplněný zástupný text, že zápis nemá povolený nikdo kromě majitele
a že účetní není u CRM — na tom stojí rozdíl mezi zamčeným a schovaným.

**Klíčové vlastnosti, které nesmíš rozbít:**

- Čte se **jedním posluchačem celé kolekce** (`onSnapshot` nad kolekcí), takže hlavní
  dokument i archivy dorazí v jednom konzistentním snímku. Dřív se archivy dotahovaly
  zvlášť přes `getDoc` a na mobilu to selhávalo — **nevracej se k tomu**.
- Zapisuje se **jednou dávkou** (`writeBatch`) — hlavní dokument, změněné archivy
  i fotky. Buď projde všechno, nebo nic.
- Když aplikace nevidí cloud celý (`_cloudIncomplete`), **odmítne do něj zapsat**.
  Bez toho zařízení se starými daty přepsalo novější.
- Rozhodčí při konfliktu je jediné `savedAt` v hlavním dokumentu.
- **Po doletu zápisu uklízí jen ten, který obsahuje současný stav.** Zápis
  letí po síti klidně vteřiny a uživatel mezitím pracuje dál; co udělá
  potom, v odeslaném balíčku není. `fbSaveToCloud` si proto pamatuje
  `_itemsVersion` z okamžiku odeslání a příznak `_dirty` smaže (a `savedAt`
  posune) jen tehdy, když se verze nezměnila — jinak naplánuje doháněcí
  zápis. Bez toho si aplikace myslela, že je srovnaná, cloud o změně
  nevěděl a při dalším startu vyhrál starší cloud: **prodaná položka se
  vracela na sklad**. Hlídá to `test-listener.js`, sekce 9.

### Nastavení: `syncSettings()`

Jeden seznam, ze kterého se odvozuje mazání při odhlášení, stavba balíčku i načítání.
**Nové nastavení přidej jen tam** — nikam jinam se nic dopisovat nemusí. Dřív se to
psalo na tři místa a pětkrát se na jedno zapomnělo.

`test-syncsettings.js` prohání **každou položku seznamu** cestou do cloudu a zpět —
vzorky se vyrábějí ze seznamu, ne ručně, takže nově přidané nastavení je pokryté
samo. Ruční seznam vzorků tuhle chybu jednou propustil.

Hlavní dokument se zapisuje **celý** (`batch.set` bez merge), takže `null` v poli
znamená smazáno pro všechna zařízení. Zařízení, které `keep` nastavení nemá, proto
zapíše zpátky to, co naposledy vidělo v cloudu (`_cloudNastaveni`) — bez toho by
mobil bez daného nastavení umazal, co zapsal počítač. Při odhlášení se ta paměť
maže, jinak by se vylila do dokumentu cizího účtu.

### Instagram

Na Instagramu se příspěvek nikdy nemaže. Když se kus prodá a za rok naskladní
znovu, nabídka tam pořád visí — aplikace by ale hlásila, že není nikde vystavený.
Proto je v nastavení seznam názvů, které na Instagramu už jsou
(`INSTAGRAM — DATABÁZE PŘÍSPĚVKŮ`), a u nové položky se Instagram zaškrtne sám.

Dvě věci se nesmí rozbít:

- **Doplňuje se jen při vzniku položky**, ne při vykreslování. Kdyby to běželo
  pořád, ručně odškrtnutý Instagram by se pokaždé vrátil a nešel by odstranit.
- **Radši nespárovat než spárovat špatně.** Přehlédnutý kus se odklikne ručně,
  ale falešná shoda tvrdí, že je kus vystavený, a přitom není — a majitel
  přijde o prodej, aniž by tušil proč. Proto shoda znamená buď rovnost po
  očištění, nebo celý název obsažený v druhém, a to jen od tří slov výš
  (`IG_MIN_SLOV`); „Nike Dunk" by jinak spárovalo půlku skladu.

Velikosti se schválně neporovnávají, na Instagramu se neuvádí.
`test-instagram.js` hlídá hlavně tu druhou půlku — co se spárovat **nesmí**.

### Přihlašovací brána

Bez přihlášení se z aplikace neukáže nic (`PŘIHLAŠOVACÍ BRÁNA`). Brána je
otevřená rovnou v HTML a stojí na začátku `<body>` — kdyby ji zvedal až JS,
aplikace by při každém načtení blikla. Zavírá ji jen JS, a to ve třech stavech:

- **čekání** — Firebase se ještě neozval. Ukazuje se jen proužek. Formulář
  by tu blikl i majiteli, který přihlášený je.
- **formulář** — Firebase odpověděl, že nikdo.
- **bez cloudu** — Firebase se vůbec nenačetl (`onerror` na modulu, nebo
  se do `_BRANA_CEKANI_MS` neozve nic). **Brána se zvedne a aplikace běží
  lokálně.** Ověřovat se nemá kde a zamčená appka by znamenala, že se
  majitel nedostane ani ke svým datům v `localStorage`; cizímu člověku
  stejně žádná data neukáže. Skutečný zámek nad daty jsou pravidla
  Firestore, brána řeší to, co člověk uvidí.

Formulář má tři panely: přihlášení, registrace a **obnova hesla**. Ta je
schválně vlastní obrazovka — vyplňovat e-mail v přihlášení a teprve pak
klikat na odkaz je naruby. Řádek se souhlasem střídá řádek se zapomenutým
heslem a oba jsou na jednu řádku, aby okno při přepnutí záložky nepodskočilo.

**Obnova hesla nepozná neregistrovaný e-mail** a nejde to obejít.
Firebase má zapnutou ochranu proti vyzrazení e-mailů (Authentication →
Settings → User actions), takže na reset neexistujícího účtu odpoví
`HTTP 200`, jako by odkaz odešel, a při přihlášení vrací obecné
`INVALID_LOGIN_CREDENTIALS` místo `EMAIL_NOT_FOUND`. Je to schválně:
jinak by si kdokoli přes formulář zjistil, které adresy tu mají účet.
Spolehlivá odpověď by chtěla servisní klíč na serveru, a ten tenhle
projekt schválně nemá. Ohlídá se proto aspoň tvar adresy a hláška po
odeslání **neslibuje doručení**. Kdyby se ochrana v konzoli vypnula,
`auth/user-not-found` se už zpracovává a neregistrovaná adresa se
odmítne sama. Odmítnutí zní vždycky „Neplatný email“ — pokažený
i neregistrovaný e-mail jsou z pohledu člověka u formuláře totéž.

Dvě věci se snadno rozbijí: `.mo.open` má animaci, která roztmívá pozadí
do `rgba(0,0,0,0.82)` — brána si ji ruší přes `.mo.brana.open`, jinak by
aplikace pod ní prosvítala (a protože animace přebíjí obyčejné deklarace,
neplatilo by ani `background`). A globální Escape zavírá `.mo.open`,
takže brána musí zůstat vyjmutá přes `:not(.brana)`.
`test-brana.js` hlídá obojí i uvítací okno.

### Prodejní doklad

Datum na dokladu je **datum vyplacení**, ne datum prodeje — v daňové
evidenci se příjem počítá dnem, kdy peníze dorazily. Popisek je proto
jen „Datum". Dokud payout nedorazil, použije se datum prodeje.

Strany jsou **Dodavatel a Odběratel**, ne Prodávající a Kupující — tak
to má účetní na všem ostatním, co mu chodí. Místo prodeje na dokladu
není: odběratel je vypsaný nahoře.

Závazná částka je **v měně, ve které prodej proběhl**. Přepočet na
koruny je pod ní, ale **drobně** — dřív byl stejně výrazný jako hlavní
suma a vypadalo to, že jsou částky dvě. Kurz je ten uložený ke dni
vyplacení, nikdy dopočítaný dnešním, a datum odkazuje na denní kurz ČNB
toho dne. „kurz ČNB" se napíše **jen když ten uložený opravdu z ČNB je**
(`payoutRateCnb`); u starších prodejů pochází z kurzovního API a tvrdit
u nich ČNB by účetní odhalil jedním kliknutím.

*Nastavení → Přepočítat kurzy ČNB* (`recalcAllRates`) přepočítá uložené
kurzy u všech eurových položek. Volá `fetchRateForDate(datum, true)` —
vynucení přeskočí kurz zapamatovaný z doby, kdy se ČNB nevolala, jinak by
se přepočet do ČNB nikdy nedostal a jen přepsal staré hodnoty týmiž.
Po dokončení se říká, kolik kurzů opravdu z ČNB je.

`fetchRateForDate()` (kurz ke dni nákupu/payoutu) i `fetchCnbRate()`
(dnešní kurz pro odhady) berou ČNB jako první zdroj, kurzovní API zůstala
jako záloha. **Dosažitelnost ČNB z prohlížeče nebyla ověřena** — z vývojového
prostředí je cnb.cz blokovaná. Kdyby ji CORS odmítl, spadne se na zálohu
a všechno funguje jako dřív, jen se nikde nenapíše ČNB. V *Nastavení*
je u kurzu vidět, odkud přišel — dokud tam stálo jen číslo, nikdo si
nevšiml, že `fetchCnbRate()` má ČNB jen ve jméně a ve skutečnosti ji
nikdy nevolala.

Kam poslat peníze, se bere z `ÚDAJE U ZPŮSOBU VYPLACENÍ` — u eurového
prodeje IBAN, jinak číslo účtu, a když ten správný chybí, ten druhý.
Údaje visí na názvu možnosti, takže **přejmenování v editoru dropdownů
je musí přenést s sebou**, jinak by z dokladu zmizely bez vysvětlení.
Hlídá to `test-saledoc.js` a `test-payout.js`.

### Fotky

V paměti a v `localStorage` je fotka v položce jako `imgUrl` (data URI). Do cloudu jde
zvlášť a v položce zůstane `hasPhoto: 1`. Vykreslování a export tedy fotky vidí normálně.
Odkazované obrázky (StockX) jsou jen adresy a nikam se nepřesouvají.

## Kde co hledat

Sekce v `index.html` jsou označené hlavičkami v komentářích — grepni podle názvu:

| co | kotva v souboru |
|---|---|
| synchronizovaná nastavení | `CO SE SYNCHRONIZUJE` |
| rozdělení cloudu, archivy | `ROZDĚLENÍ CLOUDU` |
| fotky | `VLASTNÍ FOTKY` |
| ukládání do cloudu | `fbSaveToCloud`, `_buildCloudPayload` |
| načítání z cloudu | `_collectCloud`, `_applyCloudData` |
| posluchač Firestore | `fb-auth` |
| databáze našeptávače | `HISTORICKÝ CACHE POLOŽEK`, `SPRÁVA NAŠEPTÁVAČE` |
| automatické zálohy | `AUTOMATICKÉ SNAPSHOTY` |
| profily (Podnikání/Osobní) | `PROFILY` |
| pohled účetního | `POHLED ÚČETNÍHO` |
| přihlašovací brána | `PŘIHLAŠOVACÍ BRÁNA` |
| limit identifikované osoby | `RETAILEŘI & LIMIT` |
| animace | `ANIMACE` (v CSS) |
| postranní tlačítka myši | `POSTRANNÍ TLAČÍTKA MYŠI` |
| cashflow z payoutů | `CASHFLOW Z PAYOUTŮ` |
| prodejní doklad | `PRODEJNÍ DOKLAD` |
| údaje u způsobu vyplacení | `ÚDAJE U ZPŮSOBU VYPLACENÍ` |
| typ dokladu u místa prodeje | `TYP DOKLADU U MÍSTA PRODEJE` |
| analytika zákazníků a partnerů | `ANALYTIKA ZÁKAZNÍKŮ` |
| zdroj poptávky u prodeje | `ZDROJ POPTÁVKY` |
| nabídka zákazníkovi | `OFFER BUILDER` |
| export dat pro analýzu | `ANALYTICKÝ EXPORT` |
| historie cen položky | `HISTORIE CEN U POLOŽKY` |
| psaní v rozbalovací nabídce | `PSANÍ V DROPDOWNU` |
| databáze příspěvků na Instagramu | `INSTAGRAM — DATABÁZE PŘÍSPĚVKŮ` |

## Čtení dat mimo prohlížeč

`nastroje/sklad.js` přečte cloud z příkazové řádky (`node nastroje/sklad.js souhrn`),
aby se nemusela otevírat aplikace. **Jen čte** — kód pro zápis tam není a testy to
hlídají. Přihlašuje se běžným účtem přes proměnné `SKLAD_EMAIL` a `SKLAD_HESLO`,
takže platí stejná pravidla Firestore jako v aplikaci; žádný servisní klíč.
Metriky nepočítá schválně — kurzy EUR umí správně jen aplikace a druhá
implementace by se s ní rozešla. Podrobnosti v `nastroje/README.md`.

`konektor/worker.js` dělá totéž pro běžný chat na claude.ai, mobil a desktop,
kde není kde spustit program — je to MCP server pro Cloudflare Worker. Čtecí
logiku má schválně vlastní, protože se vkládá do prohlížeče jako jeden soubor
bez knihoven; `test-shoda.js` prohání obě cesty stejnými daty a porovnává,
co z nich vypadne, aby se ty dvě kopie nerozešly.
Podrobnosti v `konektor/README.md`.

Konektor navíc jednou denně obhlíží sklad a posílá e-mail, když je co říct —
vypršení inzerátů na Bazoši, zaseknuté zásilky a payouty, pondělní obhlídku, měsíční souhrn
(sekce `UPOZORNĚNÍ E-MAILEM`). **Nehlásí stav, ale okamžik:** každá věc se
ozve jen ten den, kdy dojde na daný práh, takže většinu dní nepřijde nic.
Kdyby se z prahu udělal rozsah („zbývá 7 dní a míň"), mail by chodil denně
a přestal by se číst; `test-upozorneni.js` to hlídá. Do běžných upozornění
schválně nejdou částky (kurzy EUR) ani cokoli z CRM (jde přes cizí službu).

**Měsíční report je z toho výjimka** — peníze i počty zákazníků v něm jsou,
majitel o to stál. Smí se to, protože u prodaných kusů je kurz uložený
(`buyRateEur`, `payoutRateEur`, `profitRateEur`) a počítá se z něj; navíc
uložený zisk má přednost před dopočítaným, ať report ukazuje totéž co
obrazovka. Vzorec je tím pádem na dvou místech — tady a v `_itemProfit()`.
CRM se čte **jen prvního** a jdou z něj jen počty, nikdy jména.

Tři věci se hlásí schválně jinak, než by se čekalo. **Inzerát až v den
vypršení**, ne dopředu — Bazoš ho archivuje a nahodí se jedním kliknutím,
takže předem se nedá dělat nic než ho smazat a vystavit znovu. **Pondělní
obhlídka** je jediná, která hlásí stav místo okamžiku: chodí každé pondělí,
protože o to majitel stál, ale mlčí, když není co projít. **Payout
podle lhůty nastavené u platformy** (`getPayoutDays` v aplikaci, *Nastavení
→ místa prodeje*), pak po týdnech. Ta čísla jsou tím pádem na dvou místech;
`test-upozorneni.js` porovnává `DEFAULT_PAYOUT_DAYS` s konstantami
v konektoru, aby se nerozešla.

Nejdelší funkce (nad 200 řádků) jsou vykreslovací: `renderSoldAnalytics`,
`openDropdownsEditor`, `saveItem`, `renderStockAnalytics`, `tableHTML`, `openBulkEditModal`.
Medián je 12 řádků — soubor je velký, ale ne zanesený.

## Rozdělaná témata

Domluvené, ale zatím neudělané. **Připomeň je, dokud se nezavřou** — majitel
o ně stojí, jen na ně nebyl čas. Až se některé dotáhne, smaž ho odsud.

**Doklady za měsíc v jednom souboru.** Typ dokladu u místa prodeje už
existuje (`TYP DOKLADU U MÍSTA PRODEJE`), takže to, co tohle blokovalo, je
vyřešené. Zbývá samotný export: sloučit doklady za měsíc do jednoho
souboru, každý na své stránce, ať se účetnímu nestahují po kusech.

**Upozornění e-mailem — kód hotový, čeká na zapojení.** Je v konektoru
(`UPOZORNĚNÍ E-MAILEM`), ale běžet začne, až majitel v Cloudflare doplní
`RESEND_API_KEY` a `MAIL_KOMU` a přidá dva cron triggery. Postup je
v `konektor/README.md`. **Ptej se, jestli to zapojil** — do té doby to
je jen kód v repozitáři. Telegram se zvažoval a majitel ho odmítl:
nepoužívá ho a časem by ho ignoroval.

**Vlastní účet pro konektor.** Konektor i čtečka se hlásí stejným účtem, jehož
heslo leží na dvou místech (prostředí Claude Code a trezor Cloudflare). Vypnout
jedno bez druhého nejde. Druhý účet by je oddělil. Není to nutné, je to úklid.

## Testy

```bash
node test/run.js              # kontrola syntaxe + všech 49 souborů
node test/run.js archive      # jen vybrané
```

Testy jedou proti skutečnému `index.html` v Chromiu přes Playwright. Firestore
nahrazuje `test/fakefs.js` — implementuje `writeBatch`, `onSnapshot` nad kolekcí,
výpadky sítě i souběh dvou zařízení. Podrobnosti v `test/README.md`.

Když měníš cokoli kolem ukládání, pusť aspoň `test-archive`, `test-listener`,
`test-syncsettings` a `test-photos`.

## Časté pasti

- **`saveItem()` je asynchronní** (čeká na kurz ČNB). V testech na změnu čekej, ne `sleep`.
- Modální okna mají třídu `mo`, otevírají se přidáním `open`. Existuje posluchač
  „klik mimo okno = zavřít" v bublací fázi — kdo potřebuje být dřív, musí do capture.
- V číslech se používají pevné mezery (` `, ` `); v testech je normalizuj.
- `clearSkladLocalStorage()` maže při odhlášení — co není v `syncSettings()`, to zmizí.
- Kurz EUR se pamatuje ke dni nákupu i payoutu. Nikdy nepřepočítávej zpětně dnešním kurzem.
- **V testech nepiš pevná data, když se pak měří stáří.** `buyDate: '2026-07-29'`
  bylo při psaní „před 20 dny", za měsíc z toho bylo 30 a test spadl beze změny
  v kódu. Počítej je ode dneška: `new Date(Date.now() - 20*DEN).toISOString().slice(0,10)`.
