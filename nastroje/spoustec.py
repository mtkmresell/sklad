# -*- coding: utf-8 -*-
"""
Spouštěč kontrol pro MTKM.Store (Gabro) — kontroly na PC ovládané z aplikace SKLAD.

Ovládá se v aplikaci SKLAD → Kontroly listingů
(i z mobilu): Spustit vše, jednotlivé kontroly, Zastavit, Přihlásit
v okně, stav a výpis při chybě. Aplikace a PC si předávají pokyny
a stav přes Firestore (kolekce spoustec, viz Agent níž).

Na PC má jen tiché okno (okno_stavu): startuje schované na liště
a po kliknutí ukáže točící se kolečko a co se právě děje. Dvojklik na
KONTROLY.pyw spustí spouštěč a otevře aplikaci; další dvojklik ukáže okno. Kontroly bez prohlížeče běží naráz (SOUBEZNE),
kontroly přes prohlížeč kontrol (Tnsky, KLEKT…) jedna po druhé —
sdílejí jeden profil a dva Chromy na něm spustit nejde.

Po zapnutí PC (zapíná se samo při prvním spuštění, vypnout jde
v aplikaci; zápis do registru Windows, nic se neinstaluje) běží
spouštěč tiše na pozadí a pustí všechny kontroly. Neotravuje: když
všechno projde, neozve se; když něco potřebuje tebe (přihlášení,
chyba), přijde jedno oznámení Windows. Po zapnutí do ODSTUP_PO_ZAPNUTI
od posledního běhu se nespouští nic — restart PC kvůli aktualizaci
nemá pouštět kontroly znovu.

Kontroly se pouštějí bez okna a bez klávesnice (SKLAD_BEZ_PTANI=1):
kde by se kontrola ptala na heslo nebo čekala na Enter, skončí hláškou
„Potřeba přihlásit“ a aplikace nabídne „Přihlásit na PC“ — pustí
kontrolu postaru přes SPUSTIT_*.bat, kde se dá přihlásit. Prohlížeč
kontrol běží skrytý; web, který prohlížeč bez okna nepustí (ověření
Cloudflare), se zkusí podruhé s oknem mimo obrazovku a spouštěč si to
u něj zapamatuje.

Výpis každého běhu je v <kontrola>/posledni_beh.txt, deník spouštěče
v %LOCALAPPDATA%\\MTKM-kontroly\\spoustec_log.txt, stav v spoustec.json
tamtéž — mimo Google Disk, ať se dvě PC nepřepisují.

V repozitáři: nastroje/spoustec.py, hlídá to test/test-spoustec.js.
"""
import os, sys, re, json, time, socket, threading, subprocess

SLOZKA = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "MTKM-kontroly")
STAV_SOUBOR = os.path.join(DATA, "spoustec.json")
VYPIS = "posledni_beh.txt"

SOUBEZNE = 3                    # kolik kontrol bez prohlížeče běží naráz
LIMIT_BEHU_S = 40 * 60          # zaseklou kontrolu po 40 minutách ukončit
ODSTUP_PO_ZAPNUTI_S = 2 * 3600  # po zapnutí PC nespouštět, když vše běželo před chvílí
CEKANI_NA_SIT_S = 5 * 60        # po zapnutí PC chvíli trvá, než naskočí Wi-Fi
PORT_ZAMKU = 47831              # jen jedno okno spouštěče naráz
NAZEV = "SKLAD. kontroly"          # jméno programu na liště, v oznámeních i v Po spuštění (majitel 13. 11. 2026)
JMENO_V_REGISTRU = NAZEV
STARA_JMENA_V_REGISTRU = ("MTKM kontroly",)   # dřívější jméno — uklidí se, jinak by se pouštělo dvakrát

# Kontroly, které se samy pustit nedají — Spustit vše je přeskakuje,
# tlačítko je pustí v okně. Zatím žádná.
RUCNI = {}   # WTB už bere pinger ze SKLADu (13. 11. 2026) a jede s ostatními
NAZVY = {"bazos": "Bazoš"}      # kde jméno místa v souboru není (Bazoš má .cz i .sk)

NO_WINDOW = 0x08000000          # CREATE_NO_WINDOW — bez černého okna
NOVA_KONZOLE = 0x00000010       # CREATE_NEW_CONSOLE — „V okně“


# ── Kontroly ve složce ──────────────────────────────────────────────────

def najdi_kontroly(koren=SLOZKA):
    """Každá podsložka s <jméno>_kontrola.py je kontrola. Nová kontrola =
    nová složka; spouštěč se kvůli ní nemění."""
    vse = []
    for d in sorted(os.listdir(koren)):
        sl = os.path.join(koren, d)
        skript = os.path.join(sl, d + "_kontrola.py")
        if not os.path.isfile(skript):
            continue
        try:
            with open(skript, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        m = re.search(r'^MISTO = "(.+?)"', text, re.M)
        vse.append({
            "klic": d,
            "nazev": NAZVY.get(d) or (m.group(1) if m else d.capitalize()),
            "slozka": sl,
            "skript": skript,
            "bat": os.path.join(sl, "SPUSTIT_%s.bat" % d),
            "prohlizec": "Prohlizec(" in text,
            "rucni": RUCNI.get(d, ""),
        })
    return vse


def rozeber_vystup(text, kod):
    """Co kontrola vypsala → {stav, zprava, souhrn, poslano}.
    stav: ok / chyba / prihlasit. Kontroly chybu chytají samy a končí
    s kódem 0, takže rozhoduje „!!! CHYBA:“ ve výpisu, ne kód."""
    radky = [r.rstrip() for r in (text or "").replace("\r", "\n").split("\n")]
    chyba = souhrn = ""
    for i, r in enumerate(radky):
        if r.startswith("!!! CHYBA:"):
            chyba = r[len("!!! CHYBA:"):].strip()
        if "HOTOVO" in r and "====" in r and not souhrn:
            souhrn = next((x.strip() for x in radky[i + 1:] if x.strip()), "")
    poslano = any(r.startswith("Posláno.") for r in radky)
    if chyba:
        stav = "prihlasit" if "Potřeba přihlásit" in chyba else "chyba"
    elif kod:
        stav = "chyba"
        posl = [r.strip() for r in radky if r.strip()]
        chyba = posl[-1] if posl else "Kontrola skončila s kódem %s." % kod
    elif not souhrn:
        stav, chyba = "chyba", "Kontrola doběhla bez výsledku — podívej se do výpisu."
    else:
        stav = "ok"
    return {"stav": stav, "zprava": chyba, "souhrn": souhrn, "poslano": poslano}


def python_exe():
    """Kontroly běží v python.exe (pythonw nemá výstup), okno je bez konzole."""
    exe = sys.executable or "python"
    if os.path.basename(exe).lower() == "pythonw.exe":
        p = os.path.join(os.path.dirname(exe), "python.exe")
        if os.path.exists(p):
            return p
    return exe


def pythonw_exe():
    exe = sys.executable or "pythonw"
    p = os.path.join(os.path.dirname(exe), "pythonw.exe")
    return p if os.path.exists(p) else exe


def spust_kontrolu(k, rezim="skryty", pri_radku=None, procesy=None, limit_s=LIMIT_BEHU_S):
    """Pustí jednu kontrolu bez okna a bez klávesnice. Vrací (kód, výpis)."""
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1", SKLAD_BEZ_PTANI="1")
    if k["prohlizec"]:
        env["SKLAD_PROHLIZEC"] = rezim
    else:
        env.pop("SKLAD_PROHLIZEC", None)
    p = subprocess.Popen([python_exe(), "-u", k["skript"]], cwd=k["slozka"], env=env,
                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         creationflags=NO_WINDOW if os.name == "nt" else 0)
    if procesy is not None:
        procesy[k["klic"]] = p
    vyprselo = []

    def hlidej():
        if p.poll() is None:
            vyprselo.append(1)
            p.kill()
    hlidac = threading.Timer(limit_s, hlidej)
    hlidac.daemon = True
    hlidac.start()
    casti = []
    try:
        with open(os.path.join(k["slozka"], VYPIS), "w", encoding="utf-8") as log:
            log.write("Spuštěno %s ze spouštěče kontrol\n\n" % time.strftime("%d.%m.%Y %H:%M:%S"))
            for b in iter(p.stdout.readline, b""):
                r = b.decode("utf-8", "replace")
                casti.append(r)
                log.write(r)
                log.flush()
                if pri_radku and r.strip():
                    pri_radku(r.strip())
        kod = p.wait()
    finally:
        hlidac.cancel()
        if procesy is not None:
            procesy.pop(k["klic"], None)
    text = "".join(casti)
    if vyprselo:
        text += "\n!!! CHYBA: Kontrola běžela přes %d min, ukončil jsem ji.\n" % (limit_s // 60)
    return kod, text


# ── Stav a běh ──────────────────────────────────────────────────────────

class Spoustec:
    """Logika bez okna — okno (okno()) jen čte self.stav a volá metody."""

    def __init__(self, koren=SLOZKA, stav_soubor=STAV_SOUBOR, soubezne=SOUBEZNE):
        self.koren, self.stav_soubor, self.soubezne = koren, stav_soubor, soubezne
        self.kontroly = najdi_kontroly(koren)
        self.zamek = threading.RLock()
        self.procesy = {}
        self.zastavene = set()     # klíče kontrol, které zastavil člověk
        self.info = ""             # proč se po zapnutí nic nespustilo
        self.vse_bezi = False
        self.zastaveno = False
        self.stav = {"kontroly": {}, "rezim": {}, "posledni_vse": 0, "posledni_vse_trvani": 0}
        try:
            with open(stav_soubor, encoding="utf-8") as f:
                ulozeny = json.load(f)
            if isinstance(ulozeny, dict):
                self.stav.update(ulozeny)
        except (OSError, ValueError):
            pass
        for k in self.kontroly:   # rozběhnuté při zavření okna nejsou rozběhnuté
            s = self.stav["kontroly"].get(k["klic"])
            if s and s.get("stav") in ("bezi", "ceka", "okno"):
                s["stav"] = "nevi"

    def uloz(self):
        with self.zamek:
            os.makedirs(os.path.dirname(self.stav_soubor), exist_ok=True)
            tmp = self.stav_soubor + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.stav, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.stav_soubor)

    def s(self, klic):
        return self.stav["kontroly"].setdefault(klic, {})

    def bezi(self, klic=None):
        with self.zamek:
            if klic:
                return self.s(klic).get("stav") in ("bezi", "ceka")
            return any(x.get("stav") in ("bezi", "ceka") for x in self.stav["kontroly"].values())

    def _beh(self, k):
        klic = k["klic"]
        if self.zastaveno:
            with self.zamek:
                self.s(klic).update(stav="nevi", zprava="Zastaveno.")
            return
        zac = time.time()
        with self.zamek:
            self.s(klic).update(stav="bezi", zacatek=zac, radek="Spouštím…", zprava="")

        def radek(r):
            with self.zamek:
                self.s(klic)["radek"] = r

        self.zastavene.discard(klic)
        rezim = self.stav["rezim"].get(klic, "skryty")
        kod, text = spust_kontrolu(k, rezim, radek, self.procesy)
        v = rozeber_vystup(text, kod)
        if self.zastaveno or klic in self.zastavene:
            with self.zamek:
                self.s(klic).update(stav="nevi", zprava="Zastaveno.", konec=time.time(),
                                    trvani=round(time.time() - zac), radek="")
            self.uloz()
            return
        if k["prohlizec"] and v["stav"] == "prihlasit" and rezim == "skryty":
            # Web možná jen nepustil prohlížeč bez okna (Cloudflare) → okno mimo obrazovku
            radek("Zkouším znovu s oknem prohlížeče mimo obrazovku…")
            kod, text = spust_kontrolu(k, "mimo", radek, self.procesy)
            v = rozeber_vystup(text, kod)
            if v["stav"] == "ok":
                with self.zamek:
                    self.stav["rezim"][klic] = "mimo"
        with self.zamek:
            # u chyby zůstane souhrn posledního povedeného běhu
            self.s(klic).update(stav=v["stav"], zprava=v["zprava"], poslano=v["poslano"],
                                konec=time.time(), trvani=round(time.time() - zac), radek="")
            if v["stav"] == "ok":
                self.s(klic).update(souhrn=v["souhrn"], posledni_ok=time.time(), vypis="")
            else:   # konec výpisu, ať jde chyba přečíst i z mobilu
                self.s(klic)["vypis"] = "\n".join([r for r in text.replace("\r", "\n").split("\n") if r.strip()][-25:])[-3000:]
        self.uloz()

    def spust(self, klic):
        """Jedna kontrola (tlačítko Spustit)."""
        k = next((x for x in self.kontroly if x["klic"] == klic), None)
        if not k or self.bezi(klic):
            return None
        if k["rucni"]:
            return self.v_okne(klic)
        if k["prohlizec"] and any(self.bezi(x["klic"]) for x in self.kontroly if x["prohlizec"]):
            with self.zamek:   # prohlížeč kontrol je obsazený → zařadit do fronty
                self.s(klic).update(stav="ceka", radek="Čeká, až doběhne jiná kontrola v prohlížeči.")
            t = threading.Thread(target=self._pockej_a_spust, args=(k,), daemon=True)
        else:
            with self.zamek:
                self.s(klic).update(stav="ceka", radek="Spouštím…")
            t = threading.Thread(target=self._beh, args=(k,), daemon=True)
        self.zastaveno = False
        t.start()
        return t

    def _pockej_a_spust(self, k):
        while any(self.s(x["klic"]).get("stav") == "bezi" for x in self.kontroly if x["prohlizec"]):
            time.sleep(0.5)
        self._beh(k)

    def spust_vse(self, hotovo=None):
        """Všechno kromě ručních: bez prohlížeče naráz, s prohlížečem po jedné."""
        with self.zamek:
            if self.vse_bezi:
                return None
            self.vse_bezi, self.zastaveno = True, False
            plan = [k for k in self.kontroly if not k["rucni"] and not self.bezi(k["klic"])]
            for k in plan:
                self.s(k["klic"]).update(stav="ceka", radek="Čeká na spuštění.", zprava="")
        zac = time.time()

        def prohlizecove():
            for k in [k for k in plan if k["prohlizec"]]:
                self._beh(k)

        def ostatni():
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=self.soubezne) as ex:
                list(ex.map(self._beh, [k for k in plan if not k["prohlizec"]]))

        def vse():
            vl = [threading.Thread(target=f, daemon=True) for f in (prohlizecove, ostatni)]
            for v in vl:
                v.start()
            for v in vl:
                v.join()
            with self.zamek:
                self.vse_bezi = False
                if not self.zastaveno:
                    self.stav["posledni_vse"] = time.time()
                    self.stav["posledni_vse_trvani"] = round(time.time() - zac)
            self.uloz()
            if hotovo:
                hotovo(self.souhrn())

        t = threading.Thread(target=vse, daemon=True)
        t.start()
        return t

    def zastav(self, klic=None):
        """Zastaví jednu kontrolu, nebo (bez klíče) všechny i frontu."""
        if klic:
            self.zastavene.add(klic)
            p = self.procesy.get(klic)
            if p:
                try:
                    p.kill()
                except Exception:
                    pass
            return
        self.zastaveno = True
        for p in list(self.procesy.values()):
            try:
                p.kill()
            except Exception:
                pass

    def v_okne(self, klic):
        """Kontrola postaru přes SPUSTIT_*.bat — s oknem, kde se dá přihlásit."""
        k = next((x for x in self.kontroly if x["klic"] == klic), None)
        if not k or not os.path.exists(k["bat"]) or self.bezi(klic):
            return None
        p = subprocess.Popen(["cmd", "/c", k["bat"]], cwd=k["slozka"],
                             creationflags=NOVA_KONZOLE if os.name == "nt" else 0)
        with self.zamek:
            self.s(klic).update(stav="okno", radek="Běží v samostatném okně — výsledek uvidíš tam.", zacatek=time.time())
            if k["prohlizec"]:     # po přihlášení v okně zkusit zase bez okna
                self.stav["rezim"].pop(klic, None)

        def konec():
            p.wait()
            with self.zamek:
                if self.s(klic).get("stav") == "okno":
                    self.s(klic).update(stav="rucne", konec=time.time(), radek="",
                                        zprava="", souhrn="Proběhlo v okně — výsledek byl tam.")
            self.uloz()
        threading.Thread(target=konec, daemon=True).start()
        return p

    def souhrn(self):
        with self.zamek:
            vse = [self.s(k["klic"]).get("stav") for k in self.kontroly if not k["rucni"]]
        return {"ok": vse.count("ok") + vse.count("rucne"), "chyba": vse.count("chyba"),
                "prihlasit": vse.count("prihlasit"), "bezi": vse.count("bezi") + vse.count("ceka"),
                "celkem": len(vse)}

    def po_zapnuti(self, hotovo=None, cekej_na_sit=None):
        """Po přihlášení do Windows: vše, pokud neběželo před chvílí. Vrací důvod, když ne."""
        pred = time.time() - (self.stav.get("posledni_vse") or 0)
        if pred < ODSTUP_PO_ZAPNUTI_S:
            return "Kontroly běžely před %d min, po zapnutí PC se nespouští znovu." % (pred // 60)
        if not (cekej_na_sit or je_sit)():
            return "Nejde internet — kontroly se nespustily. Zkus Spustit vše."
        self.spust_vse(hotovo)
        return None


def je_sit(cekat_s=CEKANI_NA_SIT_S):
    konec = time.time() + cekat_s
    while True:
        try:
            socket.create_connection(("firestore.googleapis.com", 443), timeout=5).close()
            return True
        except OSError:
            if time.time() > konec:
                return False
            time.sleep(5)


# ── Windows: spuštění po zapnutí, oznámení ─────────────────────────────

def prikaz_po_zapnuti(pythonw, cesta):
    """Příkaz do registru. Disk Google se po přihlášení připojuje až chvíli
    po startu, takže se na soubor čeká (až 10 min), než se spustí."""
    kod = ("import os,sys,time,runpy;p=%r;"
           "[time.sleep(5) for _ in range(120) if not os.path.exists(p)];"
           "sys.argv=[p,'--po-zapnuti'];runpy.run_path(p,run_name='__main__')") % cesta
    return '"%s" -c "%s"' % (pythonw, kod)


def _klic_run(zapis=False):
    import winreg
    return winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                          winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE if zapis else winreg.KEY_QUERY_VALUE)


def je_po_zapnuti():
    if os.name != "nt":
        return False
    try:
        import winreg
        with _klic_run() as k:
            for jmeno in (JMENO_V_REGISTRU,) + STARA_JMENA_V_REGISTRU:
                try:
                    winreg.QueryValueEx(k, jmeno)
                    return True
                except OSError:
                    pass
        return False
    except OSError:
        return False


def prejmenuj_v_registru():
    """Záznam pod starým jménem přepíše na nové (jen když tam starý je)."""
    if os.name != "nt":
        return
    import winreg
    try:
        with _klic_run() as k:
            stary = False
            for jmeno in STARA_JMENA_V_REGISTRU:
                try:
                    winreg.QueryValueEx(k, jmeno)
                    stary = True
                except OSError:
                    pass
    except OSError:
        return
    if stary:
        nastav_po_zapnuti(True)


def nastav_po_zapnuti(zapnout):
    import winreg
    with _klic_run(True) as k:
        for jmeno in STARA_JMENA_V_REGISTRU:
            try:
                winreg.DeleteValue(k, jmeno)
            except OSError:
                pass
        if zapnout:
            winreg.SetValueEx(k, JMENO_V_REGISTRU, 0, winreg.REG_SZ,
                              prikaz_po_zapnuti(pythonw_exe(), os.path.join(SLOZKA, "KONTROLY.pyw")))
        else:
            try:
                winreg.DeleteValue(k, JMENO_V_REGISTRU)
            except OSError:
                pass


def oznameni(nadpis, text):
    """Jedno oznámení Windows (vpravo dole). Když nejde, nevadí."""
    if os.name != "nt":
        return
    ps = ("[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;"
          "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(1);"
          "$x=$t.GetElementsByTagName('text');"
          "$x.Item(0).AppendChild($t.CreateTextNode($env:MTKM_N))>$null;"
          "$x.Item(1).AppendChild($t.CreateTextNode($env:MTKM_T))>$null;"
          "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
          "'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')"
          ".Show([Windows.UI.Notifications.ToastNotification]::new($t))")
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                         env=dict(os.environ, MTKM_N=nadpis, MTKM_T=text), creationflags=NO_WINDOW)
    except Exception:
        pass


def jediny(port=PORT_ZAMKU):
    """Zámek proti dvěma oknům. Vrací naslouchající socket, nebo None, když
    už spouštěč běží — tomu se pošle „ukaž se“."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        s.listen(2)
        return s
    except OSError:
        s.close()
        try:
            socket.create_connection(("127.0.0.1", port), timeout=2).close()
        except OSError:
            pass
        return None




# ── Spojení s aplikací SKLAD ────────────────────────────────────────────
#
# Spouštěč nemá vlastní okno (majitel, 13. 11. 2026: okno v tkinteru
# „vypadá staře“). Ovládá se z aplikace SKLAD, okno Kontroly listingů:
# aplikace položí pokyn `spoustec/prikaz_…`, spouštěč ho do DOTAZ_S
# vyzvedne, provede a smaže, a do `spoustec/pc` zapisuje, co dělá.
# Funguje odkudkoli, i z mobilu — jen PC musí být zapnuté.
#
# Pokyn smí založit jedině majitel (pravidla Firestore, blok spoustec);
# spouštěč běží pod účtem čtečky a smí jen číst, zapsat `pc` a smazat
# vyřízený pokyn. Pokyn nese jen „co“ a „kterou kontrolu“ — žádný příkaz
# ani cestu, spustit jde jedině kontrola, kterou spouštěč sám našel.

ADRESA_APLIKACE = "https://sklad.mtkm-resell.workers.dev/#kontroly"
KOLEKCE = "spoustec"
PRIKAZ_PREFIX = "prikaz_"
PRIKAZ_STARY_S = 10 * 60   # pokyn starší než 10 min se neprovede (PC bylo vypnuté)
DOTAZ_S = 10               # jak často se ptá na pokyny
TEP_S = 120                # stav aspoň jednou za 2 min — podle toho aplikace pozná zapnuté PC
ZAPIS_ODSTUP_S = 3         # při běhu kontrol stav nejvýš jednou za 3 s
AKCE = ("vse", "spust", "zastav", "okno", "po_zapnuti")
LOG = os.path.join(DATA, "spoustec_log.txt")


def _iso(ts):
    if not ts:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _z_iso(t):
    try:
        import calendar
        return calendar.timegm(time.strptime(str(t)[:19], "%Y-%m-%dT%H:%M:%S"))
    except (ValueError, TypeError):
        return None


def zapis_log(text):
    """Krátký deník spouštěče (bez okna se jinak nedá zjistit, co se dělo)."""
    try:
        os.makedirs(DATA, exist_ok=True)
        if os.path.exists(LOG) and os.path.getsize(LOG) > 200000:
            os.replace(LOG, LOG + ".stary")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write("%s  %s\n" % (time.strftime("%d.%m. %H:%M:%S"), text))
    except OSError:
        pass


class Cloud:
    """Firestore pro spouštěč: čte pokyny, zapisuje jen `pc`, maže jen pokyny."""

    def __init__(self, prihlaseni=None):
        import sklad_firestore as S
        self.S = S
        self.prihlaseni = prihlaseni or S.prihlas
        self._token, self._kdy = None, 0

    def token(self):
        if not self._token or time.time() - self._kdy > 50 * 60:   # token platí hodinu
            self._token, self._kdy = self.prihlaseni(), time.time()
        return self._token

    def _url(self, jmeno=""):
        return self.S.FS_BASE + "/users/" + self.S.MAJITEL_UID + "/" + KOLEKCE + ("/" + jmeno if jmeno else "")

    def _odpoved(self, status, co):
        if status == 401:
            self._token = None
        if status == 403:
            raise self.S.ChybaSkladu("Cloud odmítl %s (403) — v konzoli Firebase chybí blok spoustec "
                                     "z firestore.rules." % co)
        if status not in (200, 404):
            raise self.S.ChybaSkladu("Cloud: %s selhalo (%s)." % (co, status))

    def prikazy(self):
        status, j = self.S._http(self._url() + "?pageSize=50", token=self.token())
        self._odpoved(status, "čtení pokynů")
        out = []
        for d in (j or {}).get("documents", []) if status == 200 else []:
            jmeno = d["name"].rsplit("/", 1)[-1]
            if re.match(r"^%s[A-Za-z0-9_-]{1,60}$" % PRIKAZ_PREFIX, jmeno):
                out.append((jmeno, self.S.rozbal_pole(d.get("fields"))))
        return out

    def zapis_stav(self, obsah):
        telo = {"fields": self.S.zabal(obsah)["mapValue"]["fields"]}
        status, _ = self.S._http(self._url("pc"), telo, token=self.token(), metoda="PATCH")
        self._odpoved(status, "zápis stavu")

    def smaz_prikaz(self, jmeno):
        if not re.match(r"^%s[A-Za-z0-9_-]{1,60}$" % PRIKAZ_PREFIX, jmeno):
            raise ValueError("mazat se smí jen pokyn")
        status, _ = self.S._http(self._url(jmeno), token=self.token(), metoda="DELETE")
        self._odpoved(status, "smazání pokynu")


class Agent:
    """Spojka mezi aplikací a spouštěčem. krok() = jedno kolo: pokyny + stav."""

    def __init__(self, sp, cloud=None):
        self.sp, self.cloud = sp, cloud or Cloud()
        self.vyrizene = set()          # pokyn, který se nepovedlo smazat, se neprovede dvakrát
        self.posledni_obsah, self.posledni_zapis = None, 0
        self.chyba = ""

    def stav_pro_aplikaci(self):
        with self.sp.zamek:
            kontroly = []
            for k in self.sp.kontroly:
                s = dict(self.sp.s(k["klic"]))
                kontroly.append({
                    "klic": k["klic"], "nazev": k["nazev"], "prohlizec": k["prohlizec"], "rucni": bool(k["rucni"]),
                    "stav": s.get("stav") or "", "zprava": s.get("zprava") or "", "souhrn": s.get("souhrn") or "",
                    "radek": s.get("radek") or "", "zacatek": _iso(s.get("zacatek")), "konec": _iso(s.get("konec")),
                    "trvani": int(s.get("trvani") or 0), "poslano": bool(s.get("poslano")),
                    "vypis": s.get("vypis") or "" if s.get("stav") in ("chyba", "prihlasit") else "",
                })
            return {
                "po_zapnuti": je_po_zapnuti(), "vse_bezi": bool(self.sp.vse_bezi),
                "posledni_vse": _iso(self.sp.stav.get("posledni_vse")),
                "posledni_vse_trvani": int(self.sp.stav.get("posledni_vse_trvani") or 0),
                "info": self.sp.info or "", "pocitac": (os.environ.get("COMPUTERNAME") or "")[:40],
                "kontroly": kontroly,
            }

    def proved(self, data):
        """Jeden pokyn z aplikace. Vrací, co se udělalo (pro deník)."""
        co, klic = (data or {}).get("co"), (data or {}).get("klic")
        znama = any(k["klic"] == klic for k in self.sp.kontroly)
        kdy = _z_iso((data or {}).get("kdy"))
        if co not in AKCE:
            return "neznámý pokyn"
        if not kdy or time.time() - kdy > PRIKAZ_STARY_S:
            return "starý pokyn, neprovádí se"
        if co == "vse":
            self.sp.spust_vse(self.po_vsem)
        elif co == "spust" and znama:
            self.sp.spust(klic)
        elif co == "zastav":
            self.sp.zastav(klic if znama else None)
        elif co == "okno" and znama:
            self.sp.v_okne(klic)
        elif co == "po_zapnuti" and os.name == "nt":
            nastav_po_zapnuti(bool(data.get("zapnout")))
        else:
            return "pokyn bez platné kontroly"
        return "provedeno: %s %s" % (co, klic or "")

    def po_vsem(self, sh):
        pass

    def krok(self):
        try:
            for jmeno, data in sorted(self.cloud.prikazy(), key=lambda x: str(x[1].get("kdy"))):
                if jmeno in self.vyrizene:
                    continue
                self.vyrizene.add(jmeno)
                zapis_log("%s → %s" % (jmeno, self.proved(data)))
                try:
                    self.cloud.smaz_prikaz(jmeno)
                except Exception as e:
                    zapis_log("pokyn %s se nesmazal: %s" % (jmeno, e))
            obsah = self.stav_pro_aplikaci()
            ted = time.time()
            zmena = obsah != self.posledni_obsah
            if (zmena and ted - self.posledni_zapis >= ZAPIS_ODSTUP_S) or ted - self.posledni_zapis >= TEP_S:
                self.cloud.zapis_stav(dict(obsah, tep=_iso(ted)))
                self.posledni_obsah, self.posledni_zapis = obsah, ted
            if self.chyba:
                zapis_log("spojení s aplikací zase jede")
            self.chyba = ""
        except Exception as e:
            if str(e) != self.chyba:
                zapis_log("spojení s aplikací: %s" % e)
            self.chyba = str(e)

    def bez_konce(self):
        while True:
            self.krok()
            # při běhu kontrol se stav posílá častěji, ať je v aplikaci vidět průběh
            konec = time.time() + (DOTAZ_S if not self.chyba else 60)
            while time.time() < konec:
                time.sleep(1)
                if self.sp.bezi() and time.time() - self.posledni_zapis >= ZAPIS_ODSTUP_S \
                        and self.stav_pro_aplikaci() != self.posledni_obsah:
                    break


# ── Tiché okno ──────────────────────────────────────────────────────────
#
# Majitel (13. 11. 2026): ovládání je ve SKLADu, ale na PC chce vidět, že
# program opravdu běží — okno, které nevyskočí (startuje jen na liště),
# po kliknutí černá plocha s točícím se kolečkem a pod ním, co se právě
# děje. Nic se v něm neovládá, jen ukazuje. Křížek okno jen schová na
# lištu (zavřít omylem = kontroly by přestaly jít ze SKLADu); vypnout
# jde odkazem Ukončit dole. Bez tkinteru běží spouštěč bez okna jako dřív.

BARVY = {"bg": "#0b0b0b", "stopa": "#1d1d1d", "accent": "#c8ff00", "text": "#f0f0f0",
         "muted": "#7a7a7a", "muted2": "#4a4a4a", "chyba": "#ff4444", "pozor": "#ff8c1a"}


def popis_stavu(sp, ag):
    """(nadpis, řádek, patička, barva kolečka, běží) — co okno ukáže."""
    with sp.zamek:
        ks = [(k, dict(sp.s(k["klic"]))) for k in sp.kontroly]
    bezi = [(k, s) for k, s in ks if s.get("stav") == "bezi"]
    ceka = [k for k, s in ks if s.get("stav") == "ceka"]
    if bezi:
        jmena = ", ".join(k["nazev"] for k, _ in bezi)
        nadpis = "Běží " + jmena + (" · čeká %d" % len(ceka) if ceka else "")
        k, s = bezi[-1]
        radek = (k["nazev"] + ": " + s["radek"]) if s.get("radek") else ""
        barva = "accent"
    elif ceka:
        nadpis, radek, barva = "Kontroly čekají na spuštění", "", "accent"
    else:
        problem = [k["nazev"] for k, s in ks if s.get("stav") in ("chyba", "prihlasit")]
        nadpis = "Připraveno — čekám na pokyn ze SKLADu"
        radek = ("Pozornost chce: " + ", ".join(problem)) if problem else (
            "Naposledy všechny: " + time.strftime("%d. %m. %H:%M", time.localtime(sp.stav["posledni_vse"]))
            if sp.stav.get("posledni_vse") else "")
        barva = "pozor" if problem else "muted"
    if ag.chyba:
        pata, barva_paty = "Spojení se SKLADem: " + ag.chyba, "chyba"
    elif ag.posledni_zapis:
        pata, barva_paty = "Spojeno se SKLADem · " + time.strftime("%H:%M:%S", time.localtime(ag.posledni_zapis)), "muted2"
    else:
        pata, barva_paty = "Připojuji se ke SKLADu…", "muted2"
    return nadpis, radek, pata, barva_paty, barva, bool(bezi or ceka)


def okno_stavu(sp, ag, zamek):
    import tkinter as tk
    B = BARVY
    win = os.name == "nt"
    root = tk.Tk()
    root.title(NAZEV)
    root.configure(bg=B["bg"])
    root.geometry("440x330")
    root.minsize(360, 280)
    root.iconify()                       # nevyskočí — jen ikona na liště
    F = "Segoe UI" if win else "DejaVu Sans"

    platno = tk.Canvas(root, width=96, height=96, bg=B["bg"], highlightthickness=0)
    platno.pack(pady=(46, 22))
    platno.create_oval(10, 10, 86, 86, outline=B["stopa"], width=5)
    oblouk = platno.create_arc(10, 10, 86, 86, start=90, extent=100, style="arc", outline=B["accent"], width=5)
    nadpis = tk.Label(root, font=(F + " Semibold" if win else F, 12, "bold"), bg=B["bg"], fg=B["text"], wraplength=400)
    nadpis.pack(padx=20)
    radek = tk.Label(root, font=(F, 10), bg=B["bg"], fg=B["muted"], wraplength=400, justify="center")
    radek.pack(padx=20, pady=(6, 0))
    dole = tk.Frame(root, bg=B["bg"])
    dole.pack(side="bottom", fill="x", padx=16, pady=12)
    pata = tk.Label(dole, font=(F, 8), bg=B["bg"], fg=B["muted2"], anchor="w")
    pata.pack(side="left")
    konec = tk.Label(dole, text="Ukončit", font=(F, 8, "underline"), bg=B["bg"], fg=B["muted2"], cursor="hand2")
    konec.pack(side="right")

    stav = {"uhel": 90.0, "posledni": None, "ukazat": False}

    def toc():
        bezi = stav["posledni"] and stav["posledni"][5]
        stav["uhel"] = (stav["uhel"] - (7 if bezi else 1.6)) % 360   # při běhu rychle, jinak klidně
        platno.itemconfigure(oblouk, start=stav["uhel"])
        root.after(16, toc)

    def obnov():
        p = popis_stavu(sp, ag)
        if p != stav["posledni"]:
            stav["posledni"] = p
            nadpis.configure(text=p[0])
            radek.configure(text=p[1])
            pata.configure(text=p[2], fg=B[p[3]])
            platno.itemconfigure(oblouk, outline=B[p[4]] if p[4] != "muted" else B["muted2"])
            platno.itemconfigure(oblouk, extent=100 if p[5] else 70)
        if stav["ukazat"]:
            stav["ukazat"] = False
            root.deiconify()
            root.lift()
        root.after(250, obnov)

    def ukonci(_e=None):
        sp.zastav()
        zapis_log("spouštěč ukončen z okna")
        root.destroy()
    konec.bind("<Button-1>", ukonci)
    root.protocol("WM_DELETE_WINDOW", root.iconify)   # křížek jen schová na lištu

    def poslouchej():                    # druhý dvojklik na KONTROLY.pyw okno ukáže
        while True:
            try:
                c, _ = zamek.accept()
                c.close()
                stav["ukazat"] = True
            except OSError:
                return
    threading.Thread(target=poslouchej, daemon=True).start()
    obnov()
    toc()
    root.mainloop()


def otevri_aplikaci():
    try:
        import webbrowser
        webbrowser.open(ADRESA_APLIKACE)
    except Exception:
        pass


def main(argv):
    """Dvojklik na KONTROLY.pyw: spustí spouštěč na pozadí (když neběží)
    a otevře aplikaci SKLAD na okně Kontroly listingů. Po zapnutí PC
    (--po-zapnuti) jen tiše na pozadí a pustí všechny kontroly."""
    po = "--po-zapnuti" in argv
    zamek = jediny()
    if zamek is None:              # už běží — stačí ukázat aplikaci
        if not po:
            otevri_aplikaci()
        return 0
    sp = Spoustec()
    zapis_log("spouštěč běží" + (" (po zapnutí PC)" if po else ""))
    # Poprvé se rovnou zapne spouštění po zapnutí PC — o to majitel stál
    if os.name == "nt" and not sp.stav.get("po_zapnuti_nastaveno"):
        try:
            nastav_po_zapnuti(True)
            sp.stav["po_zapnuti_nastaveno"] = True
            sp.uloz()
        except OSError as e:
            zapis_log("spuštění po zapnutí se nenastavilo: %s" % e)
    try:
        prejmenuj_v_registru()
    except OSError as e:
        zapis_log("přejmenování v Po spuštění se nepovedlo: %s" % e)
    ag = Agent(sp)
    if po:
        def hotovo(sh):
            if sh["chyba"] or sh["prihlasit"]:
                casti = []
                if sh["prihlasit"]:
                    casti.append("%d potřebuje přihlásit" % sh["prihlasit"])
                if sh["chyba"]:
                    casti.append("%d skončilo chybou" % sh["chyba"])
                oznameni(NAZEV + ": kontroly doběhly", ", ".join(casti) + ". Podrobnosti v SKLADu → Kontroly listingů.")

        def start():
            sp.info = sp.po_zapnuti(hotovo) or ""
        threading.Thread(target=start, daemon=True).start()
    else:
        otevri_aplikaci()
    # Spojení se SKLADem jede na pozadí, okno (když jde) v hlavním vlákně
    try:
        import tkinter  # noqa: F401
    except ImportError:
        ag.bez_konce()
        return 0
    threading.Thread(target=ag.bez_konce, daemon=True).start()
    okno_stavu(sp, ag, zamek)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
