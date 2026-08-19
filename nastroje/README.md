# Čtečka skladu

Program, který přečte data z cloudu a vypíše je. Díky tomu se dá na sklad
zeptat rovnou, bez otevírání aplikace v prohlížeči.

**Jen čte.** Nic nemění, nemaže ani nepřidává. Kód pro zápis v `sklad.js`
není — viz hlavička souboru.

## Jak se přihlašuje

Stejným e-mailem a heslem jako do aplikace. Přihlášení hlídá Firestore
úplně stejně jako v prohlížeči, takže program vidí přesně to, co bys viděl
ty po přihlášení — svoje data a nic jiného.

Není tu žádný servisní klíč. Ten by šel kolem pravidel a otevřel celý
projekt; tenhle program stojí ve stejné frontě jako aplikace.

## Nastavení

Program bere přihlašovací údaje z proměnných prostředí:

```
SKLAD_EMAIL=tvuj@email.cz
SKLAD_HESLO=tvojeheslo
SKLAD_UID=…            nepovinné — čí data číst, bez toho svoje
```

**Do repozitáře heslo nepatří** — je veřejný.

`SKLAD_UID` je potřeba jen tehdy, když program běží pod účtem zřízeným
jen pro čtení. Ten má vlastní prázdnou složku, takže se mu musí říct,
do čí kóje se má dívat. Návod na takový účet je v `PRAVIDLA.md` a je to
bezpečnější varianta — zápis pak odmítá server, ne jen absence kódu.

### V cloudovém sezení (Cowork, Claude Code na webu)

V rozhraní na [claude.ai/code](https://claude.ai/code) otevři nastavení
prostředí (ikona mráčku) a do pole s proměnnými přidej ty dva řádky ve
tvaru `KLÍČ=hodnota`. Změna platí pro sezení, která spustíš potom —
běžící sezení si hodnoty načetla při startu a znovu je nečtou.

> **Přečti si to, než to uděláš.** Dokumentace Claude Code říká
> u proměnných prostředí doslova: *hodnoty si přečte každý, kdo prostředí
> používá, a cloudová prostředí nemají trezor na hesla, takže sem
> nedávej klíče ani přihlašovací údaje.* Trezor, kam by heslo patřilo,
> zkrátka neexistuje — proměnná prostředí je jediná cesta, jak ho tam
> dostat.
>
> Co s tím prakticky:
>
> - **Měj na aplikaci vlastní heslo, které nepoužíváš nikde jinde.**
>   Tohle je nejdůležitější. Kdyby uniklo, jde o sklad a nic víc,
>   a zneplatníš ho změnou hesla.
> - **Nesdílej taková sezení veřejně.** U účtů Pro a Max znamená sdílení
>   „viditelné pro každého, kdo je přihlášený na claude.ai".
> - Program heslo nikdy nevypisuje a neposílá ho v adrese, jen v těle
>   požadavku na přihlášení Googlu.

### Lokálně

```bash
export SKLAD_EMAIL=tvuj@email.cz
export SKLAD_HESLO=tvojeheslo
node nastroje/sklad.js souhrn
```

Trvale je lepší dát to do souboru, který čte tvůj shell (`~/.zshrc`,
`~/.bashrc`), ne psát heslo do historie příkazů.

## Použití

```bash
node nastroje/sklad.js kdojsem           # pod kým jsem přihlášený a co čtu
node nastroje/sklad.js souhrn            # přehled v řeči, ne JSON
node nastroje/sklad.js sklad             # položky na skladě
node nastroje/sklad.js ceka              # čeká na payout
node nastroje/sklad.js prodano           # prodané
node nastroje/sklad.js prodano 2025      # prodané v jednom roce
node nastroje/sklad.js zakaznici         # CRM — zákazníci a partneři
node nastroje/sklad.js nastaveni         # uložená nastavení aplikace
node nastroje/sklad.js cache             # databáze našeptávače
node nastroje/sklad.js vse               # všechno najednou
```

Přepínače:

| přepínač | co dělá |
|---|---|
| `--profil=podnikani` | jen podnikatelské položky |
| `--profil=osobni` | jen osobní |
| `--pole=name,sku,buyPrice` | jen vyjmenované sloupce |
| `--limit=50` | jen prvních N položek |

Příklad:

```bash
node nastroje/sklad.js sklad --profil=podnikani --pole=name,sku,buyPrice,buyDate
```

## Co program vrací

Kromě `souhrn` je výstup JSON, aby se dal předat dál.

Řádky jsou takové, jak jsou uložené v cloudu. **Metriky se tu schválně
nepočítají** — u kurzů EUR si aplikace pamatuje kurz ke dni nákupu
a ke dni payoutu a zpětný přepočet dnešním kurzem by dával jiná čísla.
Kdyby se ta logika psala podruhé tady, dřív nebo později by se obě
verze rozešly. Kdo se ptá, ať si to spočítá z řádků.

Fotky se do výstupu netahají. Položka, která fotku má, nese `maFotku: 1`.
Odkazované obrázky (StockX) zůstávají, jsou to jen adresy.

## Jak to uvnitř funguje

Žádné knihovny, žádný `npm install`. Firebase má webové rozhraní
a Node umí `fetch` sám od sebe — stejný přístup jako aplikace, která
taky nic neinstaluje.

Čtení je dvoukolové. Nejdřív se zjistí, jaké dokumenty v kolekci jsou,
ale stáhne se z nich jen `savedAt`; teprve pak se jedním voláním
vyzvednou ty, které nás zajímají. Dvě věci se tím získají: fotky se
nikdy nepřenášejí (bývají největší a k ničemu tu nejsou) a dokumenty
dorazí ze stejného okamžiku, takže se hlavní dokument a archivy
nemůžou rozejít.

## Testy

```bash
node test/run.js ctecka
```

`test-ctecka.js` zkouší rozbalování dat a skládání položek,
`test-ctecka2.js` stahovací část proti podstrčenému serveru — obojí
bez sítě a bez přihlašovacích údajů.

## Kdyby to nešlo

| hláška | co s tím |
|---|---|
| `Chybí přihlašovací údaje` | nejsou nastavené `SKLAD_EMAIL` a `SKLAD_HESLO` |
| `Nesprávný e-mail nebo heslo` | překlep, nebo se heslo mezitím změnilo |
| `Příliš mnoho pokusů` | Google dočasně přibrzdil přihlašování, zkus to za chvíli |
| `V cloudu nejsou žádná data` | účet je prázdný — sedí e-mail? |
| `Čtení z cloudu selhalo (403)` | přihlášení prošlo, ale pravidla čtení nepustila |

Když sezení nemá přístup na `identitytoolkit.googleapis.com`
a `firestore.googleapis.com`, přidej je do povolených domén v nastavení
prostředí.

## Kdyby to mělo někdy umět i zapisovat

Jde to a připojení by zůstalo stejné — přihlášený účet právo zápisu má.
Ale ukládání je v aplikaci nejchoulostivější místo:

- zapisuje se jednou dávkou, buď projde všechno, nebo nic,
- rozhodčí při konfliktu je jediné `savedAt` v hlavním dokumentu,
- kdo nevidí cloud celý, nesmí do něj zapsat.

Program, který by zapisoval zvenčí, musí ctít totéž, jinak přepíše
novější data staršími. Podrobnosti jsou v `CLAUDE.md` v oddíle
o cloudu. Je to samostatná práce, ne přepnutí vypínače.
