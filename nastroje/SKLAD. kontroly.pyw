# -*- coding: utf-8 -*-
# SKLAD. kontroly — dvojklik ho pustí na pozadí (bez černého okna)
# a otevře aplikaci SKLAD na okně Kontroly listingů, odkud se kontroly
# spouštějí. Všechno je ve spoustec.py vedle.
#
# .pyw běží bez konzole, takže pád by nebyl vidět vůbec (majitel 13. 11.
# 2026: „nejde spustit"). Každá chyba — i tvrdý pád celého Pythonu —
# se proto zapíše do chyba_spoustece.txt v téhle složce (leží na Disku,
# Claude si ho přečte) a ukáže se hláška.
import os, sys, traceback
SLOZKA = os.path.dirname(os.path.abspath(__file__))
CHYBA = os.path.join(SLOZKA, "chyba_spoustece.txt")
_pad = None
try:
    os.remove(CHYBA)                   # stará chyba z minula už neplatí
except OSError:
    pass
try:
    import faulthandler
    _pad = open(CHYBA + ".pad", "w", encoding="utf-8")
    faulthandler.enable(_pad)          # tvrdý pád (access violation) taky
except Exception:
    pass


def _ohlas(text):
    try:
        with open(CHYBA, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        pass
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, "SKLAD. kontroly se nespustily.\n\n" + text.strip().splitlines()[-1]
                                         + "\n\nPodrobnosti jsou v chyba_spoustece.txt ve složce MTKM-kontroly — pošli je Claudovi.",
                                         "SKLAD. kontroly", 0x10)
    except Exception:
        pass


try:
    sys.path.insert(0, SLOZKA)
    # Disk Google stahuje nové verze s pár minutami zpoždění — po aktualizaci
    # chvíli chyběl spoustec.py a program spadl (13. 11. 2026). Počká se.
    import time
    for _ in range(90):
        if all(os.path.exists(os.path.join(SLOZKA, f)) for f in ("spoustec.py", "sklad_firestore.py")):
            break
        time.sleep(2)
    else:
        raise RuntimeError("Ve složce MTKM-kontroly chybí spoustec.py nebo sklad_firestore.py — Disk Google je "
                           "asi ještě nestáhl. Počkej pár minut a spusť znovu.")
    import spoustec  # noqa: E402
    kod = spoustec.main(sys.argv[1:])
except SystemExit:
    raise
except BaseException:
    _ohlas(traceback.format_exc())
    kod = 1
finally:
    try:
        faulthandler.disable()
        _pad.close()
        if os.path.getsize(CHYBA + ".pad") == 0:
            os.remove(CHYBA + ".pad")      # prázdný = žádný tvrdý pád
    except Exception:
        pass
sys.exit(kod)
