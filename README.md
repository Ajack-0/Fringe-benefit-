# Fringe benefit auto aziendali

Calcolo guidato del fringe benefit per auto (e moto) in uso promiscuo ai dipendenti
(art. 51 c. 4 lett. a Tuir), con confronto tra regime ante 2020, regime CO₂ (2020-2024)
e nuovo regime dal 2025 / Omnibus 2026. Sito statico: apri `index.html` (meglio via
`python3 -m http.server`, o GitHub Pages). I dati restano nel browser.

## Cosa copre
- Fringe benefit per dipendenti, amministratori e co.co.co. (uso promiscuo, personale, aziendale).
- Auto usata assegnata dopo il 2020: valore normale (canone meno indennità chilometrica ACI, Telefisco 2021).
- Passo "Costi e Iva" (facoltativo): fattura d'acquisto (Iva detraibile nell'anno, parte non detraibile nel costo e ammortamento automatico), canoni, altri costi, Iva a debito sul corrispettivo al dipendente.
- Deducibilità di imposte dirette e Iva per targa, con limiti di costo.

## Aggiornamento annuale
- **Tabelle ACI**: scheda *Aggiornamento annuale* → carica il PDF della Gazzetta Ufficiale
  (o CSV/JSON). Per renderle permanenti per tutti: `python3 tools/pdf_to_aci.py nuovo.pdf --anno 2027 --fonte "..."`
  (genera `data/aci/aci-2027.js` e aggiorna `data/aci/manifest.js`).
- **Regole fiscali**: stessa scheda, sezione 2 (versioni "dal anno X"). Default in `js/rules.js`.

## Test
`node --test tests/calc.test.mjs`

## Sicurezza
- Sito statico: nessun server, nessun PHP, nessuna dipendenza npm in produzione; i dati restano nel browser.
- Unica libreria di terze parti: pdf.js 4.10.38 (`vendor/pdfjs-4.10.38/`, licenza Apache 2.0), aggiornata
  per CVE-2024-4367 e usata con `isEvalSupported: false`.
- Content-Security-Policy: solo script del sito, niente eval né script inline.
- Backup e tabelle importati da file vengono validati; i CSV esportati neutralizzano le formule.
