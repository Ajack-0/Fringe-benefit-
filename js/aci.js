/*
 * Tabelle nazionali ACI dei costi chilometrici (Gazzetta Ufficiale, "Fringe benefit AAAA").
 *
 * - Le tabelle integrate sono file data/aci/aci-AAAA.js elencati in data/aci/manifest.js.
 * - Le tabelle importate dal browser (PDF della G.U., CSV, JSON) sono salvate in IndexedDB
 *   e hanno la precedenza sulle integrate dello stesso anno.
 * - Formato di un dataset: { anno, fonte, km, campi:[id,marca,modello,alim,sotto,prod,ck], righe:[[...]] }
 */
(function (root) {
  'use strict';

  const ALIM_ACI = ['benzina', 'gasolio', 'gpl-metano', 'ibrido-benzina', 'ibrido-gasolio', 'plug-in', 'elettrico', 'autocaravan', 'moto'];
  const ALIM_ETICHETTE = {
    'benzina': 'Benzina', 'gasolio': 'Gasolio', 'gpl-metano': 'GPL / metano', 'ibrido-benzina': 'Ibrido benzina',
    'ibrido-gasolio': 'Ibrido gasolio', 'plug-in': 'Ibrido plug-in', 'elettrico': 'Elettrico', 'autocaravan': 'Autocaravan', 'moto': 'Moto / ciclomotori',
  };

  const datasets = {}; // anno -> { ...dataset, origine: 'integrata' | 'importata' }

  // ---------- caricamento ----------
  function caricaScript(src) {
    return new Promise((ok) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => ok(true); s.onerror = () => ok(false);
      document.head.appendChild(s);
    });
  }

  async function init() {
    const anni = root.ACI_MANIFEST || [];
    root.ACI_DATASETS = root.ACI_DATASETS || {};
    await Promise.all(anni.map((a) => caricaScript(`data/aci/aci-${a}.js`)));
    for (const [a, d] of Object.entries(root.ACI_DATASETS)) datasets[a] = { ...d, origine: 'integrata' };
    try {
      for (const d of await idbTutti()) datasets[d.anno] = { ...d, origine: 'importata' };
    } catch (e) { /* IndexedDB non disponibile: si usano solo le tabelle integrate */ }
  }

  // ---------- IndexedDB ----------
  function idb() {
    return new Promise((ok, ko) => {
      const rq = indexedDB.open('fringe-benefit', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('aci', { keyPath: 'anno' });
      rq.onsuccess = () => ok(rq.result);
      rq.onerror = () => ko(rq.error);
    });
  }
  async function idbOp(modo, fn) {
    const db = await idb();
    return new Promise((ok, ko) => {
      const tx = db.transaction('aci', modo);
      const rq = fn(tx.objectStore('aci'));
      tx.oncomplete = () => ok(rq && rq.result);
      tx.onerror = () => ko(tx.error);
    });
  }
  const idbTutti = () => idbOp('readonly', (s) => s.getAll());
  async function salvaImportata(d) { await idbOp('readwrite', (s) => s.put(d)); datasets[d.anno] = { ...d, origine: 'importata' }; }
  async function eliminaImportata(a) {
    await idbOp('readwrite', (s) => s.delete(Number(a)));
    delete datasets[a];
    const integrata = root.ACI_DATASETS && root.ACI_DATASETS[a];
    if (integrata) datasets[a] = { ...integrata, origine: 'integrata' };
  }

  // ---------- accesso ai dati ----------
  const anni = () => Object.keys(datasets).map(Number).sort((a, b) => a - b);
  const get = (a) => datasets[a] || null;
  const riga = (r) => ({ id: r[0], marca: r[1], modello: r[2], alim: r[3], sotto: r[4], prod: r[5] === 1, ck: r[6] });

  const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /** Ricerca per testo (tutte le parole devono comparire in marca+modello) e filtri. */
  function cerca(a, { testo = '', alim = null, soloInProduzione = false, limite = 60 } = {}) {
    const d = datasets[a];
    if (!d) return { totale: 0, righe: [] };
    const parole = norm(testo).split(/[\s,]+/).filter(Boolean);
    const out = [];
    let totale = 0;
    for (const r of d.righe) {
      if (alim && !alim.includes(r[3])) continue;
      if (soloInProduzione && r[5] !== 1) continue;
      if (parole.length) {
        const hay = norm(`${r[1]} ${r[2]}`);
        if (!parole.every((p) => hay.includes(p))) continue;
      }
      totale++;
      if (out.length < limite) out.push(riga(r));
    }
    return { totale, righe: out };
  }

  /** Chiave stabile di un modello: l'ID ACI, oppure marca|modello se la tabella non riporta l'ID. */
  const chiave = (r) => (r.id != null ? String(r.id) : `${r.marca}|${r.modello}`);

  function perChiave(a, k) {
    const d = datasets[a];
    if (!d || !k) return null;
    const r = d.righe.find((x) => (x[0] != null ? String(x[0]) : `${x[1]}|${x[2]}`) === k);
    return r ? riga(r) : null;
  }

  // ---------- parser del testo del PDF (stessa logica di tools/pdf_to_aci.py) ----------
  const NUM = '\\d{1,3}(?:\\.\\d{3})*,\\d{2}';
  const ROW = new RegExp(`^(.+?)\\s+(\\d,\\d{4})\\s+((?:${NUM}\\s*)+)$`);
  const SEZIONI = [
    ['AUTOVEICOLI A BENZINA-GPL', 'gpl-metano'], ['AUTOVEICOLI A BENZINA', 'benzina'], ['AUTOVEICOLI A GASOLIO', 'gasolio'],
    ['AUTOVEICOLI IBRIDO-BENZINA', 'ibrido-benzina'], ['AUTOVEICOLI IBRIDO-GASOLIO', 'ibrido-gasolio'],
    ['AUTOVEICOLI IBRIDI PLUG-IN', 'plug-in'], ['AUTOVEICOLI ELETTRICI', 'elettrico'], ['AUTOCARAVAN', 'autocaravan'], ['MOTOVEICOLI', 'moto'],
  ];
  const SOTTO = ['PLUG-IN BENZINA', 'PLUG-IN GASOLIO', 'CICLOMOTORI', 'MOTOCICLI', 'SCOOTER'];
  const numIt = (s) => parseFloat(s.replace(/\./g, '').replace(',', '.'));

  function parseTesto(testo) {
    const righe = [], anomalie = [];
    let alim = null, prod = true, sotto = '', pcts = [];
    for (const raw of testo.split(/\r?\n/)) {
      const riga = raw.replace(/\u00c3\u001f/g, '\u00c9').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
      if (!riga) continue;
      const up = riga.toUpperCase();
      const sez = SEZIONI.find(([t]) => up.startsWith(t) && !up.includes('FRINGE'));
      if (sez) { alim = sez[1]; sotto = ''; prod = !up.includes('FUORI PRODUZIONE'); continue; }
      if (SOTTO.includes(riga)) { sotto = riga; continue; }
      const pc = [...riga.matchAll(/\((\d+)% CK\)/g)].map((m) => Number(m[1]));
      if (pc.length) { pcts = pc; continue; }
      const m = ROW.exec(riga);
      if (!m || !alim) continue;
      const parti = m[1].trim().split(/\s{2,}/);
      let id = null;
      if (/^\d{4,6}$/.test(parti[0])) id = Number(parti.shift());
      let marca = '', modello = '';
      if (parti.length === 2) [marca, modello] = parti;
      else if (parti.length === 1) modello = parti[0];
      else { marca = parti[0]; modello = parti.slice(1).join(' '); }
      const ck = parseFloat(m[2].replace(',', '.'));
      const vals = [...m[3].matchAll(new RegExp(NUM, 'g'))].map((x) => numIt(x[0]));
      for (let i = 0; i < Math.min(pcts.length, vals.length); i++) {
        if (Math.abs(ck * 15000 * pcts[i] / 100 - vals[i]) > 0.6) { anomalie.push(`importo non coerente (${pcts[i]}%): ${riga}`); break; }
      }
      righe.push({ id, marca, modello, alim, sotto, prod, ck });
    }
    const marche = [...new Set(righe.map((r) => r.marca).filter(Boolean).concat(['GREAT WALL']))].sort((a, b) => b.length - a.length);
    for (const r of righe) {
      if (r.marca) continue;
      const mk = marche.find((x) => r.modello.startsWith(x + ' '));
      if (mk) { r.modello = r.modello.slice(mk.length + 1).trim(); r.marca = mk; }
      else { const i = r.modello.indexOf(' '); anomalie.push(`marca dedotta: ${r.modello}`); r.marca = r.modello.slice(0, i); r.modello = r.modello.slice(i + 1); }
    }
    return { righe, anomalie };
  }

  /** Estrae il testo dal PDF con pdf.js, ricostruendo le righe e le colonne (>=3 spazi tra celle). */
  async function testoDaPdf(buffer, onProgress) {
    const pdfjs = root.pdfjsLib;
    if (!pdfjs) throw new Error('Libreria pdf.js non caricata.');
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      const linee = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = it.transform[5];
        let l = linee.find((x) => Math.abs(x.y - y) < 2.5);
        if (!l) { l = { y, items: [] }; linee.push(l); }
        l.items.push({ x: it.transform[4], w: it.width, s: it.str });
      }
      linee.sort((a, b) => b.y - a.y);
      for (const l of linee) {
        l.items.sort((a, b) => a.x - b.x);
        let t = '', fine = null;
        for (const it of l.items) {
          if (fine != null) t += (it.x - fine > 6 ? '   ' : ' ');
          t += it.s.trim(); fine = it.x + it.w;
        }
        out.push(t);
      }
      if (onProgress) onProgress(p, pdf.numPages);
    }
    return out.join('\n');
  }

  // ---------- CSV / JSON ----------
  function parseCsv(testo) {
    const righe = [], anomalie = [];
    const linee = testo.split(/\r?\n/).filter((l) => l.trim());
    if (!linee.length) return { righe, anomalie: ['File vuoto'] };
    const sep = linee[0].includes(';') ? ';' : ',';
    const intest = linee[0].split(sep).map((x) => x.trim().toLowerCase());
    const col = (nomi) => intest.findIndex((x) => nomi.includes(x));
    const iId = col(['id', 'id modello']), iMa = col(['marca']), iMo = col(['modello']), iAl = col(['alimentazione', 'alim']), iCk = col(['costo_km', 'costo km', 'ck']), iPr = col(['in_produzione', 'prod']);
    if ([iMa, iMo, iAl, iCk].some((i) => i < 0)) return { righe, anomalie: ['Intestazioni attese: id;marca;modello;alimentazione;costo_km;in_produzione'] };
    linee.slice(1).forEach((l, n) => {
      const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
      const ck = parseFloat(String(c[iCk]).replace(',', '.'));
      const alim = c[iAl].toLowerCase();
      if (!(ck > 0) || !ALIM_ACI.includes(alim)) { anomalie.push(`riga ${n + 2}: costo km o alimentazione non validi (${alim})`); return; }
      righe.push({ id: iId >= 0 && c[iId] ? Number(c[iId]) : null, marca: c[iMa], modello: c[iMo], alim, sotto: '', prod: iPr < 0 || !/^(0|no|fuori)/i.test(c[iPr] || '1'), ck });
    });
    return { righe, anomalie };
  }

  function creaDataset(anno, fonte, righe) {
    return {
      anno: Number(anno), fonte: fonte || '', km: 15000,
      campi: ['id', 'marca', 'modello', 'alim', 'sotto', 'prod', 'ck'],
      righe: righe.map((r) => [r.id, r.marca, r.modello, r.alim, r.sotto || '', r.prod ? 1 : 0, r.ck]),
    };
  }

  const esportaJs = (d) => `(window.ACI_DATASETS = window.ACI_DATASETS || {})[${d.anno}] = ${JSON.stringify({ anno: d.anno, fonte: d.fonte, km: d.km, campi: d.campi, righe: d.righe })};\n`;
  const esportaCsv = (d) => ['id;marca;modello;alimentazione;costo_km;in_produzione',
    ...d.righe.map((r) => [r[0] ?? '', r[1], r[2], r[3], String(r[6]).replace('.', ','), r[5]].join(';'))].join('\n');

  root.ACI = { ALIM_ACI, ALIM_ETICHETTE, init, anni, get, cerca, chiave, perChiave, parseTesto, testoDaPdf, parseCsv, creaDataset, salvaImportata, eliminaImportata, esportaJs, esportaCsv };
})(window);
