import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const FB = createRequire(import.meta.url)('../js/rules.js');
const R = FB.REGOLE_DEFAULT;
const base = { anno: 2026, alim: 'benzina', categoria: 'autovettura', inizio: '', fine: '', trattenuta: 0, accessori: false };

test('BEV assegnata nel 2025: 0,4421 × 15.000 × 10% = 663,15', () => {
  const r = FB.calcolaRegime('nuovo', { ...base, anno: 2025, alim: 'elettrico', ck: 0.4421, dataImmatricolazione: '2025-01-10' }, R);
  assert.equal(r.valoreAnnuo, 663.15);
});

test('Stelvio 2026 al 60%: 8.316,00 come nella tabella ACI', () => {
  const r = FB.calcolaRegime('co2', { ...base, ck: 0.924, co2: 267, dataImmatricolazione: '2024-01-01' }, R);
  assert.equal(r.perc, 60); assert.equal(r.valoreAnnuo, 8316);
});

test('Esempio: 0,5063 al 30% = 2.278,35; dal 2026 +50% = 3.417,53 (veicolo 2020)', () => {
  const inp = { ...base, ck: 0.5063, co2: 120, dataImmatricolazione: '2020-09-15', dataContratto: '2020-12-01' };
  assert.equal(FB.calcolaRegime('co2', { ...inp, anno: 2025 }, R).valoreAnnuo, 2278.35);
  const r26 = FB.calcolaRegime('co2', inp, R);
  assert.equal(r26.valoreAnnuo, 3417.53);
  assert.deepEqual(r26.maggiorazioni, ['anzianita']);
});

test('Maggiorazione anzianità: immatricolata 2021 → scatta dal 2027, non nel 2026', () => {
  const inp = { ...base, ck: 0.5, alim: 'benzina', dataImmatricolazione: '2021-03-01' };
  assert.deepEqual(FB.calcolaRegime('nuovo', inp, R).maggiorazioni, []);
  const rr = [...R, { ...R[1], dal: 2027 }];
  assert.deepEqual(FB.calcolaRegime('nuovo', { ...inp, anno: 2027 }, rr).maggiorazioni, ['anzianita']);
});

test('Anzianità non attiva nel 2025 e mai per il regime ante 2020', () => {
  const inp = { ...base, ck: 0.5, dataImmatricolazione: '2015-01-01' };
  assert.deepEqual(FB.calcolaRegime('nuovo', { ...inp, anno: 2025 }, R).maggiorazioni, []);
  assert.deepEqual(FB.calcolaRegime('pre2020', inp, R).maggiorazioni, []);
});

test('Accessori +5% solo nel nuovo regime dal 2026', () => {
  const inp = { ...base, ck: 0.6, accessori: true, dataImmatricolazione: '2025-05-01' };
  const r = FB.calcolaRegime('nuovo', inp, R);
  assert.equal(r.valoreAnnuo, FB.r2(4500 * 1.05)); // 0,6*15000*50% = 4.500
  assert.equal(FB.calcolaRegime('co2', { ...inp, co2: 100 }, R).maggiorazioni.includes('accessori'), false);
});

test('Soglie CO2: 60→25%, 61→30%, 160→30%, 161→50%, 190→50%, 191→60%', () => {
  const p = (co2) => FB.calcolaRegime('co2', { ...base, ck: 0.5, co2, dataImmatricolazione: '2025-01-01' }, R).perc;
  assert.deepEqual([60, 61, 160, 161, 190, 191].map(p), [25, 30, 30, 50, 50, 60]);
});

test('Percentuali nuovo regime: BEV 10, plug-in 20, altri 50', () => {
  const p = (alim) => FB.calcolaRegime('nuovo', { ...base, ck: 0.5, alim, dataImmatricolazione: '2025-01-01' }, R).perc;
  assert.deepEqual(['elettrico', 'plugin', 'benzina', 'gasolio', 'ibrido'].map(p), [10, 20, 50, 50, 50]);
});

test('Ragguaglio ai giorni (2026: 365) e trattenuta', () => {
  const r = FB.calcolaRegime('nuovo', { ...base, ck: 0.5, inizio: '2026-07-01', fine: '', trattenuta: 100, dataImmatricolazione: '2026-06-01' }, R);
  assert.equal(r.giorni, 184); assert.equal(r.valoreAnnuo, 3750);
  assert.equal(r.proRata, FB.r2(3750 * 184 / 365));
  assert.equal(r.imponibile, FB.r2(3750 * 184 / 365 - 100));
});

test('Anno bisestile 2024 = 366 giorni', () => assert.equal(FB.giorniNellAnno(2024), 366));

test('Trattenuta superiore al fringe: imponibile 0', () => {
  const r = FB.calcolaRegime('nuovo', { ...base, ck: 0.3, alim: 'elettrico', trattenuta: 5000, dataImmatricolazione: '2026-01-01' }, R);
  assert.equal(r.imponibile, 0);
});

test('Regime: date spartiacque', () => {
  const k = (c, o) => FB.determinaRegime({ dataContratto: c, dataOrdine: o }).chiave;
  assert.equal(k('2020-06-30'), 'pre2020');
  assert.equal(k('2020-07-01'), 'co2');
  assert.equal(k('2024-12-31'), 'co2');
  assert.equal(k('2025-01-01'), 'nuovo');
  assert.equal(k('2025-03-01', '2024-11-20'), 'co2');   // ordinata entro il 31.12.2024, concessa nel 2025
  assert.equal(k('2025-03-01', '2025-01-05'), 'nuovo');
  assert.equal(k('2026-03-01', '2024-11-20'), 'nuovo'); // concessa nel 2026: l'ordine non conta
});

test('Calcola(): mezzo non forfettizzabile e CO2 mancante', () => {
  assert.ok(FB.calcola({ ...base, categoria: 'altro', dataContratto: '2025-01-01', ck: 0.5 }, R).errore);
  const r = FB.calcola({ ...base, ck: 0.5, dataContratto: '2022-01-01', co2: '', dataImmatricolazione: '2022-01-01' }, R);
  assert.ok(r.errore && /CO/.test(r.errore));
});

test('Confronto: tre regimi sugli stessi dati', () => {
  const r = FB.calcola({ ...base, ck: 0.5, co2: 100, dataContratto: '2022-01-01', dataImmatricolazione: '2022-01-01' }, R);
  assert.equal(r.regime.chiave, 'co2');
  assert.deepEqual(r.confronto.map((c) => c.applicabile), [false, true, false]);
  assert.deepEqual(r.confronto.map((c) => c.valoreAnnuo), [2250, 2250, 3750]);
});

test('Numeri con virgola o punto: costo km, CO2 e trattenuta', () => {
  assert.equal(FB.num('0,5777'), 0.5777); assert.equal(FB.num('0.5777'), 0.5777);
  assert.equal(FB.num('1.234,56'), 1234.56); assert.equal(FB.num('88,0'), 88); assert.ok(Number.isNaN(FB.num('')));
  const r = FB.calcolaRegime('co2', { ...base, ck: '0,5', co2: '160,4', trattenuta: '100,50', dataImmatricolazione: '2024-01-01' }, R);
  assert.equal(r.perc, 50); // 160,4 g/km supera la soglia di 160
  assert.equal(r.imponibile, FB.r2(3750 - 100.5));
});

test('Inizio non indicato: si parte dalla data dell\'atto di assegnazione se cade nell\'anno', () => {
  const r = FB.calcolaRegime('nuovo', { ...base, ck: 0.5, dataContratto: '2026-07-01', dataImmatricolazione: '2026-06-01' }, R);
  assert.equal(r.giorni, 184);
  const r2 = FB.calcolaRegime('nuovo', { ...base, ck: 0.5, dataContratto: '2025-03-01', dataImmatricolazione: '2025-01-01' }, R);
  assert.equal(r2.giorni, 365);
});

test('Regole incomplete: errore chiaro invece di NaN', () => {
  const rotte = [{ ...R[1], km: null }];
  assert.match(FB.calcolaRegime('nuovo', { ...base, ck: 0.5, dataImmatricolazione: '2026-01-01' }, rotte).errore, /regole/);
});

test('Anno 2025: avviso per auto non di nuova immatricolazione nel nuovo regime', () => {
  const g = FB.determinaRegime({ anno: 2025, dataContratto: '2025-05-01', dataImmatricolazione: '2022-01-01' });
  assert.equal(g.chiave, 'nuovo'); assert.equal(g.avvisi.length, 1);
  assert.equal(FB.determinaRegime({ anno: 2026, dataContratto: '2025-05-01', dataImmatricolazione: '2022-01-01' }).avvisi.length, 0);
});

// ---------- valore normale (veicolo usato, Telefisco 2021) ----------
const usata = { ...base, ck: 0.5, co2: 120, dataImmatricolazione: '2019-03-01', dataContratto: '2021-01-15', alim: 'benzina' };

test('Veicolo immatricolato prima del 07/2020 e assegnato dopo: senza canone resta il forfait indicativo con avviso', () => {
  const r = FB.calcola(usata, R);
  assert.equal(r.regime.chiave, 'co2');
  assert.ok(r.regime.avvisi.some((a) => /valore normale/.test(a)));
});

test('Valore normale = canone ragguagliato − (km lavoro × tariffa ACI) − trattenute', () => {
  const r = FB.calcola({ ...usata, anno: 2026, inizio: '2026-01-01', canone: '6000', kmLavoro: '4000', tariffaKm: '0,4', trattenuta: 100 }, R);
  assert.equal(r.regime.chiave, 'normale');
  assert.equal(r.valoreAnnuo, 6000 - 1600);
  assert.equal(r.imponibile, 4300);
  assert.equal(r.confronto[0].chiave, 'normale'); assert.equal(r.confronto[0].applicabile, true);
});

test('Valore normale: la tariffa di default è il costo km ACI; canone ragguagliato ai giorni; mai negativo', () => {
  const r = FB.calcola({ ...usata, anno: 2026, inizio: '2026-07-01', canone: 3650, kmLavoro: 100 }, R);
  assert.equal(r.giorni, 184);
  assert.equal(r.valoreAnnuo, FB.r2(3650 * 184 / 365 - 50));
  const neg = FB.calcola({ ...usata, anno: 2026, canone: 1000, kmLavoro: 100000 }, R);
  assert.equal(neg.imponibile, 0);
});

test('Auto usata assegnata nel 2025 (nuovo regime): valore normale solo per il 2025, non dal 2026', () => {
  const d = { ...base, anno: 2025, ck: 0.5, dataContratto: '2025-04-01', dataImmatricolazione: '2022-01-01', canone: 5000 };
  assert.equal(FB.calcola(d, R).regime.chiave, 'normale');
  assert.equal(FB.calcola({ ...d, anno: 2026 }, R).regime.chiave, 'nuovo');
});

// ---------- amministratori / co.co.co. ----------
test('Amministratore, uso aziendale: nessun reddito in natura', () => {
  const r = FB.calcola({ ...base, ck: 0.5, beneficiario: 'amministratore', usoAmm: 'aziendale', dataContratto: '2026-01-01', dataImmatricolazione: '2026-01-01' }, R);
  assert.equal(r.imponibile, 0); assert.equal(r.regime.chiave, 'nessuno');
});

test('Amministratore, uso promiscuo: stesso forfait ACI del dipendente', () => {
  const x = { ...base, ck: 0.5, dataContratto: '2026-01-01', dataImmatricolazione: '2026-01-01' };
  assert.equal(FB.calcola({ ...x, beneficiario: 'amministratore', usoAmm: 'promiscuo' }, R).imponibile, FB.calcola(x, R).imponibile);
});

test('Amministratore, uso personale: valore normale = costo annuo, senza scorporo km', () => {
  const r = FB.calcola({ ...base, ck: 0.5, beneficiario: 'amministratore', usoAmm: 'personale', canone: 4000, kmLavoro: 9999, dataContratto: '2026-01-01' }, R);
  assert.equal(r.imponibile, 4000);
  assert.ok(FB.calcola({ ...base, ck: 0.5, beneficiario: 'amministratore', usoAmm: 'personale', dataContratto: '2026-01-01' }, R).errore);
});

// ---------- deducibilità ----------
const fringe = (giorni = 365, imponibile = 5000) => ({ imponibile, giorni, giorniAnno: 365 });

test('Dipendente, maggior parte dell\'anno: 70% di costi + Iva non detraibile, Iva 40% (100% con corrispettivo)', () => {
  const d = FB.deducibilita({ costiAnnui: '10.000,00', ivaCosti: 2200 }, fringe());
  assert.equal(d.iva.perc, 40); assert.equal(d.iva.detraibile, 880); assert.equal(d.iva.indetraibile, 1320);
  assert.equal(d.imposte.perc, 70); assert.equal(d.imposte.importo, FB.r2((10000 + 1320) * 0.7)); // l'Iva indetraibile è un costo
  const c = FB.deducibilita({ costiAnnui: 1000, ivaCosti: 220, addebito: true }, fringe());
  assert.equal(c.iva.detraibile, 220); assert.equal(c.imposte.importo, 700);
});

test('Auto acquistata a 56.600 € (Iva indetraibile compresa), ammortamento 14.150 → quota deducibile 20% = 903,80', () => {
  const d = FB.deducibilita({ costiAnnui: 14150, quotaBene: 14150, titolo: 'acquisto', costoVeicolo: 56600 }, fringe(100));
  assert.equal(d.imposte.perc, 20); assert.equal(d.imposte.importo, 903.8);
  assert.equal(d.limiti.length, 0);
});

test('Noleggio assegnato per meno di metà anno: canone limitato a 3.615,20, altri costi pieni', () => {
  const d = FB.deducibilita({ costiAnnui: 10000, quotaBene: 8000, titolo: 'noleggio' }, fringe(100));
  assert.equal(d.imposte.importo, FB.r2((10000 - 8000 + 3615.2) * 0.2)); // 1.123,04
  const senza = FB.deducibilita({ costiAnnui: 10000, titolo: 'noleggio' }, fringe(100));
  assert.equal(senza.imposte.importo, 2000); assert.match(senza.limiti[0], /non applicato/);
});

test('Amministratore uso promiscuo: esempio → spese 20.000 (ammortamento 12.500 su auto da 50.000) → 10.000 + 20% × 2.019 = 10.403,80', () => {
  const d = FB.deducibilita({ beneficiario: 'amministratore', usoAmm: 'promiscuo', costiAnnui: 20000, quotaBene: 12500, titolo: 'acquisto', costoVeicolo: 50000 }, fringe(365, 10000));
  assert.equal(d.imposte.importo, 10403.8);
});

test('Amministratore: uso personale deduce il compenso in natura entro i costi; uso aziendale 20%', () => {
  assert.equal(FB.deducibilita({ beneficiario: 'amministratore', usoAmm: 'personale', costiAnnui: 3000 }, fringe(365, 5000)).imposte.importo, 3000);
  assert.equal(FB.deducibilita({ beneficiario: 'amministratore', usoAmm: 'aziendale', costiAnnui: 5000 }, fringe(365, 0)).imposte.importo, 1000);
});

test('Numeri: il punto con tre cifre dopo è separatore delle migliaia, non decimale', () => {
  assert.equal(FB.num('8.000'), 8000); assert.equal(FB.num('1.234.567'), 1234567); assert.equal(FB.num('12.500'), 12500);
  assert.equal(FB.num('0.577'), 0.577); assert.equal(FB.num('0.5777'), 0.5777); assert.equal(FB.num('88.0'), 88); assert.equal(FB.num('1234.5'), 1234.5);
});

test('Numeri: separatore decimale = ultimo tra punto e virgola', () => {
  assert.equal(FB.num('1,000.50'), 1000.5); assert.equal(FB.num('1.000,50'), 1000.5); assert.equal(FB.num('12,5'), 12.5);
});

test('Costo km con punto e tre decimali: "1.152" è 1,152 €/km, non 1.152', () => {
  assert.equal(FB.num('1.152', false), 1.152); assert.equal(FB.num('1.152'), 1152);
  const r = FB.calcolaRegime('nuovo', { ...base, ck: '1.152', dataImmatricolazione: '2026-01-01' }, R);
  assert.equal(r.valoreAnnuo, FB.r2(1.152 * 15000 * 0.5));
  const n = FB.calcolaNormale({ anno: 2026, canone: 6000, kmLavoro: 1000, tariffaKm: '1.152' }, R);
  assert.equal(n.valoreAnnuo, 6000 - 1152);
});

test('Amministratore con mezzo fuori forfait: uso aziendale = 0, uso personale = valore normale; dipendente = errore', () => {
  const x = { ...base, categoria: 'altro', beneficiario: 'amministratore', dataContratto: '2026-01-01', canone: 3000 };
  assert.equal(FB.calcola({ ...x, usoAmm: 'aziendale' }, R).imponibile, 0);
  assert.equal(FB.calcola({ ...x, usoAmm: 'personale' }, R).imponibile, 3000);
  assert.ok(FB.calcola({ ...x, usoAmm: 'promiscuo' }, R).errore);
  assert.ok(FB.calcola({ ...x, beneficiario: 'dipendente' }, R).errore);
});

test('Auto ordinata entro il 2024 e concessa a settembre 2025: regime CO2 (testo vigente: tutto il 2025)', () => {
  assert.equal(FB.determinaRegime({ dataContratto: '2025-09-01', dataOrdine: '2024-11-20' }).chiave, 'co2');
});

// ---------- costi strutturati e Iva (acquisto, canoni, altri costi, Iva a debito) ----------
const acq = { titolo: 'acquisto', prezzoAcquisto: '50.000', ivaAcquisto: '11.000', annoAcquisto: 2026 };

test('Acquisto 50.000 + Iva 11.000 (40%), anno N: ammortamento 12,5% di 56.600 = 7.075 + costi 5.000 → 70% = 8.452,50', () => {
  const d = FB.deducibilita({ ...acq, anno: 2026, altriCosti: 5000 }, fringe());
  assert.equal(d.costi.costoVeicolo, 56600);
  assert.equal(d.costi.quota, 7075);
  assert.equal(d.imposte.importo, 8452.5);
  assert.equal(d.iva.acquisto.detraibile, 4400); assert.equal(d.iva.acquisto.indetraibile, 6600);
  assert.equal(d.iva.detraibile, 4400); // nell'anno d'acquisto si detrae l'Iva della fattura
});

test('Stessa auto, anno N+1, assegnata < metà anno → ammortamento 14.150 limitato a 4.519 → 903,80; Iva acquisto non più nell\'anno', () => {
  const d = FB.deducibilita({ ...acq, anno: 2027 }, fringe(100));
  assert.equal(d.costi.quota, 14150);
  assert.equal(d.imposte.importo, 903.8);
  assert.equal(d.iva.acquisto.nellAnno, false); assert.equal(d.iva.detraibile, null);
});

test('Ammortamento automatico: 12,5% · 25% · 25% · 25% · 12,5%, poi 0; la quota inserita a mano prevale', () => {
  const q = (anno) => FB.componiCosti({ ...acq, anno }, 40).quota;
  assert.deepEqual([2026, 2027, 2028, 2029, 2030, 2031].map(q), [7075, 14150, 14150, 14150, 7075, 0]);
  assert.equal(FB.componiCosti({ ...acq, anno: 2027, quotaBene: '10.000' }, 40).quota, 10000);
});

test('Noleggio: Iva non detraibile sui canoni fa parte del canone soggetto al limite; altri costi pieni', () => {
  const d = FB.deducibilita({ titolo: 'noleggio', quotaBene: 3000, ivaCanone: 660, altriCosti: 2000, ivaAltri: 440 }, fringe(100));
  // canone lordo = 3000 + 60% di 660 = 3396 (sotto il limite 3.615,20); altri = 2000 + 264
  assert.equal(d.costi.base, FB.r2(3396 + 2000 + 264));
  assert.equal(d.imposte.importo, FB.r2((3396 + 2264) * 0.2));
  assert.equal(d.iva.detraibile, FB.r2((660 + 440) * 0.4));
});

test('Corrispettivo addebitato 2.656,96 € Iva inclusa → imponibile 2.177,84 + Iva 22% 479,12; Iva detraibile 100%', () => {
  const res = { imponibile: 0, giorni: 365, giorniAnno: 365, trattenuta: 2656.96, regola: R[1] };
  const d = FB.deducibilita({ addebito: true, altriCosti: 1000, ivaAltri: 220 }, res);
  assert.deepEqual(d.iva.debito, { aliquota: 22, totale: 2656.96, imponibile: 2177.84, iva: 479.12 });
  assert.equal(d.iva.perc, 100); assert.equal(d.iva.detraibile, 220);
});

test('Corrispettivo senza trattenuta: avviso; amministratore: nessuna Iva a debito', () => {
  assert.ok(FB.deducibilita({ addebito: true }, fringe()).note.some((n) => /trattenuta/.test(n)));
  assert.equal(FB.deducibilita({ beneficiario: 'amministratore', usoAmm: 'promiscuo', addebito: true }, { ...fringe(), trattenuta: 100 }).iva.debito, null);
});
