# -*- coding: utf-8 -*-
# Spouštěč kontrol — dvojklik ho pustí na pozadí (bez černého okna)
# a otevře aplikaci SKLAD na okně Kontroly listingů, odkud se kontroly
# spouštějí. Všechno je ve spoustec.py vedle.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spoustec  # noqa: E402

sys.exit(spoustec.main(sys.argv[1:]))
