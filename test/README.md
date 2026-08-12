# Testy

Testy pouštějí skutečný `index.html` v prohlížeči přes [Playwright](https://playwright.dev/)
a ověřují chování proti reálnému DOM — ne proti kopii logiky. Nic z toho se nenasazuje;
GitHub Pages servíruje jen `index.html` v kořeni.

## Spuštění

```bash
node test/run.js              # kontrola syntaxe + všechny testy
node test/run.js archive      # jen soubory s „archive" v názvu
node test/run.js cache listener
```

Runner nejdřív ověří syntaxi všech `<script>` bloků v `index.html`, a teprve když projde,
pustí testy. Každý soubor jde zvlášť a na konci je souhrn.

Jednotlivý soubor jde spustit i přímo — vypíše každou kontrolu zvlášť:

```bash
node test/test-archive.js
```

## Co je potřeba

- **Node 18+** a balíček `playwright` (globálně nebo v `NODE_PATH`)
- **Chromium**. Runner ho hledá na obvyklých místech; když ho nenajde, nastav cestu ručně:
  ```bash
  CHROMIUM_PATH=/cesta/k/chromium node test/run.js
  ```

## Jak je to postavené

Každý soubor je samostatný skript bez testovacího frameworku. Vypisuje řádky
`PASS —` / `FAIL —` a končí nenulovým kódem, když něco selže. Popisky jsou česky,
ať je z výpisu poznat, co přesně se rozbilo.

Data se do aplikace dostávají přes `localStorage` ještě před načtením stránky
(`addInitScript`), takže test začíná v přesně daném stavu.

`fakefs.js` je náhrada Firestore v prohlížeči — implementuje `doc`, `getDoc`,
`getDocs`, `setDoc`, `writeBatch` i `onSnapshot` nad objektem v paměti. Díky tomu
jde testovat skutečné ukládací a načítací cesty aplikace včetně dávkových zápisů,
výpadků sítě a souběhu dvou zařízení. Pomocné funkce, které dává k dispozici:

| funkce | k čemu |
|---|---|
| `window.__store` | obsah „databáze" jako `{ cesta: dokument }` |
| `window.__load()` | načtení z cloudu přesně jako to dělá posluchač kolekce |
| `window.__doc(name)` | kopie dokumentu (skutečný Firestore taky vrací kopie) |
| `window.__emitSnapshot()` | vyvolá snímek kolekce u přihlášeného posluchače |
| `window.__resetDevice()` | zapomene stav archivů a fotek — jako čerstvé zařízení |
| `window.__failWrites` | `true` = každý zápis selže (test výpadku sítě) |
| `window.__commits`, `window.__lastBatch` | co a kolikrát se zapsalo |

## Obsah

| soubor | co pokrývá |
|---|---|
| `test-smoke.js` | základní průchod aplikací, vykreslení sekcí |
| `test-archive.js` | rozdělení cloudu na hlavní dokument a roční archivy |
| `test-listener.js` | posluchač kolekce — přihlášení, souběh zařízení, chybějící archiv |
| `test-cache.js` | databáze našeptávače — opravy záznamů, testovací položky, správa |
| `test-photo-wish.js` | zmenšování fotek, synchronizace wishlistu |
| `test-photos.js` | vlastní fotky ve vlastních dokumentech |
| `test-syncsettings.js` | jeden seznam synchronizovaných nastavení |
| `test-sidebuttons.js` | postranní tlačítka myši, historie oken |
| `test-platsync.js`, `test-platmgr.js` | platformy a jejich skupiny |
| `test-target.js`, `test-target2.js` | cílové ceny v eurech a kurzy |
| `test-tracking.js` | sledování zásilek při změnách stavu |
| `test-analytics.js`, `test-platsort.js` | analytika a řazení tabulek |
| `test-anim.js` | animace a jejich časování |
| `test-settings.js`, `test-cardfoot.js`, `test-cardmarket.js` | okno nastavení, karty zákazníků, typy kontaktů |
| `test-img.js`, `test-striplog.js`, `test-proflog.js` | obrázky a úklid starých dat |

## Když přidáváš test

Drž se stejného tvaru — funkce `check(popis, podmínka, detail)`, sekce oddělené
`section()`, na konci kontrola, že se nic nevypsalo do konzole jako chyba.
Testy, které schválně vyvolávají chybu, si výpis dočasně vypínají.
