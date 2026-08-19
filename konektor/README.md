# Konektor skladu

Aby šlo na sklad vidět **i v běžném chatu na claude.ai**, na mobilu
a na desktopu — tedy tam, kde není kde spustit program.

`nastroje/sklad.js` funguje jen v sezeních Claude Code, protože potřebuje
počítač, na kterém běží. Obyčejný chat žádný nemá. Konektor to řeší tím,
že běží na veřejné adrese a Claude se na něj připojuje z Anthropicu.

**Jen čtení.** Zápisový kód v `worker.js` není a testy to hlídají. Účet,
pod kterým se hlásí, má navíc zápis zakázaný přímo pravidly Firestore —
viz `nastroje/PRAVIDLA.md`.

## Co poběží kde

```
běžný chat, mobil, desktop, Cowork
            │
            ▼
     Anthropic  ──►  Cloudflare Worker  ──►  Firestore
                     (konektor/worker.js)     (jen čtení)
```

Worker je schválně **jeden soubor bez jediné knihovny**, aby se dal
vložit do editoru v prohlížeči a nasadit bez terminálu a bez `npm`.

## Nastavení

### 1. Vyrob si token

Dlouhý náhodný klíč, který bude součástí adresy. **Jen písmena a číslice**
(v adrese nesmí být speciální znaky), aspoň 32 znaků. Vyrob si ho
v generátoru hesel a ulož stranou — budeš ho potřebovat dvakrát.

### 2. Založ Worker

Na [dash.cloudflare.com](https://dash.cloudflare.com) si udělej účet
(zdarma) a jdi do **Workers & Pages → Create → Start with Hello World
→ Deploy**. Jméno si vyber, objeví se v adrese.

Pak **Edit code**, smaž, co tam je, vlož celý obsah `konektor/worker.js`
a dej **Deploy**.

### 3. Vlož tajemství

Nastavení není v editoru kódu — vrať se z něj na stránku Workeru. Cesta
je **Workers & Pages → Overview → tvůj Worker → Settings → Variables and
Secrets → Add**.

Přidej čtyři, u každé vyber **typ Secret**, ne Text:

| jméno | hodnota |
|---|---|
| `SKLAD_EMAIL` | e-mail účtu jen pro čtení |
| `SKLAD_HESLO` | jeho heslo |
| `SKLAD_UID` | UID majitele (čí data se čtou) |
| `MCP_TOKEN` | token z kroku 1 |

Po přidání znovu **Deploy**.

Tohle je oproti proměnným prostředí v Claude Code zlepšení: Cloudflare má
na tajemství opravdový trezor, po uložení se hodnota už nedá zobrazit.

### 4. Přidej konektor do Clauda

Adresa **není** jen `<jméno-workeru>.workers.dev` — Cloudflare do ní vkládá
i jméno účtu:

```
https://<jméno-workeru>.<jméno-účtu>.workers.dev/<MCP_TOKEN>/mcp
```

Neskládej ji z hlavy. Na stránce Workeru (**Overview**) je nahoře odkaz
se správným tvarem; zkopíruj ho a dopiš za něj token a `/mcp`. Například:

```
https://dawn-bush-6ac21.mtkm-resell.workers.dev/a7Kd…9Xm2/mcp
```

Než adresu vložíš do Clauda, otevři ji v prohlížeči — musí přijít
`{"stav":"ok",…}`.

Na claude.ai jdi do **Customize → Connectors → „+"**, zadej jméno
(třeba „Sklad") a tuhle adresu. Pole pro OAuth nech prázdná.

## Nástroje, které konektor nabízí

| nástroj | k čemu |
|---|---|
| `sklad_souhrn` | čísla — kolik na skladě, čeká, prodáno, po kategoriích a letech |
| `sklad_polozky` | řádky skladu s filtry (stav, profil, kategorie, platforma, hledání) |
| `sklad_prodeje` | prodané, volitelně za jeden rok |
| `sklad_zakaznici` | zákazníci a partneři z CRM |

Odpovědi jsou omezené na 60 položek a zhruba 180 000 znaků; celý sklad má
přes 600 kB a do jedné odpovědi se nevejde. Když je toho víc, konektor to
řekne a poradí zúžit dotaz nebo si vyžádat jen některé sloupce.

Metriky se schválně nepočítají — kurzy EUR umí správně jen aplikace, která
si pamatuje kurz ke dni nákupu i payoutu. Konektor vrací řádky a výpočet
nechává na tom, kdo se ptá.

## Bezpečnost

Adresa je veřejná, takže **token je jediný zámek**. Bez něj server odpoví
404 a nic neprozradí, ani že tam něco je. Porovnání tokenu je odolné vůči
měření času, aby se nedal uhodnout po znacích.

Kdo token má, přečte si sklad. Zapsat nemůže ani s ním — to hlídají
pravidla Firestore, ne tenhle soubor.

**Zneplatnění:** změň `MCP_TOKEN` v Cloudflare, znovu nasaď a v claude.ai
přepiš adresu konektoru. Stará adresa okamžitě přestane fungovat.

Konektor vidí i CRM, tedy jména a telefony tvých zákazníků. Popis nástroje
říká Claudovi, ať s tím zachází úsporně, ale sdílení takových chatů si
rozmysli.

## Testy

```bash
node test/run.js konektor
```

`test-konektor.js` prochází protokol i data proti podstrčenému Firestore —
zámek na adrese, handshake, seznam nástrojů, filtry, ořezávání odpovědí
i to, že se nikam nezapisuje. Bez sítě a bez nasazení.

## Kdyby to nefungovalo

Hláška *„Couldn't register with … sign-in service"* neznamená, že je něco
špatně nastavené v Claudovi. Znamená, že se na server nedovolal a zkusil
náhradní cestu přes OAuth, které tady žádné není. Příčina je vždycky
o krok dřív — server je nedostupný, nebo odmítá adresu.

Pozná se to tak, že se **celá adresa konektoru vloží do prohlížeče**.
Prohlížeč umí jen GET, takže se nic nerozbije, ale server řekne, co se
děje. Token se přitom nikam neposílá — jde jen mezi prohlížečem
a Workerem.

| co se vypíše | čím to je |
|---|---|
| `{"stav":"ok",…}` | server běží, adresa i tajemství sedí — chyba je jinde; ověř `/mcp` na konci a přidej konektor znovu |
| `{"stav":"nenastaveno",…}` | chybí tajemství (jsou vyjmenovaná), nebo se po jejich přidání nenasadilo znovu |
| `Not found` | token v adrese nesedí s `MCP_TOKEN` ve Workeru |
| stránka se nenačte | Worker není nasazený, nebo nesedí jeho jméno v adrese |

Další případy:

| co se děje | čím to bývá |
|---|---|
| „V cloudu nejsou žádná data" | `SKLAD_UID` je UID čtečky místo majitele |
| prázdné odpovědi | pravidla Firestore nepouští čtečku k datům majitele |
