# -*- coding: utf-8 -*-
# Spouštěč kontrol — dvojklik otevře okno se všemi kontrolami (bez černého
# okna příkazové řádky). Všechno je ve spoustec.py vedle.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spoustec  # noqa: E402

sys.exit(spoustec.main(sys.argv[1:]))
