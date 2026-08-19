# Přístup pro účetního

Účetní se přihlásí vlastním účtem a uvidí sklad majitele — jen sekce
**Na skladě** a **Prodáno**, jen podnikatelské položky, bez možnosti
cokoli změnit.

Navazuje na `PRAVIDLA.md`; pokud ještě nemáš zřízený účet jen pro čtení,
projdi nejdřív ten návod — postup je stejný a pravidla se doplňují.

## Co uvidí a co ne

| | |
|---|---|
| **vidí** | Na skladě, Prodáno, hledání napříč sekcemi, odhlášení, vysvětlivky |
| **nevidí** | Čeká, Zákazníci, Wishlist, analytiku, kalkulačku marží, chybějící listingy, osobní položky, přepínač profilů |
| **nemůže** | přidat, upravit ani smazat položku; prokliknout se na StockX ani na sledování zásilky |

Nahoře mu svítí oranžový pruh **Pohled účetního** s tlačítkem na
vysvětlivky, ať je pořád jasné, kde je.

## Zamčené versus schované

Tenhle rozdíl je potřeba znát, jinak si od toho slíbíš víc, než to umí.

**Zamčené hlídá server.** Zákazníci jsou vlastní dokument a pravidla
Firestore ho účetnímu nepustí — ta data se k němu nedostanou ani přes
vývojářské nástroje. Zápis je zamčený stejně: pravidla ho odmítnou, ať
aplikace udělá cokoli.

**Schované hlídá jen rozhraní.** Wishlist a osobní položky leží ve
stejném dokumentu jako sklad, takže do prohlížeče dorazí a jsou pryč jen
z obrazu. Poctivému účetnímu to stačí; kdo umí otevřít vývojářské
nástroje, na ně dosáhne.

Kdyby to jednou vadilo, musely by se wishlist i osobní položky
přestěhovat do vlastních dokumentů. To je zásah do ukládání dat
a přenos toho, co už je uložené — samostatná práce, ne přepínač.

## 1. Založ účet účetnímu

V [konzoli Firebase](https://console.firebase.google.com/) →
**Authentication → Users → Add user**. Zadej jeho e-mail a heslo, které
mu předáš.

**UID zkopíruj tlačítkem, nikdy ho neopisuj očima.** Ve sloupci
**User UID** je na to ikonka. V těch řetězcích se běžně potkává velké `O`
s nulou a velké `I` s malým `l`; když se jeden znak netrefí, pravidla
porovnávají skoro stejný text a Firestore čtení odmítne. Projeví se to
hláškou „Sync přerušen" a prázdným skladem, takže na první pohled
vypadá, že je chyba jinde. Totéž platí pro posílání UID v obrázku —
z obrázku se ty znaky nerozliší.

## 2. Vytvoř mu ukazatel na svoje data

Účetní má vlastní prázdnou kóji. Aby aplikace věděla, čí sklad mu má
ukázat, potřebuje v ní jeden dokument s jedním polem.

V konzoli jdi do **Firestore Database** a vytvoř:

```
kolekce:   users
dokument:  <UID účetního>
kolekce:   sklad
dokument:  data
pole:      uctujePro   (string)   =  <UID majitele>
```

**`sklad` je složka, ne pole.** Konzole v okně „Add a document" nabízí
rovnou políčko na pole — tam `sklad` nepatří. Zakládá se až uvnitř
dokumentu tlačítkem **Start collection**. Střídá se to složka → dokument
→ složka → dokument, proto to zamotaně působí:

1. V kolekci `users` dej **Add document**, Document ID = **UID účetního**.
   Nabídnuté pole smaž tlačítkem **⊖**, dokument má zůstat prázdný.
2. Uvnitř něj **Start collection**, jméno `sklad`.
3. První dokument v ní: Document ID `data`.
4. A teprve tam pole `uctujePro` (string) = **UID majitele**.

Tenhle dokument je jediné, co účetní ve své kóji má. Aplikace ho přečte,
pozná podle něj režim účetního a přepne se na data majitele.

> Bez tohohle dokumentu se účetnímu po přihlášení nabídne úvodní
> průvodce prázdným skladem — aplikace nemá podle čeho poznat, že jde
> o účetního.

## 3. Doplň pravidla

**Firestore Database → Rules.** Oproti `PRAVIDLA.md` přibyla funkce
`jeUcetni` a sklad s CRM se rozdělily, protože do CRM účetní nesmí:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // Majitel — sahá do své vlastní složky
    function jeMajitel(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    // Čtečka pro AI — čte všechno, nezapisuje
    function jeCtecka(uid) {
      return request.auth != null
             && request.auth.uid == 'SEM_UID_CTECKY'
             && uid == 'SEM_UID_MAJITELE';
    }

    // Účetní — čte jen sklad, na CRM nedosáhne
    function jeUcetni(uid) {
      return request.auth != null
             && request.auth.uid == 'SEM_UID_UCETNIHO'
             && uid == 'SEM_UID_MAJITELE';
    }

    // Sklad, prodeje, fotky, našeptávač
    match /users/{uid}/sklad/{dokument} {
      allow read:  if jeMajitel(uid) || jeCtecka(uid) || jeUcetni(uid);
      allow write: if jeMajitel(uid);
    }

    // Zákazníci — účetní tu schválně není
    match /users/{uid}/crm/{dokument} {
      allow read:  if jeMajitel(uid) || jeCtecka(uid);
      allow write: if jeMajitel(uid);
    }
  }
}
```

Dej **Publish**.

Účetní má na svou vlastní kóji plný přístup přes `jeMajitel` — je to
jeho složka a leží v ní jen ten ukazatel.

## 4. Ověř to

Přihlas se jeho údaji (klidně v anonymním okně, ať se neodhlásíš ze
svého) a projdi:

- [ ] Nahoře svítí oranžový pruh **Pohled účetního**
- [ ] Jsou vidět jen záložky **Na skladě** a **Prodáno**
- [ ] Chybí přepínač Podnikání/Osobní/Vše a tlačítko **+ Přidat**
- [ ] V seznamu nejsou osobní položky
- [ ] Kliknutí na název položky nevede na StockX
- [ ] V nastavení je jen odhlášení a vysvětlivky
- [ ] Tlačítko **Co tu najdu?** otevře manuál

A hlavně: v konzoli Firestore se po jeho prohlížení **nic nezměnilo**.

## Jak přístup odebrat

Stačí jedno z toho:

- smaž účet v **Authentication → Users**,
- nebo vyhoď funkci `jeUcetni` z pravidel a dej Publish.

Druhá cesta je rychlejší a účet zůstane, kdyby se hodil znovu.

## Testy

```bash
node test/run.js uctetni
```

`test-uctetni.js` projde celou cestu proti falešnému Firestore: přepnutí
na kóji majitele, skryté sekce, filtr osobních položek, odklonění ze
skrytých sekcí, nenačtené CRM, odmítnutý zápis — a nakonec ověří, že se
běžného přihlášení nic z toho nedotklo.
