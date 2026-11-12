# -*- coding: utf-8 -*-
"""
Prohlížeč pro kontroly, které se skriptem přihlásit nejdou (Facebook,
Hypeboost za Cloudflare, Klekt, Tnsky, Sneakerstore, Released).

Otevře skutečný Chrome (nebo Edge) s VLASTNÍM profilem kontrol — ne tvým
běžným. Na každý web se v něm přihlásíš jednou sám, rukou; profil si
přihlášení pamatuje, takže příště už to jede samo. Hesla skript nikdy
nevidí ani neukládá. Data se pak čtou ze stránky stejným JavaScriptem,
jaký používaly skilly ve vestavěném prohlížeči.

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
        posledni = None
        for kanal in ("chrome", "msedge", None):
            try:
                self._ctx = self._pw.chromium.launch_persistent_context(
                    PROFIL, channel=kanal, headless=not self.viditelny, viewport={"width": 1280, "height": 900},
                    args=["--disable-blink-features=AutomationControlled"])
                break
            except Exception as e:
                posledni = e
        if not self._ctx:
            self._pw.stop()
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
        s.goto(url, wait_until="domcontentloaded", timeout=90000)
        s.wait_for_timeout(cekat_ms)
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
                stranka.goto(url, wait_until="domcontentloaded", timeout=90000)
                stranka.wait_for_timeout(2000)
        raise ChybaProhlizece("Na %s se nepodařilo přihlásit — stránka pořád nic neukazuje." % misto)


def js_cekej(stranka, vyraz, sekund=40):
    """Čeká, až výraz v okně stránky vrátí něco jiného než null (běh na pozadí)."""
    konec = time.time() + sekund
    while time.time() < konec:
        v = stranka.evaluate(vyraz)
        if v is not None:
            return v
        stranka.wait_for_timeout(2000)
    return None


WEBY = {
    "Tnsky": "https://sell.tnsky.cz/inventory",
    "Sneakerstore": "https://sell.sneakerstore.cz/inventory",
    "Hypeboost": "https://hypeboost.com/en/account/sales/current",
    "KLEKT": "https://klekt.com/profile/seller/listings",
    "Released": "https://sell-releasedcz-dev.web.app/my-offers",
    "Facebook": "https://www.facebook.com/marketplace/you/selling",
}


if __name__ == "__main__":
    # PRIHLASIT_WEBY.bat: otevře všechny weby v profilu kontrol, ať se přihlásíš jednou všude
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
        print("Otevřel jsem %d záložek. V každé se přihlas (Hypeboost: odklikni i ověření)." % len(WEBY))
        print("Až budeš všude vidět svoje nabídky, zmáčkni tady Enter — prohlížeč se zavře a přihlášení si pamatuje.")
        try:
            input()
        except EOFError:
            pass
