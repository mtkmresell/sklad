# -*- coding: utf-8 -*-
"""
Spouštěč kontrol pro MTKM.Store (Gabro) — jedno okno pro všechny kontroly.

Spouští se dvojklikem na KONTROLY.pyw (bez černého okna příkazové řádky).
U každé kontroly je vidět, kdy běžela, jak dopadla a co právě dělá;
nahoře „Spustit vše“. Kontroly bez prohlížeče běží naráz (SOUBEZNE),
kontroly přes prohlížeč kontrol (Tnsky, KLEKT…) jedna po druhé — sdílejí
jeden profil a dva Chromy na něm spustit nejde.

Po zapnutí PC (přepínač „Spouštět po zapnutí PC“, zápis do registru
Windows, nic se neinstaluje) se okno otevře jen jako ikona na liště
a pustí všechny kontroly samo. Neotravuje: když všechno projde, neozve
se; když něco potřebuje tebe (přihlášení, chyba), přijde jedno oznámení
Windows. Po zapnutí do ODSTUP_PO_ZAPNUTI od posledního běhu se nespouští
nic — restart PC kvůli aktualizaci nemá pouštět kontroly znovu.

Kontroly se pouštějí bez okna a bez klávesnice (SKLAD_BEZ_PTANI=1):
kde by se kontrola ptala na heslo nebo čekala na Enter, skončí hláškou
„Potřeba přihlásit“ a tady se ukáže tlačítko „V okně“ — pustí kontrolu
postaru přes SPUSTIT_*.bat, kde se dá přihlásit. Prohlížeč kontrol běží
skrytý; web, který prohlížeč bez okna nepustí (ověření Cloudflare), se
zkusí podruhé s oknem mimo obrazovku a spouštěč si to u něj zapamatuje.

Výpis každého běhu je v <kontrola>/posledni_beh.txt (tlačítko Výpis).
Stav spouštěče je v %LOCALAPPDATA%\\MTKM-kontroly\\spoustec.json — mimo
Google Disk, ať se dvě PC nepřepisují.

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
JMENO_V_REGISTRU = "MTKM kontroly"

# Kontroly, které se samy pustit nedají: WTB bere text pingeru ze schránky.
# Spustit vše je přeskakuje, tlačítko je pustí v okně.
RUCNI = {"wtb": "Bere text pingeru ze schránky — pouští se jen v okně."}
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
                self.s(klic).update(souhrn=v["souhrn"], posledni_ok=time.time())
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
            winreg.QueryValueEx(k, JMENO_V_REGISTRU)
        return True
    except OSError:
        return False


def nastav_po_zapnuti(zapnout):
    import winreg
    with _klic_run(True) as k:
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


# ── Okno ────────────────────────────────────────────────────────────────

BARVY = dict(bg="#0f0f0f", surface="#181818", surface2="#222222", surface3="#2a2a2a", border="#2e2e2e",
             accent="#c8ff00", accent2="#ff6b35", text="#f0f0f0", muted="#777777", muted2="#555555",
             danger="#ff4444", warning="#ffaa00")
STAVY = {   # stav → (barva tečky, popisek)
    "ok": ("accent", "V pořádku"), "rucne": ("accent", "V okně"), "chyba": ("danger", "Chyba"),
    "prihlasit": ("warning", "Přihlásit"), "bezi": ("warning", "Běží"), "ceka": ("muted", "Čeká"),
    "okno": ("warning", "V okně"), "nevi": ("muted2", "Nedoběhlo"), None: ("muted2", "Ještě neběželo"),
}


def kdy(ts):
    if not ts:
        return ""
    t, ted = time.localtime(ts), time.localtime()
    hod = time.strftime("%H:%M", t)
    if t.tm_yday == ted.tm_yday and t.tm_year == ted.tm_year:
        return "dnes " + hod
    if time.localtime(time.time() - 86400).tm_yday == t.tm_yday:
        return "včera " + hod
    return time.strftime("%d. %m. ", t).lstrip("0").replace(" 0", " ") + hod


def trvani(s):
    s = int(s or 0)
    return "%d s" % s if s < 60 else "%d min %02d s" % (s // 60, s % 60)


def okno(sp, po_zapnuti=False, zamek=None):
    import tkinter as tk
    from tkinter import messagebox
    B = BARVY
    win = os.name == "nt"
    F_NADPIS = ("Bahnschrift SemiBold", 17) if win else ("DejaVu Sans", 15, "bold")
    F_JMENO = ("Segoe UI Semibold", 11) if win else ("DejaVu Sans", 10, "bold")
    F = ("Segoe UI", 10) if win else ("DejaVu Sans", 9)
    F_MALE = ("Segoe UI", 9) if win else ("DejaVu Sans", 8)
    F_MONO = ("Consolas", 9) if win else ("DejaVu Sans Mono", 8)

    root = tk.Tk()
    root.title("MTKM kontroly")
    root.configure(bg=B["bg"])
    root.geometry("860x720")
    root.minsize(640, 420)
    if po_zapnuti:
        root.iconify()     # po zapnutí PC jen ikona na liště — nepřekáží

    def tlacitko(rodic, text, prikaz, hlavni=False, male=False):
        bg, fg, hov = (B["accent"], "#000", "#d8ff4d") if hlavni else (B["surface2"], B["text"], B["surface3"])
        l = tk.Label(rodic, text=text, bg=bg, fg=fg, font=(F_JMENO if hlavni and not male else F_MALE if male else F),
                     padx=12 if not male else 9, pady=6 if not male else 3, cursor="hand2",
                     highlightthickness=0 if hlavni else 1, highlightbackground=B["border"])
        l.bind("<Enter>", lambda e: l.configure(bg=hov))
        l.bind("<Leave>", lambda e: l.configure(bg=bg))
        l.bind("<Button-1>", lambda e: prikaz())
        return l

    # Hlavička
    hl = tk.Frame(root, bg=B["surface"], padx=20, pady=14)
    hl.pack(fill="x")
    tk.Frame(root, bg=B["border"], height=1).pack(fill="x")
    logo = tk.Frame(hl, bg=B["surface"])
    logo.pack(side="left")
    for text, barva in (("MTKM", "text"), (".", "accent"), ("  kontroly", "muted")):
        tk.Label(logo, text=text, font=F_NADPIS, bg=B["surface"], fg=B[barva], padx=0, bd=0).pack(side="left")

    vse_btn = tlacitko(hl, "Spustit vše", lambda: spust_vse(), hlavni=True)
    vse_btn.pack(side="right")

    po_var = {"on": je_po_zapnuti()}
    po_lbl = tk.Label(hl, bg=B["surface"], font=F_MALE, cursor="hand2", padx=14)
    po_lbl.pack(side="right")

    def kresli_po():
        po_lbl.configure(text=("●  Spouštět po zapnutí PC" if po_var["on"] else "○  Spouštět po zapnutí PC"),
                         fg=B["accent"] if po_var["on"] else B["muted"])

    def prepni_po(_e=None):
        if not win:
            return
        try:
            nastav_po_zapnuti(not po_var["on"])
            po_var["on"] = je_po_zapnuti()
        except OSError as e:
            messagebox.showerror("MTKM kontroly", "Nepovedlo se: %s" % e)
        kresli_po()
    po_lbl.bind("<Button-1>", prepni_po)
    kresli_po()

    # Pruh se souhrnem
    pruh = tk.Frame(root, bg=B["bg"], padx=20, pady=12)
    pruh.pack(fill="x")
    dlazdice = {}
    for klic, popis, barva in (("ok", "V pořádku", "accent"), ("prihlasit", "Přihlásit", "warning"),
                               ("chyba", "Chyby", "danger"), ("bezi", "Běží", "text")):
        d = tk.Frame(pruh, bg=B["surface"], padx=16, pady=8, highlightthickness=1, highlightbackground=B["border"])
        d.pack(side="left", padx=(0, 9))
        tk.Label(d, text=popis.upper(), font=F_MONO, bg=B["surface"], fg=B["muted"]).pack(anchor="w")
        v = tk.Label(d, text="0", font=F_NADPIS, bg=B["surface"], fg=B[barva])
        v.pack(anchor="w")
        dlazdice[klic] = v
    info = tk.Label(pruh, text="", font=F_MALE, bg=B["bg"], fg=B["muted"], justify="right")
    info.pack(side="right")

    # Seznam kontrol (rolovací)
    obal = tk.Frame(root, bg=B["bg"])
    obal.pack(fill="both", expand=True, padx=(20, 8), pady=(0, 14))
    platno = tk.Canvas(obal, bg=B["bg"], highlightthickness=0, bd=0)
    posuv = tk.Scrollbar(obal, orient="vertical", command=platno.yview, width=10)
    seznam = tk.Frame(platno, bg=B["bg"])
    okno_id = platno.create_window((0, 0), window=seznam, anchor="nw")
    platno.configure(yscrollcommand=posuv.set)
    platno.pack(side="left", fill="both", expand=True)
    posuv.pack(side="right", fill="y")
    seznam.bind("<Configure>", lambda e: platno.configure(scrollregion=platno.bbox("all")))
    platno.bind("<Configure>", lambda e: platno.itemconfigure(okno_id, width=e.width - 10))
    root.bind_all("<MouseWheel>", lambda e: platno.yview_scroll(int(-e.delta / 120), "units"))
    root.bind_all("<Button-4>", lambda e: platno.yview_scroll(-1, "units"))
    root.bind_all("<Button-5>", lambda e: platno.yview_scroll(1, "units"))

    radky = {}
    for k in sp.kontroly:
        r = tk.Frame(seznam, bg=B["surface"], padx=14, pady=10, highlightthickness=1, highlightbackground=B["border"])
        r.pack(fill="x", pady=(0, 7))
        tecka = tk.Canvas(r, width=12, height=12, bg=B["surface"], highlightthickness=0)
        tecka.create_oval(1, 1, 11, 11, fill=B["muted2"], outline="", tags="t")
        tecka.grid(row=0, column=0, rowspan=2, padx=(0, 12), sticky="n", pady=5)
        hlavni = tk.Frame(r, bg=B["surface"])
        hlavni.grid(row=0, column=1, sticky="we")
        tk.Label(hlavni, text=k["nazev"], font=F_JMENO, bg=B["surface"], fg=B["text"]).pack(side="left")
        stav_l = tk.Label(hlavni, text="", font=F_MONO, bg=B["surface"], fg=B["muted"], padx=10)
        stav_l.pack(side="left")
        cas_l = tk.Label(hlavni, text="", font=F_MONO, bg=B["surface"], fg=B["muted"])
        cas_l.pack(side="right")
        popis = tk.Label(r, text="", font=F_MALE, bg=B["surface"], fg=B["muted"], justify="left", anchor="w")
        popis.grid(row=1, column=1, sticky="we", pady=(3, 0))
        tl = tk.Frame(r, bg=B["surface"])
        tl.grid(row=0, column=2, rowspan=2, padx=(14, 0))
        r.columnconfigure(1, weight=1)
        r.bind("<Configure>", lambda e, p=popis: p.configure(wraplength=max(200, e.width - 330)))
        b_spust = tlacitko(tl, "Spustit", lambda kl=k["klic"]: sp.spust(kl), male=True)
        b_vypis = tlacitko(tl, "Výpis", lambda kk=k: ukaz_vypis(kk), male=True)
        b_okno = tlacitko(tl, "V okně", lambda kl=k["klic"]: sp.v_okne(kl), male=True)
        b_stop = tlacitko(tl, "Zastavit", lambda kl=k["klic"]: zastav_jednu(kl), male=True)
        b_prihl = tlacitko(tl, "Přihlásit v okně", lambda kl=k["klic"]: sp.v_okne(kl), hlavni=True, male=True)
        radky[k["klic"]] = dict(tecka=tecka, stav=stav_l, cas=cas_l, popis=popis, spust=b_spust, vypis=b_vypis,
                                okno=b_okno, stop=b_stop, prihl=b_prihl, posledni=None)

    def zastav_jednu(klic):
        sp.zastav(klic)

    tocit = "◐◓◑◒"

    def obnov():
        """Mění jen texty a barvy — okno se nepřestavuje, takže nebliká."""
        ted = time.time()
        for k in sp.kontroly:
            with sp.zamek:
                s = dict(sp.s(k["klic"]))
            st = s.get("stav")
            barva, popisek = STAVY.get(st, STAVY[None])
            if st in ("bezi", "okno"):
                popisek = "%s %s · %s" % (tocit[int(ted * 4) % 4], popisek, trvani(ted - (s.get("zacatek") or ted)))
            if k["rucni"] and st is None:
                popisek = "Ručně"
            if st in ("bezi", "ceka", "okno"):
                text, fg = s.get("radek") or "", B["text"]
            elif st in ("chyba", "prihlasit"):
                text, fg = s.get("zprava") or "", B[barva]
            else:
                text, fg = s.get("souhrn") or (k["rucni"] or ""), B["muted"]
                if st == "ok" and not s.get("poslano"):
                    text += "  (nic se neposlalo)"
            cas = ""
            if s.get("konec") and st not in ("bezi", "ceka", "okno"):
                cas = "%s · %s" % (kdy(s["konec"]), trvani(s.get("trvani")))
            if st == "ok" and s.get("posledni_ok") and ted - s["posledni_ok"] > 2 * 86400:
                barva = "warning"
            novy = (barva, popisek, text, fg, cas, st)
            r = radky[k["klic"]]
            if novy == r["posledni"]:
                continue
            r["posledni"] = novy
            r["tecka"].itemconfigure("t", fill=B[barva])
            r["stav"].configure(text=popisek, fg=B[barva] if st else B["muted2"])
            r["popis"].configure(text=text, fg=fg)
            r["cas"].configure(text=cas)
            bezi = st in ("bezi", "ceka", "okno")
            for nazev in ("spust", "okno", "stop", "prihl", "vypis"):
                r[nazev].pack_forget()
            if st in ("bezi", "ceka"):
                r["stop"].pack(side="left", padx=(6, 0))
            elif st == "prihlasit" and os.path.exists(k["bat"]):
                r["prihl"].pack(side="left", padx=(6, 0))
            elif not bezi:
                if not k["rucni"]:
                    r["spust"].pack(side="left", padx=(6, 0))
                if os.path.exists(k["bat"]):
                    r["okno"].pack(side="left", padx=(6, 0))
            if os.path.exists(os.path.join(k["slozka"], VYPIS)) and st not in ("okno", "rucne"):
                r["vypis"].pack(side="left", padx=(6, 0))
        sh = sp.souhrn()
        for klic, lbl in dlazdice.items():
            lbl.configure(text=str(sh[klic]))
        posl = sp.stav.get("posledni_vse")
        t = ("Všechny naposledy: %s · %s" % (kdy(posl), trvani(sp.stav.get("posledni_vse_trvani")))) \
            if posl else "Všechny ještě neběžely."
        info.configure(text=t + ("\n" + sp.info if sp.info and not sh["bezi"] else ""))
        vse_btn.configure(text="Zastavit vše" if sp.vse_bezi else "Spustit vše")
        if sh["bezi"]:
            root.title("MTKM kontroly — běží %d" % sh["bezi"])
        elif sh["chyba"] + sh["prihlasit"]:
            root.title("MTKM kontroly — ! %d chce pozornost" % (sh["chyba"] + sh["prihlasit"]))
        else:
            root.title("MTKM kontroly")
        if zamek is not None and ukazat["ano"]:
            ukazat["ano"] = False
            root.deiconify()
            root.lift()
        root.after(400, obnov)

    def spust_vse():
        if sp.vse_bezi:
            sp.zastav()
        else:
            sp.spust_vse()

    vypisy = {}

    def ukaz_vypis(k):
        if k["klic"] in vypisy and vypisy[k["klic"]].winfo_exists():
            vypisy[k["klic"]].lift()
            return
        t = tk.Toplevel(root, bg=B["bg"])
        vypisy[k["klic"]] = t
        t.title("Výpis — %s" % k["nazev"])
        t.geometry("820x560")
        horni = tk.Frame(t, bg=B["surface"], padx=14, pady=10)
        horni.pack(fill="x")
        tk.Label(horni, text=k["nazev"], font=F_JMENO, bg=B["surface"], fg=B["text"]).pack(side="left")
        tlacitko(horni, "Otevřít složku", lambda: os.startfile(k["slozka"]) if win else None, male=True).pack(side="right")
        txt = tk.Text(t, bg=B["bg"], fg=B["text"], font=F_MONO, bd=0, padx=14, pady=10, wrap="word",
                      insertbackground=B["text"], highlightthickness=0)
        txt.pack(fill="both", expand=True)
        txt.tag_configure("chyba", foreground=B["danger"])
        txt.tag_configure("hotovo", foreground=B["accent"])
        stav = {"velikost": -1}

        def nacti():
            if not t.winfo_exists():
                return
            cesta = os.path.join(k["slozka"], VYPIS)
            try:
                vel = os.path.getsize(cesta)
                if vel != stav["velikost"]:
                    stav["velikost"] = vel
                    with open(cesta, encoding="utf-8", errors="replace") as f:
                        obsah = f.read()
                    dole = txt.yview()[1] > 0.98
                    txt.configure(state="normal")
                    txt.delete("1.0", "end")
                    for r in obsah.splitlines(True):
                        tag = "chyba" if r.startswith("!!!") else ("hotovo" if "HOTOVO" in r or r.startswith("Posláno") else "")
                        txt.insert("end", r, tag)
                    txt.configure(state="disabled")
                    if dole or stav["velikost"] == vel and sp.bezi(k["klic"]):
                        txt.see("end")
            except OSError:
                pass
            t.after(700, nacti)
        nacti()

    def zavrit():
        if sp.bezi() and not messagebox.askyesno("MTKM kontroly", "Kontroly ještě běží. Zastavit je a zavřít okno?"):
            return
        sp.zastav()
        root.destroy()
    root.protocol("WM_DELETE_WINDOW", zavrit)

    ukazat = {"ano": False}
    if zamek is not None:
        def poslouchej():
            while True:
                try:
                    c, _ = zamek.accept()
                    c.close()
                    ukazat["ano"] = True
                except OSError:
                    return
        threading.Thread(target=poslouchej, daemon=True).start()

    if po_zapnuti:
        def hotovo(sh):
            if sh["chyba"] or sh["prihlasit"]:
                casti = []
                if sh["prihlasit"]:
                    casti.append("%d potřebuje přihlásit" % sh["prihlasit"])
                if sh["chyba"]:
                    casti.append("%d skončilo chybou" % sh["chyba"])
                oznameni("Kontroly doběhly", ", ".join(casti) + ". Otevři okno MTKM kontroly.")

        def start():
            sp.info = sp.po_zapnuti(hotovo) or ""
        threading.Thread(target=start, daemon=True).start()

    obnov()
    root.mainloop()


def main(argv):
    zamek = jediny()
    if zamek is None:
        return 0           # spouštěč už běží — ukáže se ten
    okno(Spoustec(), po_zapnuti="--po-zapnuti" in argv, zamek=zamek)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
