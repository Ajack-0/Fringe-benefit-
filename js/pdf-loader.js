// Carica pdf.js (modulo ES, versione 4.10.38: corregge CVE-2024-4367) e lo espone a js/aci.js.
// Serve solo per leggere il PDF della Gazzetta Ufficiale nella scheda "Aggiornamento annuale".
import * as pdfjsLib from '../vendor/pdfjs-4.10.38/pdf.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-4.10.38/pdf.worker.min.js';
window.pdfjsLib = pdfjsLib;
