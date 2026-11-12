# -*- coding: utf-8 -*-
"""
WTB Market kontrola pro MTKM.Store (Gabro).

WTB pinger nemá stránku ani API: zkopíruj (Ctrl+C) celý text, jak máš
pinger nahozený — „(0) název velikost, (1) název velikost, …" — a spusť
SPUSTIT_wtb.bat. Skript text vezme ze schránky (nebo ze souboru
pinger.txt vedle sebe, když ho tam uložíš), porovná se skladem z cloudu
a pošle Report do aplikace SKLAD. Pravidla jsou ze skillu „wtb-kontrola"
(zůstává jako záloha).

- Velikosti se NIKDY neřeší jako chyba (37 = 37 1/3, S = S/M) — Gabro
  listuje schválně šířeji. Sekce Opravit u WTB není.
- WTB Market není ve SKLADu platforma: fajfky se neposílají. Report do
  aplikace jde, až bude „WTB Market" v Nastavení → místa prodeje
  (aplikace bere jen místa z nastavení); do té doby se výsledek jen vypíše.
- U Smazat je číslo z pingeru (#12) — podle něj mažeš.

V repozitáři: nastroje/wtb/wtb_kontrola.py, hlídá to test/test-kontrolyprohlizec.js.
"""
import sys, os, re, json, time, traceback, unicodedata, subprocess

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "WTB Market"
SOUBOR = os.path.join(SLOZKA, "pinger.txt")
VYSTUP = os.path.join(SLOZKA, "vysledek_wtb.json")
EXC = ("Zrušeno", "Vráceno", "Poškozené")
STOP = {"x", "the", "retro", "og", "nike", "adidas", "air", "a", "and", "w", "wmns", "womens", "gs"}
VEL = r"(\d{2}(?:[.,]\d+)?(?:\s?[12]/3)?(?:-\d{2})?|XXS|XS|S|M|L|XL|XXL|XXXL|[SML]/[SMLX]+|L/XL|OS|ONE SIZE)"


def schranka():
    try:
        p = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"], capture_output=True, timeout=10)
        return p.stdout.decode("utf-8", "replace")
    except Exception:
        try:
            import tkinter
            t = tkinter.Tk(); t.withdraw()
            v = t.clipboard_get(); t.destroy()
            return v
        except Exception:
            return ""


def rozeber(text):
    """(číslo) název velikost — oddělené čárkou nebo novým řádkem."""
    out = []
    for m in re.finditer(r"\((\d+)\)\s*(.+?)(?=\s*,?\s*\(\d+\)|\s*$)", (text or "").replace("\n", " "), re.S):
        cast = m.group(2).strip().rstrip(",").strip()
        v = re.search(r"\s" + VEL + r"$", cast, re.I)
        nazev, vel = (cast[:v.start()].strip(), v.group(1).strip()) if v else (cast, "")
        out.append({"cislo": int(m.group(1)), "nazev": nazev, "velikost": vel})
    return out


def slova(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("air jordan", "jordan")
    return {t for t in re.sub(r"[^a-z0-9]+", " ", s).split() if t not in STOP}


def obsazeni(wtb, sklad):
    """Kolik slov (zkráceného) názvu z pingeru je v názvu ve SKLADu."""
    A, B = slova(wtb), slova(sklad)
    return len(A & B) / len(A) if A else 0.0


def vel_sedi(w, s):
    """Rozdíl ve velikosti není nikdy chyba: 37 = 37 1/3, S = S/M, L = L/XL."""
    a = str(w or "").upper().replace(",", ".").replace(" ", "")
    b = str(s or "").upper().replace(",", ".").replace(" ", "")
    if not a or a == b:
        return True
    ca, cb = re.match(r"\d+", a), re.match(r"\d+", b)
    if ca and cb:
        return ca.group(0) == cb.group(0)
    return a in b.split("/") or b in a.split("/")


def vyhodnot(pinger, polozky):
    sklad = [x for x in polozky if x and x.get("type") != "bulk" and S.stav(x) == "stock" and x.get("category") in ("sneakers", "obleceni")
             and x.get("condition") != "poskozene" and x.get("location") not in EXC]
    pouzite, smazat = set(), []
    for p in pinger:
        kand = [(obsazeni(p["nazev"], x.get("name")), x) for x in sklad if vel_sedi(p["velikost"], x.get("size"))]
        kand = [k for k in kand if k[0] >= 0.75]
        if kand:
            x = max(kand, key=lambda k: k[0])[1]
            pouzite.add((x.get("name"), x.get("size")))
        else:
            smazat.append({"nazev": "%s %s" % (p["nazev"], p["velikost"]), "velikost": p["velikost"], "cislo": p["cislo"],
                           "duvod": "#%d" % p["cislo"], "ids": []})
    pridat, videno = [], set()
    for x in sklad:
        k = (x.get("name"), x.get("size"))
        if k in pouzite or k in videno:
            continue
        if any(obsazeni(p["nazev"], x.get("name")) >= 0.75 and vel_sedi(p["velikost"], x.get("size")) for p in pinger):
            continue
        videno.add(k)
        pridat.append({"nazev": x.get("name"), "velikost": x.get("size") or "", "sku": x.get("sku") or "", "ids": [x["id"]], "duvod": ""})
    return {"smazat": sorted(smazat, key=lambda x: x["cislo"]), "pridat": pridat, "pinger": len(pinger)}


def sestav_report(r, datum):
    return {"misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola WTB Market", "datum": datum,
            "souhrn": [f"Na pingeru: {r['pinger']}"],
            "sekce": [
                {"nazev": "Smazat z pingeru", "barva": "smazat",
                 "poznamka": "Čísla k smazání: " + ", ".join(str(x["cislo"]) for x in r["smazat"]) if r["smazat"] else "",
                 "radky": [{"nazev": x["nazev"], "velikost": "", "duvod": x["duvod"]} for x in r["smazat"]]},
                {"nazev": "Přidat na pinger", "barva": "pridat", "hromadne": True,
                 "radky": [{"nazev": x["nazev"], "velikost": x["velikost"], "sku": x["sku"], "ids": x["ids"]} for x in r["pridat"]]},
            ]}


def main(argv):
    start = time.time()
    text = open(SOUBOR, encoding="utf-8").read() if os.path.exists(SOUBOR) and "--schranka" not in argv else schranka()
    pinger = rozeber(text)
    if not pinger:
        raise RuntimeError("Ve schránce (ani v pinger.txt) není text pingeru ve tvaru „(0) název velikost, (1) …“. "
                           "Zkopíruj ho a spusť znovu.")
    print(f"Pinger: {len(pinger)} položek")
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    r = vyhodnot(pinger, polozky)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    for x in r["smazat"]:
        print(f"  SMAZAT   #{x['cislo']}  {x['nazev']}")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}")
    print("\n================ HOTOVO ================")
    print(f"WTB: smazat {len(r['smazat'])} | přidat {len(r['pridat'])}")
    print(f"Trvalo {int(time.time() - start)} s.")
    rep = sestav_report(r, datum)
    if MISTO in S.mista_prodeje(data):
        S.dokonci_kontrolu(token, data, polozky, [], rep, dict(
            misto=MISTO, datum=datum, chybi=[x["ids"][0] for x in r["pridat"]],
            neni_ve_skladu=[{"nazev": x["nazev"], "velikost": "", "odkaz": ""} for x in r["smazat"]]), argv)
        return
    # Aplikace bere jen místa z nastavení (report i kontrola) — bez toho se jen vypíše
    print("\nWTB Market není v nastavení míst prodeje, takže do aplikace SKLAD. se nic neposílá.")
    print("Výsledek máš výš. Když chceš report i v aplikaci: Nastavení → místa prodeje → přidej „WTB Market“.")

if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_wtb.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_wtb.txt. Pošli screenshot Claudovi.")
