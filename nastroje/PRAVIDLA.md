# Účet jen pro čtení

Návod, jak zřídit druhý účet, který smí sklad **číst a nesmí do něj
zapisovat**. Čtečka (`sklad.js`) pak běží pod ním a heslo k tvému
skutečnému účtu nikde nefiguruje.

Rozdíl proti běžnému účtu je v tom, kdo to hlídá. Dneska „jen čtení"
znamená, že v `sklad.js` není napsané ukládání. S tímhle účtem to hlídá
server Googlu — zápis odmítne, i kdyby ho někdo poslal.

---

## 1. Založ účet pro čtení

V [konzoli Firebase](https://console.firebase.google.com/) vyber projekt
`sklad-7eec9` a jdi do **Authentication → Users → Add user**.

Zadej e-mail (klidně vymyšlený, třeba `ctecka@sklad.local`) a dlouhé
náhodné heslo. Heslo si zkopíruj, uvidíš ho jen teď.

Ve výpisu uživatelů pak u obou účtů uvidíš sloupec **User UID** — dlouhý
řetězec znaků. Budeš potřebovat oba: svůj a ten nový.

> Účet nezakládej registrací v aplikaci. Přihlásilo by tě to z tvého
> účtu a aplikace by novému začala rovnou ukládat prázdná data.

## 2. Ověř si, které UID je které

Než sáhneš na pravidla, přesvědč se, že čísla sedí:

```bash
SKLAD_EMAIL=tvuj@email.cz SKLAD_HESLO=… node nastroje/sklad.js kdojsem
```

Vypíše UID, pod kterým jsi přihlášený. To je **UID majitele**. To druhé
z konzole je **UID čtečky**.

## 3. Vlož pravidla

V konzoli jdi do **Firestore Database → Rules**. Nahraď obsah tímhle
a doplň obě UID:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // Majitel — pozná se podle toho, že sahá do své vlastní složky
    function jeMajitel(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    // Čtečka — jeden konkrétní účet a jedna konkrétní cizí složka
    function jeCtecka(uid) {
      return request.auth != null
             && request.auth.uid == 'SEM_UID_CTECKY'
             && uid == 'SEM_UID_MAJITELE';
    }

    match /users/{uid}/{dokument=**} {
      allow read:  if jeMajitel(uid) || jeCtecka(uid);
      allow write: if jeMajitel(uid);
    }
  }
}
```

Dej **Publish**.

Co ta pravidla říkají: číst smí majitel svoje, a k tomu jeden jmenovitě
uvedený účet jednu jmenovitě uvedenou složku. Zapisovat smí jedině
majitel. Na co pravidlo nesedí, to Firestore odmítne samo — proto tu
musí být `sklad` i `crm` pokryté, aplikace používá obojí.

### Kdyby měla čtečka vidět jen sklad a ne zákazníky

Místo posledního bloku dej tyhle dva:

```
    match /users/{uid}/sklad/{dokument} {
      allow read:  if jeMajitel(uid) || jeCtecka(uid);
      allow write: if jeMajitel(uid);
    }

    match /users/{uid}/crm/{dokument} {
      allow read, write: if jeMajitel(uid);
    }
```

## 4. Přepni čtečku na nový účet

V nastavení prostředí (nebo doma v terminálu) nahraď proměnné:

```
SKLAD_EMAIL=ctecka@sklad.local
SKLAD_HESLO=to dlouhé náhodné heslo
SKLAD_UID=UID majitele
```

`SKLAD_UID` je nutné. Čtečka má vlastní složku, která je prázdná —
bez toho řádku by koukala do ní místo do tvojí.

## 5. Ověř, že to platí

```bash
node nastroje/sklad.js kdojsem     # jiné UID přihlášení než čtená složka
node nastroje/sklad.js souhrn      # čísla sedí s aplikací
```

A hlavně ověř, že **zápis neprojde**. Zkusí se poslat neškodná změna do
dokumentu, který stejně nikdo nečte:

```bash
TOKEN=$(curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDS1e4Y3LfglhKsLryxJZYqrfMSCZ9evnU" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SKLAD_EMAIL\",\"password\":\"$SKLAD_HESLO\",\"returnSecureToken\":true}" \
  | grep -o '"idToken": *"[^"]*"' | cut -d'"' -f4)

curl -s -X PATCH \
  "https://firestore.googleapis.com/v1/projects/sklad-7eec9/databases/(default)/documents/users/$SKLAD_UID/sklad/zkouska_zapisu" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fields":{"pokus":{"stringValue":"tohle nemá projít"}}}'
```

Musí přijít `PERMISSION_DENIED`. Kdyby to prošlo, pravidla nesedí —
zkontroluj, že jsi dal Publish a že UID nejsou prohozená.

Tenhle příkaz je schválně mimo `sklad.js`. Do čtečky zápis nepatří ani
na zkoušku.

## Když bude potřeba klíč zneplatnit

V konzoli v **Authentication → Users** u účtu čtečky buď změň heslo,
nebo účet rovnou smaž. Tvého přihlášení se to nedotkne a data zůstanou.

Po změně hesla nezapomeň přepsat `SKLAD_HESLO` v nastavení prostředí.

## Na co si dát pozor

- Pravidla nahrazují celý soubor. Jestli sis do nich někdy něco přidal,
  nejdřív si to zkopíruj stranou — po **Publish** se stará verze
  přepíše.
- Špatně napsané pravidlo umí data otevřít komukoli. Po každé změně
  udělej krok 5.
- UID nejsou tajná, klidně o nich mluv. Tajné je heslo čtečky.
- Aplikace v prohlížeči jede pořád pod tvým účtem a tyhle změny se jí
  nedotknou. Čtečka je vedle, ne místo.
