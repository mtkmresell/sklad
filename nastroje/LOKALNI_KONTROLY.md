# Lokální kontroly — napojení na SKLAD

Kontroly listingů (zatím Bazoš) běží na domácím PC ve složce
`G:\Můj disk\Claude\MTKM-kontroly`. Tenhle návod pokrývá kroky
**1 (Firestore čtení)** a **2 (Firestore zápis)** ze zadání
„Lokální kontroly SKLAD." z 11. 11. 2026.

Obojí dělá jeden soubor: **`sklad_firestore.py`** (je tady v `nastroje/`).
Patří do složky MTKM-kontroly — jeden pro všechny kontroly. Jen standardní
knihovna Pythonu, nic se neinstaluje.

## Jak to funguje (zjednodušeně)

- **Čtení:** skript se přihlásí do Firestore stejně jako aplikace
  a stáhne si sklad sám. Odpadá „obnov sklad" a `sklad.json` už nikdy
  nezastará.
- **Zápis:** skript do skladu **nesahá**. Položí do Firestore lísteček
  (`pozadavek_…`) — stejný, jaký dnes pokládá konektor, když Claude
  zavolá `sklad_listing` nebo `sklad_kontrola`. Aplikace ho při
  nejbližším otevření přečte, provede (fajfky, okno Kontroly listingů)
  a smaže. Je to jako vzkaz na lednici: aplikace je jediná, kdo smí
  měnit sklad, ostatní jí nechávají vzkazy.

## Přihlášení — účet čtečky, heslo ve Windows

Do aplikace SKLAD se přihlašuješ **e-mailem a heslem** (Firebase).
Skript ale nepoužívá tvůj účet, nýbrž **účet čtečky** — ten samý, kterým
se hlásí konektor (v Cloudflare je jako `SKLAD_EMAIL` a `SKLAD_HESLO`).
Pravidla Firestore mu dovolí sklad číst a zapsat jedině lísteček. Ani
pokažený skript tedy sklad nepřepíše a nic nesmaže.

Heslo **neleží v žádném souboru na Disku** (složka MTKM-kontroly se
synchronizuje do cloudu i do mobilu). Uloží se do **Správce pověření
Windows** — trezor na hesla, zamčený tvým přihlášením do Windows:

```
python sklad_firestore.py nastavit
```

Zeptá se na e-mail a heslo čtečky, ověří, že sedí, a uloží je.
**Heslo stačí zkopírovat (Ctrl+C) a u otázky na heslo dát jen Enter** —
vezme se ze schránky a schránka se pak vymaže. Psát ho do příkazového
řádku jde taky, ale naslepo (nic se neukazuje) a vložení přes Ctrl+V
tam často nefunguje; majitel ho tam takhle nedostal vůbec.

E-mail i heslo čtečky jsou v nastavení prostředí Claude Code
(claude.ai → Code → Environments → Default → proměnné `SKLAD_EMAIL`
a `SKLAD_HESLO`). Klidně se zkopíruje celý řádek `SKLAD_HESLO=…`,
jméno před rovnítkem se utne. Stačí jednou. Najdeš je pak v *Ovládací
panely → Správce pověření → Pověření systému Windows* pod jménem
`SKLAD-kontroly`.

Když heslo čtečky neznáš: Firebase konzole → Authentication → Users →
u účtu čtečky *Reset password*. **Nové heslo pak musí dostat i konektor
v Cloudflare (`SKLAD_HESLO`) a prostředí Claude Code**, jinak přestanou
fungovat.

## Ověření

```
python sklad_firestore.py test
```

Vypíše, kolik kusů je skladem ke kontrole, kolik je prodaných, u kolika
je zaškrtnutý Bazoš.cz / .sk a jaká místa prodeje jsou v nastavení.
Nic nezapisuje.

## Příkazy

| příkaz | co dělá |
|---|---|
| `nastavit` | uloží přihlášení čtečky do Správce pověření |
| `test` | přihlásí se a řekne, co ve skladu vidí |
| `sklad [sklad.json]` | uloží sklad ve **stejném formátu jako dosud** — `[id, název, velikost, cz, sk]` — a vedle `prodane.json` s prodanými kusy (pro „Smazat vs. Není ve SKLAD.") |
| `fajfky soubor.json [--odeslat]` | pošle fajfky `{"zmeny": [{"id", "platforma", "zaskrtnout"}]}` |
| `kontrola soubor.json [--odeslat]` | pošle výsledek kontroly `{"misto", "chybi", "smazat", "nejde", "report", "web", "poznamka"}` |

**Bez `--odeslat` se nic nezapíše**, jen se ukáže, co by se poslalo
a co by se odmítlo — stejná pojistka jako `provest: true` u konektoru.

Ze skladu se do kontroly berou kusy **na skladě**, bez balíků a bez
míst *Zrušeno*, *Vráceno*, *Poškozené* (`VYRADIT_MISTA`). *Na cestě*
a *Bude vráceno* skladem jsou — podle pravidel kontroly.

## Uspořádání složky

```
MTKM-kontroly/
  sklad_firestore.py      společné pro všechny kontroly (jen jednou!)
  LOKALNI_KONTROLY.md     tenhle návod
  bazos/                  bazos_kontrola.py, SPUSTIT_bazos.bat, výsledky, debug
  refresher/              refresher_kontrola.py, SPUSTIT_refresher.bat, výsledky
  section/                section_kontrola.py, SPUSTIT_section.bat, výsledky
  _MUZES SMAZAT/          staré verze
```

Každá kontrola má vlastní složku a výsledky (`vysledek_….json`,
`chyba_….txt`, `debug/`) zapisuje do ní. `sklad_firestore.py` hledá
ve své složce a o patro výš — **nekopíruj ho do složek kontrol**, oprava
by se pak musela dělat dvacetkrát. V repozitáři je to stejně:
`nastroje/<místo>/`.

## Bazoš kontrola (`bazos/`)

Spouští se `bazos/SPUSTIT_bazos.bat` (nebo `python bazos_kontrola.py`):

1. Načte sklad z cloudu a projde Bazoš.cz a Bazoš.sk jako dřív.
2. Vypíše nálezy: SMAZAT, OPRAVIT, NENÍ VE SKLAD, FAJFKA +/− a OVĚŘIT
   RUČNĚ (párování nejisté — tyhle se nikam neposílají).
3. **Bez ptaní** pošle fajfky a kontrolu obou míst (i report do
   aplikace). `--nahled` jen ukáže a nepošle nic.

Výsledek je pak v aplikaci v okně Kontroly listingů a odkaz **Report**
u místa otevře podrobný report (jako dřív artifact): Smazat, Opravit
s větou, co udělat, Zaškrtnutí ve SKLADu, Není ve SKLADu, Ověřit ručně,
náhledy a limit. Claude v chatu už potřeba není.

### Refresher a Section

Stejně jako Bazoš: `refresher/SPUSTIT_refresher.bat` a
`section/SPUSTIT_section.bat`. Obě jen čtou — Refresher
veřejný profil, Section tabulku sdílenou odkazem (CSV export) a veřejný
e-shop. Nic se nikam nepřihlašuje. Section zatím nečte záložky INSTORE
a Poslední kusy.

### TheBeast, Sellect a Tuzex (s přihlášením)

`thebeast/SPUSTIT_thebeast.bat`, `sellect/SPUSTIT_sellect.bat`,
`tuzex/SPUSTIT_tuzex.bat`. **Poprvé se každá zeptá na e-mail a heslo
k tomu webu** — heslo zkopíruj (Ctrl+C) a dej jen Enter. Po povedeném
přihlášení se uloží do Správce pověření Windows (`SKLAD-web-TheBeast` …)
a příště se neptá. Změněné heslo: spusť s `--nove-heslo` (stačí do
spouštěče dopsat), nebo ho program při odmítnutí zapomene sám.

- **TheBeast** jen čte (nabídky, katalog). Payout 77 % − 50 Kč.
- **Sellect** čte Aktuální nabídky a katalog; **vždy prodlouží nabídky,
  které jsou skladem** (jako skill). Payout 80 % − 50 Kč.
- **Tuzex** jen čte (Inventory, ceny z tuzexstore.com). Ceny v €,
  payout 74 % − 2 €, Nejsi nejlevnější s doporučenou cenou končící 9.

- **SneakersNow** (`sneakersnow/`) jen čte nabídky a katalog. Provize 20 %,
  doporučená cena končí 90 pod tržním minimem.
- **Stuffsell** (`stuffsell/`) jen čte (Inventory, ceny ze stuffsell.cz).
  Payout 77,5 % − 30 Kč, doporučená cena končí 90. Kus u jiného komisního
  prodejce se nehlásí.
- **Adonio** (`adonio/`) jen čte stránku Moje nabídky. Payout cena −
  max(25 %, 700 Kč), doporučená = nejnižší − 1 Kč.

### Kontroly přes prohlížeč (Tnsky, Sneakerstore, Hypeboost, KLEKT, Released, Facebook)

Tyhle weby se čtou přes **skutečný Chrome** s vlastním profilem kontrol
(`%LOCALAPPDATA%\MTKM-kontroly\prohlizec`, ne na Disku). **Přihlašují se
samy** — e-mail a heslo se zeptají poprvé (heslo přes schránku + Enter),
uloží se do Správce pověření až po povedeném přihlášení. Rukou jen:

1. **Facebook** — spusť jednou `PRIHLASIT_WEBY.bat` (v hlavní složce),
   nainstaluje Playwright a otevře Facebook; přihlas se, pak Enter.
2. **Hypeboost**, když ukáže ověření „nejsem robot" — odklikni ho v okně
   a zmáčkni Enter.

Dvě kontroly přes prohlížeč naráz nepojedou (sdílí jeden profil) — druhá
řekne, ať počkáš.

- **Hypeboost** vždy prodlouží almost expired (+14 dní).
- **KLEKT** vždy prodlouží expiraci na 60 dní (kromě IE5836).
  KLEKT se přihlašuje **kódem z e-mailu** — heslo se proto nechce; když
  přihlášení vyprší, přihlas se v okně Chromu a zmáčkni Enter.
- **Tnsky** v okně Chromu samo kliká (filtr Active, 100 řádků, další
  stránka) — to je v pořádku, jejich tabulka jinak číst nejde.
- Dlouhé kroky (čtení, prodlužování) ukazují v okně točící se značku
  a vteřiny; kontrola se nesekla, jen pracuje.
- **Released** si pamatuje katalog v `released/katalog_released.json`.
- **WTB**: zkopíruj text pingeru (Ctrl+C) a spusť `SPUSTIT_wtb.bat`.
  Do aplikace pošle report, až bude „WTB Market" v Nastavení → místa
  prodeje; do té doby jen vypíše výsledek.

Když kontrola spadne uprostřed, může po ní zůstat otevřené okno Chromu
kontrol — **zavři ho**, jinak se další kontrola přes prohlížeč nespustí
(řekne „Prohlížeč kontrol už je otevřený").

Kontrola, která nenačte žádnou nabídku, **nic nepošle** — skončí chybou
a stránku uloží do `debug/`.

Když web vrátí něco nečekaného, leží to v `<místo>/debug/` — pošli to
Claudovi (umí si to přečíst z Disku).

### Report pro další kontroly

`S.posli_report(token, data, polozky, report, odeslat=True)` — sekce si
kontrola skládá sama, aplikace vykreslí jakékoli:

```python
S.posli_report(token, data, polozky, {
    'misto': 'Refresher', 'skupina': 'Refresher', 'nadpis': 'Refresher — listingy',
    'datum': datum,                      # stejný okamžik jako v posli_kontrolu(datum=…)
    'limit': {'pocet': 47, 'max': 50},   # nepovinné
    'souhrn': ['Payouty sedí: 12'],
    'sekce': [{'nazev': 'Smazat', 'barva': 'smazat', 'poznamka': '…', 'hromadne': False,
               'radky': [{'nazev': …, 'velikost': …, 'sku': …, 'duvod': …, 'odkaz': 'https://…',
                          'obrazek': 'https://…', 'ids': [id kusu], 'udaje': [{'popis': 'Payout', 'hodnota': '2 500 Kč'}]}]}],
}, odeslat=True)
```

Barvy: `smazat`, `opravit`, `pridat`, `fajfky`, `neni`, `overit`, `info`.
`hromadne: True` přidá k sekci „Kopírovat vše" (název ⇥ velikost ⇥ SKU).

## Pro Clauda: jak to napojit do další kontroly

Nejjednodušší je použít modul přímo, místo čtení `sklad.json`:

```python
import sklad_firestore as S

token = S.prihlas()                       # údaje ze Správce pověření
data, polozky = S.nacti_sklad(token)
sklad = [S.radek_bazos(it) for it in S.skladem(polozky)]   # [id, název, velikost, cz, sk]
prodane = [S.radek_bazos(it) for it in S.prodane(polozky)]

# … kontrola Bazoše jako dosud …

# Nejdřív fajfky, pak výsledek kontroly — aplikace je v tomhle pořadí
# i zpracovává (kus s právě odškrtávanou fajfkou by jinak vypadal jako vyřízený).
S.posli_fajfky(token, data, polozky, zmeny, odeslat=True)
S.posli_kontrolu(token, data, polozky, 'Bazoš.cz',
                 chybi=[...id kusů skladem bez inzerátu...],
                 smazat=[...id prodaných kusů, jejichž inzerát běží...],
                 nejde=[{'id': ..., 'duvod': ...}],
                 report='https://claude.ai/artifact/S1SE7zwfLZ4KSAR5QQm6C8',
                 web='https://www.bazos.cz/hodnoceni.php?…',
                 poznamka='Opravit: 2 · Není ve SKLAD.: 1 · inzerátů 47/50',
                 odeslat=True)
```

Obě funkce vrací slovník se `stav` (`zadano`, `nahled`, `nic_k_provedeni`,
`nezname_misto`…) a seznamem `nelze` s důvody, proč se něco neposlalo
(neexistující id, kus už není skladem, fajfka už je zaškrtnutá…).
Kontroluje se stejně jako v konektoru, takže co projde tady, projde
i v aplikaci. Bazoš.cz a Bazoš.sk jsou dvě místa — dvě kontroly.

Token platí hodinu; běh Bazoše trvá minuty, takže stačí jeden.

**Opravit, Není ve SKLAD. a limit** umí okno Kontroly listingů od
11. 11. 2026 (krok 3) — posílají se v téže kontrole:

```python
S.posli_kontrolu(token, data, polozky, 'Bazoš.cz', chybi=[...], smazat=[...],
                 opravit=[{'nazev': 'Nike Mind 001', 'odkaz': 'https://…/inzerat/123/',
                           'inzerat': '45, 46', 'sklad': '46', 'ids': ['id kusu skladem']}],
                 neni_ve_skladu=[{'nazev': 'Supreme Box Logo', 'odkaz': 'https://…', 'velikost': 'L'}],
                 inzeratu=47, limit=50, web='https://www.bazos.cz/hodnoceni.php?…', odeslat=True)
```

V okně jsou to sekce **Opravit** (s velikostmi v inzerátu a skladem,
odkazem na inzerát a tlačítkem Opraveno) a **Na Bazoš.cz, ale není ve
skladu** (Vyřízeno), u místa štítek „47/50 inzerátů" — na limitu
oranžový. `ids` u Opravit jsou nepovinné; když jsou, jde z řádku
otevřít detail kusu.

## Spouštěč — kontroly ovládané z aplikace SKLAD

Na PC jednou dvojklik na **`KONTROLY.pyw`** (hlavní složka
`MTKM-kontroly`, vedle `sklad_firestore.py`). Spouštěč poběží na pozadí
bez okna, sám se nastaví na spuštění po zapnutí PC a otevře aplikaci
SKLAD na okně **Kontroly listingů**. Tam je nahoře panel **Kontroly na
PC** — funguje i z mobilu, jen PC musí být zapnuté:

- **Spustit vše** a u každé kontroly **Spustit** / **Zastavit**, stav,
  co právě dělá a kdy naposledy běžela.
- **Přihlásit na PC** — když se kontrola nedokáže přihlásit sama
  (chybí heslo, vypršelo přihlášení na KLEKT nebo Facebooku). Na PC se
  otevře okno kontroly, tam se přihlásíš a příště už jede sama.
- **Výpis** u chyby — konec toho, co kontrola vypsala.
- **Spouštět kontroly po zapnutí PC** — zapnuté samo; po přihlášení do
  Windows se pustí všechno, při úspěchu se neozve nic, když něco
  potřebuje tebe, přijde jedno oznámení vpravo dole. Do dvou hodin od
  posledního běhu (restart PC) se znovu nespouští.

**Potřebuje nová pravidla Firestore** (blok `spoustec` ve
`firestore.rules`, publikovat v konzoli Firebase). Bez nich se kontroly
po zapnutí PC pustí dál, jen je aplikace neuvidí a nespustí.

WTB se pouští jen v okně (bere text pingeru ze schránky). Deník
spouštěče je v `%LOCALAPPDATA%\MTKM-kontroly\spoustec_log.txt`.
Nová kontrola = nová složka `<místo>/<místo>_kontrola.py`, spouštěč
ji najde sám.

## Další kroky (zadání, body 3–8)

- **3 Zobrazení v aplikaci** — hotovo (Opravit, Není ve SKLAD., limit).
  Zbývá, aby je skript posílal.
- **6 Tlačítko ve SKLADu + hlídač** — hotovo (panel Kontroly na PC,
  blok `spoustec` v pravidlech).
- Jeden spouštěč ovládaný z aplikace — hotovo (`KONTROLY.pyw`, viz výš).

Hlídá to `test/test-skladpy.js`: Python proti falešnému serveru
(čtení, náhled, zápis jen pod `pozadavek_…`, odmítnutí nesmyslů)
a pak **skutečná aplikace v prohlížeči**, která zapsané lístečky
převezme — fajfka se zaškrtne a kontrola se objeví v okně.
