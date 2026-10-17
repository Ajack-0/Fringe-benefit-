import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const FB = createRequire(import.meta.url)('../js/rules.js');
const R = FB.REGOLE_DEFAULT;
const base = { anno: 2026, alim: 'benzina', categoria: 'autovettura', inizio: '', fine: '', trattenuta: 0, accessori: false };

test('BEV assegnata nel 2025: 0,4421 × 15.000 × 10% = 663,15 (ebook p.56)', () => {
  const r = FB.calcolaRegime('nuovo', { ...base, anno: 2025, alim: 'elettrico', ck: 0.4421, dataImmatricolazione: '2025-01-10' }, R);
  assert.equal(r.valoreAnnuo, 663.15);
});

test('Stelvio 2026 al 60%: 8.316,00 come nella tabella ACI', () => {
  const r = FB.calcolaRegime('co2', { ...base, ck: 0.924, co2: 267, dataImmatricolazione: '2024-01-01' }, R);
  assert.equal(r.perc, 60); assert.equal(r.valoreAnnuo, 8316);
});

test('Esempio ebook p.61: 0,5063 al 30% = 2.278,35; dal 2026 +50% = 3.417,53 (veicolo 2020)', () => {
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
