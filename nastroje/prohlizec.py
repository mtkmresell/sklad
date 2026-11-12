# -*- coding: utf-8 -*-
"""
Prohlížeč pro kontroly, které se skriptem přihlásit nejdou (Facebook,
Hypeboost za Cloudflare, Klekt, Tnsky, Sneakerstore, Released).

Otevře skutečný Chrome (nebo Edge) s VLASTNÍM profilem kontrol — ne tvým
běžným. Do přihlašovacího formuláře webu se skript přihlásí sám heslem ze
Správce pověření Windows, stejně jako ostatní kontroly (prihlas_sam;
poprvé se zeptá). Profil si přihlášení navíc pamatuje, takže většinou
není potřeba ani to. Jen Facebook se přihlašuje rukou v okně — jeho
ověřování by samostatné přihlašování mohlo vyhodnotit jako útok a účet
zablokovat. Data se čtou ze stránky stejným JavaScriptem, jaký používaly
skilly ve vestavěném prohlížeči.

Profil leží v %LOCALAPPDATA%\\MTKM-kontroly\\prohlizec — schválně NE ve
složce na Google Disku: jsou v něm přihlášené relace a ty se do cloudu
synchronizovat nemají.

Potřebuje jednou (v příkazovém řádku):  py -m pip install playwright
Chrome nebo Edge už na PC je, nic dalšího se nestahuje.
"""
import os, sys, time

PROFIL = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "MTKM-kontroly", "prohlizec")


class ChybaProhlizece(Exception):
    pass


def jdi(stranka, url, cekat_ms=0):
    """goto, které nespadne, když web cestou přesměruje (třeba na přihlášení)."""
    try:
        stranka.goto(url, wait_until="domcontentloaded", timeout=90000)
    except Exception as e:
        if "interrupted by another navigation" not in str(e) and "net::ERR_ABORTED" not in str(e):
            raise
        try:
            stranka.wait_for_load_state("domcontentloaded", timeout=30000)
        except Exception:
            pass
    if cekat_ms:
        stranka.wait_for_timeout(cekat_ms)


class Prohlizec:
    """with Prohlizec() as b: s = b.otevri(url); b.prihlaseni(s, test_js, 'Tnsky'); s.evaluate(js)"""

    def __init__(self, viditelny=True):
        self.viditelny = viditelny
        self._pw = self._ctx = None

    def __enter__(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise ChybaProhlizece("Chybí Playwright. Spusť jednou v příkazovém řádku:  py -m pip install playwright")
        os.makedirs(PROFIL, exist_ok=True)
        self._pw = sync_playwright().start()
        posledni, chyby = None, []
        for kanal in ("chrome", "msedge", None):
            try:
                # en-US: čísla a data ve stránkách stejně jako ve vestavěném prohlížeči skillů
                # („1,234 Kč“), podle toho jsou psané čtecí skripty
                self._ctx = self._pw.chromium.launch_persistent_context(
                    PROFIL, channel=kanal, headless=not self.viditelny, viewport={"width": 1280, "height": 900},
                    locale="en-US", args=["--disable-blink-features=AutomationControlled"])
                break
            except Exception as e:
                posledni = e
                chyby.append(str(e).lower())
        if not self._ctx:
            self._pw.stop()
            if any(t in c for c in chyby for t in ("already in use", "processsingleton", "lock", "being used", "exitcode=21",
                                                     "target page, context or browser has been closed")):
                raise ChybaProhlizece("Prohlížeč kontrol už je otevřený — běží jiná kontrola (Tnsky, KLEKT…) "
                                      "nebo PRIHLASIT_WEBY. Počkej, až doběhne a okno se zavře, pak spusť znovu.")
            raise ChybaProhlizece("Nepodařilo se otevřít Chrome ani Edge: %s" % posledni)
        return self

    def __exit__(self, *a):
        try:
            if self._ctx:
                self._ctx.close()
        finally:
            if self._pw:
                self._pw.stop()

    def otevri(self, url, cekat_ms=1500):
        s = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        jdi(s, url, cekat_ms)
        return s

    def prihlaseni(self, stranka, test_js, misto, url=None, pokusu=3):
        """test_js vrací true, když je přihlášeno a data jsou vidět. Jinak požádá
        o přihlášení v okně (Cloudflare taky odklikneš tam) a zkusí znovu."""
        for _ in range(pokusu):
            try:
                if stranka.evaluate(test_js):
                    return True
            except Exception:
                pass
            print("\n>>> V okně prohlížeče se přihlas na %s (případně odklikni ověření)." % misto)
            print(">>> Až uvidíš svoje nabídky, vrať se sem a zmáčkni Enter.")
            try:
                input()
            except EOFError:
                pass
            if url:
                jdi(stranka, url, 2000)
        raise ChybaProhlizece("Na %s se nepodařilo přihlásit — stránka pořád nic neukazuje." % misto)


E_POLE = ('input[type=email], input[autocomplete=email], input[autocomplete=username], '
          'input[name*="email" i], input[id*="email" i], input[name*="login" i][type=text], input[name*="user" i][type=text]')
H_POLE = 'input[type=password]'


def _viditelne(stranka, vyber):
    for i in range(stranka.locator(vyber).count()):
        p = stranka.locator(vyber).nth(i)
        try:
            if p.is_visible():
                return p
        except Exception:
            pass
    return None


def _ok(stranka, test_js):
    try:
        return bool(stranka.evaluate(test_js))
    except Exception:
        return False


def vypln_prihlaseni(stranka, email, heslo, cekat_s=25):
    """Vyplní přihlašovací formulář stránky (i dvoukrokový: e-mail → Enter →
    heslo). Vrací False, když na stránce formulář není (třeba ověření Cloudflare)."""
    konec = time.time() + cekat_s
    e = h = None
    while time.time() < konec and not (e or h):
        e, h = _viditelne(stranka, E_POLE), _viditelne(stranka, H_POLE)
        if not (e or h):
            stranka.wait_for_timeout(1000)
    if not (e or h):
        return False
    if e:
        e.fill(email)
        if not h:   # heslo až na druhé obrazovce
            e.press("Enter")
            for _ in range(15):
                stranka.wait_for_timeout(1000)
                h = _viditelne(stranka, H_POLE)
                if h:
                    break
    if not h:
        return False
    h.fill(heslo)
    h.press("Enter")
    stranka.wait_for_timeout(1500)
    try:   # Enter formulář bez tlačítka neodešle → tlačítko, jinak odeslat formulář přímo
        if h.is_visible():
            tl = _viditelne(stranka, 'button[type=submit], input[type=submit], form button:not([type=button])')
            if tl:
                tl.click()
            else:
                h.evaluate("e => e.form && (e.form.requestSubmit ? e.form.requestSubmit() : e.form.submit())")
    except Exception:
        pass       # stránka mezitím odešla — přihlášení běží
    stranka.wait_for_timeout(3000)
    return True


def prihlas_sam(b, stranka, test_js, misto, url, login_url=None):
    """Přihlásí se sám heslem ze Správce pověření Windows (jako Sellect, Tuzex…).
    Poprvé se zeptá na e-mail a heslo, uloží je až po povedeném přihlášení.
    Když to nepůjde (ověření „nejsem robot“…), požádá o přihlášení v okně."""
    if _ok(stranka, test_js):
        return True
    import sklad_firestore as S
    for pokus in range(2):
        email, heslo, nove = S.prihlaseni_webu(misto)
        if login_url:
            jdi(stranka, login_url, 2000)
        vyplneno = vypln_prihlaseni(stranka, email, heslo)
        jdi(stranka, url, 2500)
        if _ok(stranka, test_js):
            if nove:
                S.uloz_prihlaseni_webu(misto, email, heslo)
            print("Přihlášeno na %s." % misto)
            return True
        if not vyplneno:
            break          # formulář se neukázal (Cloudflare…) → ručně v okně
        if not nove:       # uložené heslo nefunguje → zapomenout a zeptat se znovu
            print("Uložené heslo k %s nefunguje, zeptám se znovu." % misto)
            S.zapomen_prihlaseni_webu(misto)
        else:
            print("Přihlášení na %s neprošlo — zkus e-mail a heslo znovu." % misto)
    return b.prihlaseni(stranka, test_js, misto, url)


def js_cekej(stranka, vyraz, sekund=40):
    """Čeká, až výraz v okně stránky vrátí něco jiného než null (běh na pozadí)."""
    konec = time.time() + sekund
    while time.time() < konec:
        v = stranka.evaluate(vyraz)
        if v is not None:
            return v
        stranka.wait_for_timeout(2000)
    return None


# Ruční přihlášení jen tam, kde samostatné nejde (ostatní weby se přihlásí samy)
WEBY = {
    "Facebook": "https://www.facebook.com/marketplace/you/selling",
}


if __name__ == "__main__":
    # PRIHLASIT_WEBY.bat: nainstaluje Playwright a otevře Facebook, ať se na něj jednou přihlásíš
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    with Prohlizec() as b:
        prvni = True
        for jmeno, url in WEBY.items():
            s = b._ctx.pages[0] if prvni and b._ctx.pages else b._ctx.new_page()
            prvni = False
            try:
                s.goto(url, wait_until="domcontentloaded", timeout=90000)
            except Exception as e:
                print("  %s se nenačetl: %s" % (jmeno, e))
        print("Otevřel jsem Facebook. Přihlas se na něj (ostatní weby se přihlásí samy při kontrole).")
        print("Až uvidíš svoje inzeráty, zmáčkni tady Enter — prohlížeč se zavře a přihlášení si pamatuje.")
        try:
            input()
        except EOFError:
            pass
