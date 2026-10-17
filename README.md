# Fringe benefit auto aziendali

Calcolo guidato del fringe benefit per auto (e moto) in uso promiscuo ai dipendenti
(art. 51 c. 4 lett. a Tuir), con confronto tra regime ante 2020, regime CO₂ (2020-2024)
e nuovo regime dal 2025 / Omnibus 2026. Sito statico: apri `index.html` (meglio via
`python3 -m http.server`, o GitHub Pages). I dati restano nel browser.

## Cosa copre
- Fringe benefit per dipendenti, amministratori e co.co.co. (uso promiscuo, personale, aziendale).
- Auto usata assegnata dopo il 2020: valore normale (canone meno indennità chilometrica ACI, Telefisco 2021).
- Deducibilità di imposte dirette e Iva per targa, con importi se si indicano costi e Iva.

## Aggiornamento annuale
- **Tabelle ACI**: scheda *Aggiornamento annuale* → carica il PDF della Gazzetta Ufficiale
  (o CSV/JSON). Per renderle permanenti per tutti: `python3 tools/pdf_to_aci.py nuovo.pdf --anno 2027 --fonte "..."`
  (genera `data/aci/aci-2027.js` e aggiorna `data/aci/manifest.js`).
- **Regole fiscali**: stessa scheda, sezione 2 (versioni "dal anno X"). Default in `js/rules.js`.

## Test
`node --test tests/calc.test.mjs`
