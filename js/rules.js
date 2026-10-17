/*
 * Motore di calcolo del fringe benefit per auto (e moto) concesse in uso promiscuo.
 * Art. 51, c. 4, lett. a) Tuir (dal 1.01.2027 art. 53 c. 6 lett. a) del nuovo Testo unico).
 *
 * Funzioni pure, senza accesso al DOM: usabili dal browser e da Node (tests/).
 * Le percentuali e le soglie NON sono nel codice ma nelle "regole per anno"
 * (REGOLE_DEFAULT, modificabili dall'interfaccia): quando la norma cambia si
 * aggiunge una nuova versione con "dal" = primo anno d'imposta di applicazione.
 */
(function (root) {
  'use strict';

  // Date-spartiacque stabilite dalla legge (non cambiano da un anno all'altro)
  const DATE_REGIMI = {
    PRE2020_FINO: '2020-06-30', // contratti stipulati entro: disciplina vigente al 31.12.2019 (L. 160/2019, c. 633)
    CO2_FINO: '2024-12-31',     // contratti fino a: disciplina CO2 (L. 207/2024, c. 48-bis)
    NUOVA_IMMATR_CO2: '2020-07-01',
  };

  const REGOLE_DEFAULT = [
    {
      dal: 2025,
      etichetta: 'Legge di Bilancio 2025 (L. 207/2024, art. 1 c. 48)',
      km: 15000,
      pre2020: { perc: 30 },
      co2: { soglie: [{ fino: 60, perc: 25 }, { fino: 160, perc: 30 }, { fino: 190, perc: 50 }, { fino: null, perc: 60 }] },
      nuovo: { perc_altri: 50, perc_elettrico: 10, perc_plugin: 20 },
      anzianita: { attiva: false, anni: 5, perc: 50 },
      accessori: { attiva: false, perc: 5 },
    },
    {
      dal: 2026,
      etichetta: 'Decreto Omnibus (D.Lgs. 7.08.2026 n. 148, art. 2)',
      km: 15000,
      pre2020: { perc: 30 },
      co2: { soglie: [{ fino: 60, perc: 25 }, { fino: 160, perc: 30 }, { fino: 190, perc: 50 }, { fino: null, perc: 60 }] },
      nuovo: { perc_altri: 50, perc_elettrico: 10, perc_plugin: 20 },
      anzianita: { attiva: true, anni: 5, perc: 50 },
      accessori: { attiva: true, perc: 5 },
    },
  ];

  const REGIMI = {
    pre2020: { nome: 'Contratti entro il 30.06.2020', breve: 'Ante 07/2020 (30%)' },
    co2: { nome: 'Regime CO₂ (contratti 07/2020 – 12/2024)', breve: 'Regime CO₂' },
    nuovo: { nome: 'Nuovo regime (dal 2025)', breve: 'Nuovo regime' },
  };

  const ALIMENTAZIONI = {
    benzina: { nome: 'Benzina', aci: ['benzina'] },
    gasolio: { nome: 'Gasolio', aci: ['gasolio'] },
    gpl_metano: { nome: 'Benzina-GPL / Benzina-metano / metano', aci: ['gpl-metano'] },
    ibrido: { nome: 'Ibrido (non ricaricabile da rete)', aci: ['ibrido-benzina', 'ibrido-gasolio'] },
    plugin: { nome: 'Ibrido plug-in (ricaricabile da rete)', aci: ['plug-in'] },
    elettrico: { nome: 'Elettrico a batteria (BEV)', aci: ['elettrico'] },
    idrogeno: { nome: 'Idrogeno / altro', aci: [] },
  };

  const CATEGORIE = {
    autovettura: { nome: 'Autovettura (categoria M1)', aci: null, forfait: true },
    promiscuo: { nome: 'Autoveicolo per trasporto promiscuo di persone e cose (≤ 3,5 t, ≤ 9 posti)', aci: null, forfait: true },
    autocaravan: { nome: 'Autocaravan', aci: ['autocaravan'], forfait: true },
    motociclo: { nome: 'Motociclo (categorie L3e–L7e)', aci: ['moto'], forfait: true },
    ciclomotore: { nome: 'Ciclomotore (categorie L1e–L2e)', aci: ['moto'], forfait: true },
    altro: { nome: 'Altro (autocarro puro, mezzo > 3,5 t, più di 9 posti…)', aci: null, forfait: false },
  };

  const r2 = (x) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7)) / 100;
  const anno = (iso) => Number(String(iso).slice(0, 4));
  const bisestile = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  const giorniNellAnno = (a) => (bisestile(a) ? 366 : 365);
  const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

  /** Giorni di assegnazione compresi nell'anno d'imposta (estremi inclusi). */
  function giorniAssegnazione(a, inizio, fine) {
    const i = inizio ? Math.max(utc(inizio), utc(`${a}-01-01`)) : utc(`${a}-01-01`);
    const f = fine ? Math.min(utc(fine), utc(`${a}-12-31`)) : utc(`${a}-12-31`);
    return Math.max(0, Math.round((f - i) / 86400000) + 1);
  }

  /** Versione delle regole valida per l'anno d'imposta (la più recente con dal <= anno). */
  function regoleAnno(regole, a) {
    const v = [...regole].sort((x, y) => x.dal - y.dal).filter((r) => r.dal <= a);
    return v.length ? v[v.length - 1] : null;
  }

  /** Quale disciplina si applica, in base alle date di contratto/ordine. */
  function determinaRegime(inp) {
    const w = [];
    const c = inp.dataContratto;
    if (!c) return { errore: 'Manca la data di stipula del contratto / atto di assegnazione.' };
    if (c <= DATE_REGIMI.PRE2020_FINO) {
      return {
        chiave: 'pre2020', avvisi: w,
        motivo: 'Contratto stipulato entro il 30.06.2020: resta ferma la disciplina vigente al 31.12.2019 (art. 1, c. 633, L. 160/2019). Si assume il 30% di 15.000 km di costo chilometrico ACI, a prescindere dalle emissioni.',
      };
    }
    if (c <= DATE_REGIMI.CO2_FINO) {
      if (inp.dataImmatricolazione && inp.dataImmatricolazione < DATE_REGIMI.NUOVA_IMMATR_CO2) {
        w.push('Veicolo immatricolato prima del 1.07.2020 ma assegnato dopo: la norma CO₂ parla di "nuove immatricolazioni". Mancano indicazioni precise dell\'Agenzia: il calcolo CO₂ è indicativo, valuta con il consulente il criterio del valore normale (art. 9 Tuir).');
      }
      return {
        chiave: 'co2', avvisi: w,
        motivo: 'Contratto stipulato tra il 1.07.2020 e il 31.12.2024: si applica il regime transitorio basato sulle emissioni di CO₂ (L. 207/2024, art. 1 c. 48-bis), che resta valido ma con la maggiorazione per anzianità del veicolo dal 2026.',
      };
    }
    if (c <= '2025-12-31' && inp.dataOrdine && inp.dataOrdine <= DATE_REGIMI.CO2_FINO) {
      return {
        chiave: 'co2', avvisi: w,
        motivo: 'Veicolo ordinato entro il 31.12.2024 e concesso nel 2025: resta il regime transitorio basato sulle emissioni di CO₂ (L. 207/2024, art. 1 c. 48-bis).',
      };
    }
    return {
      chiave: 'nuovo', avvisi: w,
      motivo: 'Veicolo concesso dal 1.01.2025 (e non ordinato entro il 31.12.2024): si applica il nuovo regime, con percentuale legata al tipo di alimentazione (10% elettrico, 20% ibrido plug-in, 50% altri).',
    };
  }

  function percentualeRegime(chiave, R, inp) {
    if (chiave === 'pre2020') return { perc: R.pre2020.perc, nota: 'Percentuale fissa' };
    if (chiave === 'co2') {
      const co2 = inp.alim === 'elettrico' && (inp.co2 === '' || inp.co2 == null) ? 0 : Number(inp.co2);
      if (inp.co2 === '' || inp.co2 == null ? inp.alim !== 'elettrico' : Number.isNaN(co2)) {
        return { errore: 'Per il regime CO₂ serve il valore delle emissioni (campo V.7 della carta di circolazione).' };
      }
      const s = R.co2.soglie.find((x) => x.fino == null || co2 <= x.fino);
      return { perc: s.perc, nota: `CO₂ = ${co2} g/km` };
    }
    const n = R.nuovo;
    if (inp.alim === 'elettrico') return { perc: n.perc_elettrico, nota: 'Veicolo a batteria a trazione esclusivamente elettrica' };
    if (inp.alim === 'plugin') return { perc: n.perc_plugin, nota: 'Veicolo elettrico ibrido plug-in' };
    return { perc: n.perc_altri, nota: 'Altri veicoli' };
  }

  /**
   * Calcolo completo per un regime (anche diverso da quello applicabile: serve ai confronti).
   * inp: { anno, dataImmatricolazione, alim, co2, ck, inizio, fine, trattenuta, accessori }
   */
  function calcolaRegime(chiave, inp, regole) {
    const R = regoleAnno(regole, inp.anno);
    if (!R) return { errore: `Nessuna regola definita per l'anno d'imposta ${inp.anno}: aggiungila in "Aggiornamento annuale".` };
    const ck = Number(inp.ck);
    if (!(ck > 0)) return { errore: 'Manca il costo chilometrico ACI.' };
    const p = percentualeRegime(chiave, R, inp);
    if (p.errore) return { errore: p.errore };

    const passi = [];
    const base = r2(ck * R.km);
    passi.push({ etichetta: `Costo km ACI × ${R.km.toLocaleString('it-IT')} km`, dettaglio: `${ck.toFixed(4).replace('.', ',')} × ${R.km}`, valore: base });
    let valore = r2(base * p.perc / 100);
    passi.push({ etichetta: `${p.perc}% della percorrenza convenzionale`, dettaglio: p.nota, valore });

    const maggiorazioni = [];
    if (chiave !== 'pre2020' && R.anzianita.attiva && inp.dataImmatricolazione) {
      const y = anno(inp.dataImmatricolazione);
      const dal = y + R.anzianita.anni + 1;
      if (inp.anno >= dal) {
        const m = r2(valore * R.anzianita.perc / 100);
        valore = r2(valore + m);
        maggiorazioni.push('anzianita');
        passi.push({ etichetta: `Maggiorazione +${R.anzianita.perc}% (oltre il ${R.anzianita.anni}° anno dall'immatricolazione)`, dettaglio: `immatricolata nel ${y}: scatta dal ${dal}`, valore: m });
      }
    }
    if (chiave === 'nuovo' && inp.accessori && R.accessori.attiva) {
      const m = r2(valore * R.accessori.perc / 100);
      valore = r2(valore + m);
      maggiorazioni.push('accessori');
      passi.push({ etichetta: `Maggiorazione +${R.accessori.perc}% (accessori/allestimenti non valorizzati nelle tabelle ACI)`, dettaglio: '', valore: m });
    }
    const valoreAnnuo = valore;

    const ga = giorniNellAnno(inp.anno);
    const gg = giorniAssegnazione(inp.anno, inp.inizio, inp.fine);
    const proRata = r2(valoreAnnuo * gg / ga);
    if (gg !== ga) passi.push({ etichetta: 'Ragguaglio ai giorni di assegnazione', dettaglio: `${gg} / ${ga} giorni`, valore: proRata });

    const trattenuta = Math.max(0, Number(inp.trattenuta) || 0);
    const imponibile = Math.max(0, r2(proRata - trattenuta));
    if (trattenuta) passi.push({ etichetta: 'Meno: importo trattenuto al dipendente (Iva inclusa)', dettaglio: '', valore: -trattenuta });

    return { chiave, perc: p.perc, nota: p.nota, base, valoreAnnuo, giorni: gg, giorniAnno: ga, proRata, trattenuta, imponibile, maggiorazioni, passi, regola: R };
  }

  /** Regime applicabile + confronto con gli altri regimi calcolati sugli stessi dati. */
  function calcola(inp, regole) {
    const cat = CATEGORIE[inp.categoria];
    if (cat && !cat.forfait) {
      return { errore: 'Questo tipo di mezzo non rientra nel metodo forfetario dell\'art. 51, c. 4, lett. a) Tuir (autovetture, autoveicoli per trasporto promiscuo, autocaravan, motocicli, ciclomotori). Il benefit va valorizzato secondo il "valore normale" (art. 9 Tuir).' };
    }
    const reg = determinaRegime(inp);
    if (reg.errore) return { errore: reg.errore };
    const principale = calcolaRegime(reg.chiave, inp, regole);
    const confronto = ['pre2020', 'co2', 'nuovo'].map((k) => ({ chiave: k, applicabile: k === reg.chiave, ...calcolaRegime(k, inp, regole) }));
    return { regime: reg, ...principale, confronto };
  }

  const api = { DATE_REGIMI, REGOLE_DEFAULT, REGIMI, ALIMENTAZIONI, CATEGORIE, r2, anno, giorniNellAnno, giorniAssegnazione, regoleAnno, determinaRegime, calcolaRegime, calcola };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FB = api;
})(typeof window !== 'undefined' ? window : globalThis);
