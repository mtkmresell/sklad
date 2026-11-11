# Lokální kontroly — napojení na SKLAD

Kontroly listingů (zatím Bazoš) běží na domácím PC ve složce
`G:\Můj disk\Claude\MTKM-kontroly`. Tenhle návod pokrývá kroky
**1 (Firestore čtení)** a **2 (Firestore zápis)** ze zadání
„Lokální kontroly SKLAD." z 11. 11. 2026.

Obojí dělá jeden soubor: **`sklad_firestore.py`** (je tady v `nastroje/`).
Patří do složky MTKM-kontroly vedle `bazos_kontrola.py`. Jen standardní
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

Zeptá se na e-mail a heslo čtečky (heslo se při psaní neukazuje),
ověří, že sedí, a uloží je. Stačí jednou. Najdeš je pak v *Ovládací
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

## Pro Clauda: jak to napojit do `bazos_kontrola.py`

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

**Co okno Kontroly listingů zatím neumí:** sekci *Opravit* (velikosti
v inzerátu nesedí se skladem), *Není ve SKLAD.* (inzerát, ke kterému
ve skladu nic není) a počet inzerátů proti limitu 50. Do té doby ať
jdou počty do `poznamka`. Doplnění okna je **krok 3** zadání.

## Další kroky (zadání, body 3–8)

- **3 Zobrazení v aplikaci** — rozšířit okno Kontroly listingů o Opravit,
  Není ve SKLAD. a limit, ať artifact není potřeba. Dělá Claude Code
  v `index.html`; lísteček se rozšíří o nová pole.
- **6 Tlačítko ve SKLADu + hlídač** — potřebuje nové pravidlo ve
  Firestore: aplikace zapíše „spusť kontrolu", program na PC to uvidí
  a smí to po sobě uklidit. Dnes čtečka smí zapsat jen `pozadavek_…`
  a ten zpracovává aplikace, takže na tohle se hodit nebude.
- Zbytek (okno s kolečkem, `.exe`, jeden spouštěč, další weby, GitHub
  Actions) se tohohle souboru netýká — `sklad_firestore.py` se jen
  přibalí.

Hlídá to `test/test-skladpy.js`: Python proti falešnému serveru
(čtení, náhled, zápis jen pod `pozadavek_…`, odmítnutí nesmyslů)
a pak **skutečná aplikace v prohlížeči**, která zapsané lístečky
převezme — fajfka se zaškrtne a kontrola se objeví v okně.
