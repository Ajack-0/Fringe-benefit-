#!/usr/bin/env python3
"""Converte il PDF delle tabelle ACI (Gazzetta Ufficiale, "Fringe benefit AAAA")
nel file dati usato dall'app: data/aci/aci-AAAA.js (+ .json).

Uso:
    python3 tools/pdf_to_aci.py tabelle-aci-2027.pdf --anno 2027 \
        --fonte "G.U. n. 2xx del 2x-12-2027, S.O. n. xx"

Richiede `pdftotext` (poppler-utils). Il parser legge le righe dal fondo
(costo km + importi) e divide il resto in ID / marca / modello.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

NUM = r"\d{1,3}(?:\.\d{3})*,\d{2}"
ROW = re.compile(rf"^(?P<left>.+?)\s+(?P<ck>\d,\d{{4}})\s+(?P<vals>(?:{NUM}\s*)+)$")
PCT = re.compile(r"\((\d+)% CK\)")

# titolo sezione -> (alimentazione, in produzione)
SEZIONI = [
    ("AUTOVEICOLI A BENZINA-GPL", "gpl-metano"),
    ("AUTOVEICOLI A BENZINA", "benzina"),
    ("AUTOVEICOLI A GASOLIO", "gasolio"),
    ("AUTOVEICOLI IBRIDO-BENZINA", "ibrido-benzina"),
    ("AUTOVEICOLI IBRIDO-GASOLIO", "ibrido-gasolio"),
    ("AUTOVEICOLI IBRIDI PLUG-IN", "plug-in"),
    ("AUTOVEICOLI ELETTRICI", "elettrico"),
    ("AUTOCARAVAN", "autocaravan"),
    ("MOTOVEICOLI", "moto"),
]
SOTTO = {"PLUG-IN BENZINA", "PLUG-IN GASOLIO", "CICLOMOTORI", "MOTOCICLI", "SCOOTER"}


def num_it(s):
    return float(s.replace(".", "").replace(",", "."))


def parse(testo):
    righe, alim, prod, sotto, pcts = [], None, True, "", []
    anomalie = []
    for raw in testo.splitlines():
        riga = raw.strip()
        if not riga:
            continue
        up = riga.upper()
        for titolo, a in SEZIONI:
            if up.startswith(titolo) and "FRINGE" not in up:
                alim, sotto = a, ""
                prod = "FUORI PRODUZIONE" not in up
                break
        else:
            if riga in SOTTO:
                sotto = riga
                continue
            m = PCT.findall(riga)
            if m:
                pcts = [int(x) for x in m]
                continue
            m = ROW.match(riga)
            if not m or alim is None:
                continue
            parti = re.split(r"\s{2,}", m["left"].strip())
            idm = None
            if re.fullmatch(r"\d{4,6}", parti[0]):
                idm = int(parti.pop(0))
            if len(parti) == 2:
                marca, modello = parti
            elif len(parti) == 1:
                marca, modello = "", parti[0]  # risolto nel secondo passaggio
            else:
                marca, modello = parti[0], " ".join(parti[1:])
            ck = float(m["ck"].replace(",", "."))
            vals = [num_it(v) for v in re.findall(NUM, m["vals"])]
            # controllo di coerenza: importo = ck*15000*pct
            for p, v in zip(pcts, vals):
                atteso = ck * 15000 * p / 100
                if abs(atteso - v) > 0.6:
                    anomalie.append(f"incoerente {p}%: {riga}")
                    break
            righe.append({
                "id": idm, "marca": marca, "modello": modello,
                "alim": alim, "sotto": sotto, "prod": prod, "ck": ck,
            })
    # secondo passaggio: marca e modello separati da un solo spazio
    marche = sorted({r["marca"] for r in righe if r["marca"]} | {"GREAT WALL"}, key=len, reverse=True)
    for r in righe:
        if r["marca"]:
            continue
        for mk in marche:
            if r["modello"].startswith(mk + " "):
                r["marca"], r["modello"] = mk, r["modello"][len(mk) + 1:].strip()
                break
        else:
            primo, _, resto = r["modello"].partition(" ")
            r["marca"], r["modello"] = primo, resto
            anomalie.append(f"marca dedotta '{primo}': {resto}")
    return righe, anomalie


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--anno", type=int, required=True)
    ap.add_argument("--fonte", default="")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "aci"))
    a = ap.parse_args()

    testo = subprocess.run(["pdftotext", "-layout", a.pdf, "-"], capture_output=True, text=True, check=True).stdout
    righe, anomalie = parse(testo)
    if not righe:
        sys.exit("Nessuna riga riconosciuta: il formato del PDF e' cambiato?")
    dati = {
        "anno": a.anno,
        "fonte": a.fonte,
        "km": 15000,
        # colonne: id, marca, modello, alimentazione, sottotipo, in produzione (1/0), costo km
        "campi": ["id", "marca", "modello", "alim", "sotto", "prod", "ck"],
        "righe": [[r["id"], r["marca"], r["modello"], r["alim"], r["sotto"], 1 if r["prod"] else 0, r["ck"]] for r in righe],
    }
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    js = json.dumps(dati, ensure_ascii=False, separators=(",", ":"))
    (out / f"aci-{a.anno}.json").write_text(js, encoding="utf-8")
    (out / f"aci-{a.anno}.js").write_text(
        f"(window.ACI_DATASETS = window.ACI_DATASETS || {{}})[{a.anno}] = {js};\n", encoding="utf-8")
    # aggiorna l'elenco degli anni caricati dall'app
    man = out / "manifest.js"
    anni = sorted({int(x) for x in re.findall(r"\d{4}", man.read_text())} | {a.anno}) if man.exists() else [a.anno]
    man.write_text(f"window.ACI_MANIFEST = {json.dumps(anni)};\n", encoding="utf-8")
    print(f"{len(righe)} modelli scritti in {out}/aci-{a.anno}.js (anni in manifest: {anni})")
    if anomalie:
        print(f"ATTENZIONE: {len(anomalie)} righe da controllare:")
        for x in anomalie[:30]:
            print("  ", x)


if __name__ == "__main__":
    main()
