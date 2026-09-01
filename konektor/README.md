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

Adresa má **tři** části: jméno workeru, jméno účtu a `workers.dev`.

```
https://<jméno-workeru>.<jméno-účtu>.workers.dev/<MCP_TOKEN>/mcp
```

Na jméno účtu se snadno zapomene a chyba se pak špatně hledá — hostitel
se nepřeloží a Claude hlásí jen „chyba", ze které důvod nepoznáš.
Neskládej adresu z hlavy: v Cloudflare je vypsaná u Workeru pod
**Settings → Domains & Routes**. Zkopíruj ji a dopiš za ni token a `/mcp`.

Tady je pro pořádek ta skutečná (tajný je jen token, adresa ne):

```
https://dawn-bush-6ac21.mtkm-resell.workers.dev/<MCP_TOKEN>/mcp
```

Než adresu vložíš do Clauda, otevři ji v prohlížeči — musí přijít
`{"stav":"ok",…}`.

Na claude.ai jdi do **Customize → Connectors → „+"**, zadej jméno
(třeba „Sklad") a tuhle adresu. Pole pro OAuth nech prázdná.

## Kurz ČNB pro aplikaci

V daňové evidenci je závazný denní kurz ČNB. Aplikace si ho ale
z prohlížeče stáhnout **nemůže** — cnb.cz nepovoluje volání z cizí
stránky (CORS). Není to domněnka: v provozu se ze 111 kurzů podařilo
z ČNB získat **nula**. Aplikace proto celou dobu počítala kurzy
z kurzovních API, i když se funkce jmenovala „ČNB".

Worker žádné CORS neřeší, protože běží na serveru. Má proto adresu

```
https://sklad.TVUJ-UCET.workers.dev/kurz            → dnešní kurz
https://sklad.TVUJ-UCET.workers.dev/kurz/2026-08-12 → kurz k datu
```

která vrátí `{"kurz":24.19,"datum":"2026-08-12","zdroj":"cnb"}`.

**Tahle adresa schválně nemá token.** Volá ji aplikace z prohlížeče,
takže by token musel ležet v ní — a ten samý token pouští přes `/mcp`
ke všem datům skladu. Kurzy ČNB jsou veřejná data, není co chránit.
Adresa je zato úzká: bere jen datum ve tvaru `RRRR-MM-DD` a chodí
výhradně na ČNB, takže z ní nejde udělat průchozí proxy na cokoli
jiného. Hlídá to `test-konektor.js`.

### Zapojení

1. Nasaď aktuální `worker.js` (Cloudflare → Worker → *Edit code* → vlož → *Deploy*).
2. V aplikaci **Nastavení → Kurz EUR/CZK** vlož adresu workeru
   (stačí `https://sklad.TVUJ-UCET.workers.dev`, bez tokenu) a dej *Vyzkoušet*.
   Musí se ukázat dnešní kurz ČNB.
3. Pak **Nastavení → Přepočítat kurzy ČNB** — po dokončení se říká, kolik
   kurzů opravdu z ČNB je. Chceš tam vidět „všechny kurzy z ČNB".

Dokud adresa vyplněná není, kurzy chodí z kurzovních API jako dřív
a nikde se netvrdí, že jsou z ČNB.

## Upozornění e-mailem

Aplikace je stránka v prohlížeči a sama od sebe nikdy nic nespustí. Worker
ale běží pořád, takže se **jednou denně v deset dopoledne** podívá do skladu
a když je co říct, pošle mail.

Hlásí pět věcí:

| co | kdy se ozve |
|---|---|
| inzerát na Bazoši vypršel | v den vypršení |
| zásilka je dlouho na cestě | po 5 dnech od odeslání, pak každý týden |
| prodej čeká na payout | v den, kdy měly peníze dorazit, a pak každý týden |
| pondělní obhlídka | každé pondělí, když je co projít |
| report za minulý měsíc | prvního |

Bazoš se hlídá **na všech třech** — `.cz`, `.sk` i `.pl`. V měsíčním souhrnu
se ale řádek pro danou zemi objeví, jen když tam něco vystaveného je.

**Většinu dní nepřijde nic** — a tak to má být. Nehlásí se stav („zbývá
sedm dní"), ale okamžik. Kdyby chodil mail každé ráno, po týdnu by se
přestal otevírat.

**Inzerát se hlásí až v den vypršení, ne dopředu.** Bazoš inzerát nemaže,
jen ho odloží do archivu a odtud se nahodí jedním kliknutím. Předem se
tedy stejně nedá dělat nic jiného než ho smazat a vystavit celý znovu,
což je horší než počkat.

**Lhůta payoutu se bere z nastavení aplikace.** Kolik dní se u které
platformy čeká, se nastavuje v *Nastavení → místa prodeje*; konektor
sahá po stejném čísle jako odhad cashflow v aplikaci (`getPayoutDays`).
Když tam nic není, platí výchozí hodnoty podle skupiny — platformy 7 dní,
e‑shopy 21, místní prodej 3, jinak 14. První upomínka přijde v den, kdy
měly peníze dorazit, a pak jednou týdně, dokud se to nevyřeší.

Aplikace umí lhůtu odhadnout ještě z mediánu skutečných payoutů, když má
u platformy aspoň tři dokončené prodeje. Konektor se schválně drží jen
nastavení: druhá implementace statistiky by se s aplikací dřív nebo
později rozešla a mail by upomínal proti jiným číslům, než jaká jsou
vidět na obrazovce. `test-upozorneni.js` porovnává aspoň ta čísla, aby
se nerozešla ani ta.

Sledovací číslo je v mailu **proklikové** — adresa se bere z `trackingUrl`
uložené u položky, takže se tabulka dopravců nedrží na druhém místě. Do
odkazu projdou jen adresy začínající `http` nebo `https`; `javascript:`
v href by z upozornění udělal zbraň. V prosté textové verzi zůstane jen
číslo, adresa by řádek rozbila.

**Reklamace má vlastní lhůtu.** Ztracený balík řeší dopravce, ne
platforma, takže se u něj nepočítá lhůta místa prodeje, ale třicet dní
od `reklamaceOd` — data, kdy se prodej jako reklamace označil. Musí to
být totéž číslo jako `REKLAMACNI_LHUTA` v aplikaci, jinak by mail
upomínal jindy, než co ukazuje odhad na obrazovce; test to porovnává.

**Zásilka se počítá od `sentAt`** — data, které si aplikace zapíše při
přechodu do stavu „odesláno". Kusy označené dřív, než tohle pole vzniklo,
ho nemají a počítají se od data prodeje; bývá to týž nebo následující
den, takže se tím nanejvýš ozveme o kousek dřív.

**Pondělní obhlídka je jediná, která hlásí stav, ne okamžik.** Chodí
každé pondělí, protože o to majitel stál — je to připomínka rituálu, ne
událost. Vypisuje kusy na skladě, které nejsou nikde vystavené, a kusy
v komisi (platformy ze skupiny *eshopy*). Když není co projít, mlčí
i v pondělí, jinak by z ní byl otravný budík. Dlouhý výčet se zkracuje,
protože se stejně nečte a jen nafoukne zprávu.

Pod čarou je jen odkaz do aplikace. Kdo mail dostane, ví, odkud přišel;
připomínat to je plýtvání místem. Výjimka je report — u částek má čtenář
právo vědět, odkud se berou.

**V běžných upozorněních nejsou částky.** Kurzy EUR umí správně jen
aplikace, která si pamatuje kurz ke dni nákupu i payoutu. Nejsou tam ani
jména zákazníků — mail jde přes cizí službu a v CRM nemá co pohledávat.

### Měsíční report

Jediná zpráva, ve které peníze i čísla ze CRM jsou. Bez tržby a zisku by
report nedával smysl a majitel o něj výslovně stál.

Počítat se to smí proto, že **u prodaných kusů kurz známý je** — aplikace
si u každého uloží kurz ke dni nákupu i payoutu (`buyRateEur`,
`payoutRateEur`, `profitRateEur`) a počítá z nich, ne z dnešního.
Konektor sahá po týchž číslech a **uložený zisk má přednost před
dopočítaným**, aby report ukazoval totéž co obrazovka. Kus, u kterého
kurz uložený není, se počítá záložním kurzem a ve zprávě se přizná,
kolika kusů se to týká.

Vzorec je tím pádem na dvou místech — tady a v `_itemProfit()` v aplikaci.
`test-upozorneni.js` proto počítá modelový měsíc na korunu a ověřuje
i tu přednost uloženého čísla.

**Balíky** se musí rozlišit: peníze nese hlavička (`type: 'bulk'`), kusy
v ní mají `sellPrice: 0`. Do tržby jdou hlavičky a kusy mimo balík, do
počtu kusů naopak členové a hlavička ne. Jinak by se nákup započítal
dvakrát nebo by balík vyšel jako jeden kus.

Ze CRM jde do zprávy **jen počet** nových a celkových zákazníků, nikdy
jméno ani kontakt. A **CRM se čte jen prvního** — po zbytek měsíce se do
něj konektor vůbec nepodívá, ať se cizí osobní údaje netahají ze serveru
kvůli mailu, ve kterém stejně nemají co dělat.

Report obsahuje: tržbu, náklady, zisk, marži, ROI, počet kusů, zisk na
kus a obvyklou dobu držby; srovnání zisku, tržby a kusů s minulým měsícem
a s průměrem půl roku zpět; rozpad podle místa prodeje a kategorie;
nejlepší a nejhorší obchod; a stav skladu k dnešku včetně vázaného
kapitálu.

**Barvy jsou stavové, ne ozdobné.** Zelená `#c8ff00`, oranžová `#ffaa00`
a červená `#ff4444` — tytéž, kterými aplikace značí zisk a stavy položek.

Poměrová čísla (marže, ROI, zisk na kus) se barví podle **vlastní historie
skladu**, ne podle vymyšlené hranice: srovnává se s průměrem půl roku zpět
a kolem něj je osmiprocentní pásmo, ve kterém se nic nehlásí. Co je „dobrá
marže", ví jedině tenhle sklad; pevná hranice by lhala. Stejně je na tom
řádek *nejdéle leží* — hlásí se, až kus překročí trojnásobek obvyklé držby,
protože pevný počet dní znamená u tenisek něco jiného než u LEGA.

**Barva nikdy nestojí sama.** U každého obarveného čísla je i znaménko,
šipka nebo slovo (`▲ nad obvyklým`, `ztráta`). Jednak kvůli barvosleposti —
zelená a oranžová jsou pro deuteranopa blízko sebe — jednak proto, že
textová verze zprávy žádné barvy nemá a musí říct totéž. Hlídá to test.

V rozpadu prodejů je u každého řádku proužek, jehož **délka** ukazuje podíl
na nejlepším řádku. Informaci nese délka, ne barva.

### Jak mail vypadá

Posílá se **v HTML i jako prostý text zároveň** a klient si vybere. Bez
textové verze by prázdno viděl každý, kdo si HTML nezobrazuje.

Obě podoby vznikají z týchž dat (`textZpravy` a `htmlZpravy` nad stejnými
bloky). Kdyby si každá skládala zprávu po svém, dřív nebo později by se
rozešly — proto bloky vrací holá data, ne hotový text.

Vzhled je vzatý z aplikace: pozadí `#0f0f0f`, limetkový akcent `#c8ff00`,
vlasové linky `#2e2e2e`. **Písma se převzít nedají** — Syne ani DM Sans se
do mailu nenačtou, poštovní klienti vlastní fonty ignorují. Shodná je tedy
barva a rozvržení, ne písmo.

HTML je schválně z tabulek a stylů psaných přímo u prvků. Není to lenost:
flexbox, grid ani `<style>` v hlavičce poštovní klienti spolehlivě neumí
a Outlook z toho udělá kaši. Ze stejného důvodu v mailu nejsou obrázky —
a taky proto, že mail bez obrázků má menší šanci skončit v hromadné poště.

Názvy položek si píše uživatel a jdou rovnou do HTML, takže se ošetřují
(`esc`). Ostrá závorka v názvu by jinak rozhodila značky. Hlídá to test.

### 1. Založ si Resend

Poštu neumí Cloudflare sám od sebe poslat. [resend.com](https://resend.com)
má zdarma 3 000 mailů měsíčně, což je pro tohle mnohonásobně dost.

Zaregistruj se **stejným e-mailem, na který chceš upozornění dostávat**.
Bez vlastní domény totiž Resend pouští maily jen na adresu, kterou se
účet zakládal — což je tady spíš pojistka než překážka.

Pak **API Keys → Create API Key**, oprávnění stačí *Sending access*.
Klíč začíná `re_` a ukáže se jen jednou; zkopíruj si ho.

### 2. Přidej dvě tajemství

Stejná cesta jako minule — **Workers & Pages → tvůj Worker → Settings →
Variables and Secrets → Add**, typ **Secret**:

| jméno | hodnota |
|---|---|
| `RESEND_API_KEY` | klíč z kroku 1 (`re_…`) |
| `MAIL_KOMU` | e-mail, kam mají upozornění chodit |

Pak **Deploy**.

### 3. Nastav hodiny

**Settings → Triggers → Cron Triggers → Add Cron Trigger.** Přidej dva:

```
0 8 * * *
0 9 * * *
```

Cloudflare umí spouštět jen podle světového času (UTC) a Praha je proti
němu v létě o dvě hodiny napřed a v zimě o jednu. Worker si sám ohlídá,
kterému z těch dvou časů zrovna vychází desátá dopoledne v Praze, a ten druhý
zahodí. Díky tomu se nemusí nic přenastavovat dvakrát do roka.

### 4. Vyzkoušej to

Vlož do prohlížeče adresu Workeru zakončenou `/test-mail`:

```
https://<jméno-workeru>.<jméno-účtu>.workers.dev/<MCP_TOKEN>/test-mail
```

Pošle mail hned, i když zrovna není co hlásit. Odpoví `{"stav":"odeslano"}`.
**Kdyby nepřišel, mrkni do spamu** a označ ho jako „není spam" — poprvé to
občas potřeba je, protože odesílatel je sdílená adresa Resendu.

Se `/nahled` místo `/test-mail` uvidíš, co by dnes ráno přišlo, **aniž by
se cokoli odeslalo**. Užitečné, když chceš jen zkontrolovat, že Worker na
data vidí.

| co se vypíše | čím to je |
|---|---|
| `{"stav":"odeslano",…}` | hotovo, koukni do schránky |
| `{"stav":"nenastaveno","chybi":[…]}` | chybí tajemství, nebo se po jejich přidání nenasadilo znovu |
| `"chyba":"odeslání selhalo …"` | pošta odmítla; u chyby je i `rada`, co s tím |
| `Not found` na `/nahled` i `/test-mail` | v Cloudflare běží starší kód — vlož worker.js znovu a nasaď |

U odmítnuté pošty se hláška od Resendu rozbalí do čitelné věty a přidá se
k ní `rada` v češtině. Nejčastější je tahle: **bez ověřené domény pouští
Resend maily jen na adresu, kterou jsi zakládal účet** — takže `MAIL_KOMU`
musí být ona, dokud si doménu neověříš.

### Až budeš mít vlastní doménu

Volitelné tajemství `MAIL_ODESILATEL` přepíše odesílatele — třeba
`Sklad <sklad@tvojedomena.cz>`. Bez něj se posílá z `onboarding@resend.dev`.
Až doména v Resendu projde ověřením, `MAIL_KOMU` může být jakákoli adresa.

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

Adresy `/nahled` a `/test-mail` jsou za stejným zámkem jako `/mcp` — bez
tokenu odpoví 404. Upozornění chodí jen na `MAIL_KOMU`; kdo by token
získal, adresu nezmění, protože je v trezoru Cloudflare, ne v odkazu.

**Co odchází do Resendu:** názvy položek, kde se prodalo, data a počty.
Žádné částky a **nikdy nic z CRM** — jména ani telefony zákazníků se do
zprávy nedostanou a při denní obhlídce se CRM ani nečte. Hlídá to test.

## Testy

```bash
node test/run.js konektor upozorneni
```

`test-konektor.js` prochází protokol i data proti podstrčenému Firestore —
zámek na adrese, handshake, seznam nástrojů, filtry, ořezávání odpovědí
i to, že se nikam nezapisuje. Bez sítě a bez nasazení.

`test-upozorneni.js` dělá totéž pro upozornění: podstrčí Firestore, poštu
i čas a projde každý den života inzerátu i prodeje, aby ověřil, kdy přesně
se ozvou. Kdyby se z prahu někdy stal rozsah, mail by chodil denně —
a tenhle test to zachytí. Hlídá taky přepnutí letního času, lhůty payoutu
podle nastavení platforem, chování při výpadku pošty a to, že ve zprávě
nejsou peníze ani zákazníci.

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
| upozornění nechodí vůbec | nejsou nastavené cron triggery, nebo `/test-mail` hlásí chybu |
| upozornění nechodí, `/test-mail` projde | nejspíš prostě není co hlásit — ověř `/nahled` |
| chodí, ale padají do spamu | označ jednou „není spam", případně si na ně udělej filtr |

Cron se dá zkontrolovat i zpětně: **Workers & Pages → tvůj Worker →
Logs**. U každého ranního běhu je vidět, jestli něco odešlo, nebo proč ne.
