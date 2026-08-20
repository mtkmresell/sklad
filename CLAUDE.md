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
konektor/      MCP server pro Cloudflare — sklad v běžném chatu (nenasazuje se sem)
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
- Před commitem vždy `node test/run.js`.
- Commituj a pushuj až na vyžádání; pushuje se do `main`.

## Data

`items` je pole v paměti, zrcadlené do `localStorage['sklad_v3']` a do cloudu.
Stav položky je `saleState`: `stock` → `waiting` → `paid`.

### Cloud (Firestore, kolekce `users/{uid}/sklad`)

| dokument | obsah |
|---|---|
| `data` | sklad, čekající prodeje, nastavení, `savedAt` |
| `sold_ROK` | prodeje podle roku payoutu (`sold_2025`) |
| `photo_IDPOLOŽKY` | vlastní fotka jedné položky (base64) |
| `cache` | databáze našeptávače (názvy, SKU, obrázky) |

CRM je zvlášť v `users/{uid}/crm/main`.

Kdo smí co číst, řeší pravidla Firestore (žijí jen v konzoli, ne v repozitáři).
Kromě majitele jsou tři role: **čtečka** pro AI (`nastroje/PRAVIDLA.md`),
**účetní** (`nastroje/UCETNI.md`) a nikdo jiný. Zapisovat smí jedině majitel.

**Klíčové vlastnosti, které nesmíš rozbít:**

- Čte se **jedním posluchačem celé kolekce** (`onSnapshot` nad kolekcí), takže hlavní
  dokument i archivy dorazí v jednom konzistentním snímku. Dřív se archivy dotahovaly
  zvlášť přes `getDoc` a na mobilu to selhávalo — **nevracej se k tomu**.
- Zapisuje se **jednou dávkou** (`writeBatch`) — hlavní dokument, změněné archivy
  i fotky. Buď projde všechno, nebo nic.
- Když aplikace nevidí cloud celý (`_cloudIncomplete`), **odmítne do něj zapsat**.
  Bez toho zařízení se starými daty přepsalo novější.
- Rozhodčí při konfliktu je jediné `savedAt` v hlavním dokumentu.

### Nastavení: `syncSettings()`

Jeden seznam, ze kterého se odvozuje mazání při odhlášení, stavba balíčku i načítání.
**Nové nastavení přidej jen tam** — nikam jinam se nic dopisovat nemusí. Dřív se to
psalo na tři místa a pětkrát se na jedno zapomnělo.

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
| limit identifikované osoby | `RETAILEŘI & LIMIT` |
| animace | `ANIMACE` (v CSS) |
| postranní tlačítka myši | `POSTRANNÍ TLAČÍTKA MYŠI` |
| cashflow z payoutů | `CASHFLOW Z PAYOUTŮ` |
| prodejní doklad | `PRODEJNÍ DOKLAD` |
| analytika zákazníků a partnerů | `ANALYTIKA ZÁKAZNÍKŮ` |
| zdroj poptávky u prodeje | `ZDROJ POPTÁVKY` |
| nabídka zákazníkovi | `OFFER BUILDER` |
| export dat pro analýzu | `ANALYTICKÝ EXPORT` |
| historie cen položky | `HISTORIE CEN U POLOŽKY` |

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

Nejdelší funkce (nad 200 řádků) jsou vykreslovací: `renderSoldAnalytics`,
`openDropdownsEditor`, `saveItem`, `renderStockAnalytics`, `tableHTML`, `openBulkEditModal`.
Medián je 12 řádků — soubor je velký, ale ne zanesený.

## Testy

```bash
node test/run.js              # kontrola syntaxe + všech 33 souborů
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
