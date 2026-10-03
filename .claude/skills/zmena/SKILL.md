---
name: zmena
description: Postup jakékoli změny v SKLADu — v aplikaci (index.html), konektoru, pravidlech Firestore i testech. Použij pokaždé, když se má v repozitáři něco upravit, opravit nebo přidat, ještě před první úpravou souboru.
---

# Postup změny v SKLADu

Pravidla a důvody k nim jsou v `CLAUDE.md`. Tady je jen **pořadí kroků**,
ať se nic nevynechá. Když se tenhle postup s `CLAUDE.md` rozchází, platí
`CLAUDE.md` a tenhle soubor se opraví.

## 1. Nejdřív stav, ne paměť

Kontejner se umí vyměnit během práce — jiná větev, o pár commitů pozadu.

```bash
git log --oneline -3 && git status -sb
git fetch origin main && git log --oneline HEAD..origin/main
git merge --ff-only origin/main        # když je HEAD předek
```

Co je v souboru, si ověř grepem v souboru, ne podle toho, co si pamatuješ.

## 2. Najdi místo a pravidla, která k němu patří

- V `index.html` hledej podle kotvy z tabulky *Kde co hledat* v `CLAUDE.md`.
- Přečti si v `CLAUDE.md` odstavec, který se toho místa týká — skoro každá
  sekce má „věci, které se nesmí rozbít". Ty jsou důvodem, proč kód
  vypadá, jak vypadá.
- Zjisti, který `test-*.js` to místo hlídá (`grep -l kotva test/`).

**Jediná místa, kam se nové věci přidávají:**

| co | kam |
|---|---|
| nové nastavení | `syncSettings()` (místní, nesynchronizované: `syncLocalOnlyKeys()`) |
| nové datum u změny stavu | `oznacCasyStavu()` |
| nová akce dostupná účetnímu | `UCETNI_AKCE` / `UCETNI_KLAVESY` |
| zápis fajfky platformy | přes `togglePlatItem`, ne vedle něj |
| místa prodeje | čte se `jeMistoProdeje()` / `getPlatGroups()`, **nikdy seznam v kódu** |
| zápis do `localStorage` | `_ulozLokal()` |

## 3. Udělej změnu

- Vše viditelné **česky**, komentáře taky.
- Piš ve stylu okolního kódu (starší části `var`/`function`), nesjednocuj.
- Nové věci do IIFE, kde to jde.
- Každý nový `<select>` přes `initCustomSelect()`.
- Žádný build, balíčkovač, externí fonty ani nová externí knihovna.
- Před velkým zásahem do `index.html` ulož zálohu:
  `cp index.html zaloha/index-pred-<co>-$(date +%F).html`
- Kurz EUR se nikdy nepřepočítává zpětně dnešním.

## 4. Test

- Nová funkce nebo oprava chyby = **nový nebo rozšířený test**, který by
  bez té změny spadl. U opravy nejdřív chybu testem zreprodukuj.
- Testuj hlavně to, co se stát **nesmí**, ne jen šťastnou cestu.
- V testech nepiš pevná data, když se měří stáří — počítej je ode dneška.
- `saveItem()` je asynchronní: na změnu čekej, ne `sleep`.

Spouštění:

```bash
node test/run.js <část názvu>                                  # dotčené testy
NODE_PATH=/opt/node22/lib/node_modules node test/test-x.js     # jeden soubor přímo
```

Při změně kolem ukládání vždy aspoň `archive listener syncsettings photos`
(a `zarizeni`).

**Před commitem celá sada** `node test/run.js` — trvá kolem šesti minut,
takže ji pusť na pozadí a výsledek si přečti po doběhnutí. Červený test
se neobchází, nevypíná ani neupravuje tak, aby prošel naprázdno.

## 5. Zapiš to do CLAUDE.md

Když změna zavádí pravidlo, které se dá snadno rozbít, nebo přišla
z chyby nalezené v provozu, dopiš do příslušné sekce `CLAUDE.md`
**proč** to tak je a co se stalo, když to tak nebylo. Novou kotvu
přidej do tabulky *Kde co hledat*, nový testovací soubor do počtu
v sekci *Testy*.

Hotové téma z *Rozdělaná témata* smaž; nové domluvené, ale neudělané
tam přidej.

## 6. Ruční kroky majitele

Tyhle tři věci se **nenasazují samy** a push je nespustí:

- `firestore.rules` → konzole Firebase → Firestore → Rules → Publish
- `konektor/worker.js` → Cloudflare → Workers → Edit code → Deploy
- tajemství a cron triggery v Cloudflare

Když se změna kterékoli z nich týká, **řekni to majiteli výslovně**
a uprav tabulku *Čeká na ruční krok majitele* v `CLAUDE.md`. Netvrď,
že něco běží, dokud to nepotvrdí.

## 7. Commit a push — jen na vyžádání

- Commituj a pushuj **až když o to majitel řekne**. Pushuje se do `main`.
- Zpráva commitu česky, krátký nadpis o tom, co se změnilo pro člověka
  („Zakázaná kategorie zašedne, místo aby čtvereček zmizel"), v těle proč.
- Nasazení na GitHub Pages ověř přes GitHub API (workflow „pages build
  and deployment", id `256573624`), ne curlem — `mtkmresell.github.io`
  odsud není dostupná.

## 8. Shrnutí pro majitele

Na konci krátce česky:

- co se změnilo z pohledu toho, kdo aplikaci používá,
- jaké testy běžely a jak dopadly (celá sada, nebo jen část — přiznej to),
- co musí udělat ručně (krok 6),
- připomeň otevřená *Rozdělaná témata* (hlavně prázdný seznam příspěvků
  na Instagramu a jestli je nasazený konektor a e-mailová upozornění).
