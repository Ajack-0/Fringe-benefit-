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
    normale: { nome: 'Valore normale (art. 9 Tuir)', breve: 'Valore normale' },
    nessuno: { nome: 'Nessun reddito in natura', breve: 'Nessun benefit' },
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

  /** Numero da testo italiano o inglese: "0,5777", "0.5777", "1.234,56", "8.000", "88,0". Vuoto → NaN. */
  function num(x) {
    if (typeof x === 'number') return x;
    if (x == null) return NaN;
    let s = String(x).trim().replace(/[\s€]/g, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) {
      // entrambi presenti: l'ultimo è il separatore decimale ("1.234,56" oppure "1,234.56")
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) s = s.replace(',', '.');
    else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "8.000" = ottomila (non 8)
    return Number(s);
  }
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

  /**
   * Quale disciplina si applica, in base alle date di contratto/ordine.
   * `valoreNormale` = veicolo usato assegnato quando la norma richiedeva la "nuova immatricolazione":
   * il forfait ACI non è applicabile e il benefit si valorizza al valore normale (art. 9 Tuir).
   */
  function determinaRegime(inp) {
    const w = [];
    const c = inp.dataContratto;
    const imm = inp.dataImmatricolazione;
    if (!c) return { errore: 'Manca la data di stipula del contratto / atto di assegnazione.' };
    if (c <= DATE_REGIMI.PRE2020_FINO) {
      return {
        chiave: 'pre2020', avvisi: w,
        motivo: 'Contratto stipulato entro il 30.06.2020: resta ferma la disciplina vigente al 31.12.2019 (art. 1, c. 633, L. 160/2019). Si assume il 30% di 15.000 km di costo chilometrico ACI, a prescindere dalle emissioni.',
      };
    }
    if (c <= DATE_REGIMI.CO2_FINO) {
      const usato = !!(imm && imm < DATE_REGIMI.NUOVA_IMMATR_CO2);
      if (usato) {
        w.push('Veicolo immatricolato prima del 1.07.2020 e assegnato dopo: il regime CO₂ riguarda le "nuove immatricolazioni". Per l\'Agenzia (Telefisco 2021, ris. 46/2020) il benefit va valorizzato al valore normale (art. 9 Tuir), scorporando l\'utilizzo nell\'interesse del datore di lavoro: inserisci canone e chilometri al passo 4.');
      }
      return {
        chiave: 'co2', avvisi: w, valoreNormale: usato,
        motivo: 'Contratto stipulato tra il 1.07.2020 e il 31.12.2024: si applica il regime transitorio basato sulle emissioni di CO₂ (L. 207/2024, art. 1 c. 48-bis), che resta valido ma con la maggiorazione per anzianità del veicolo dal 2026.',
      };
    }
    if (c <= '2025-12-31' && inp.dataOrdine && inp.dataOrdine <= DATE_REGIMI.CO2_FINO) {
      return {
        chiave: 'co2', avvisi: w,
        motivo: 'Veicolo ordinato entro il 31.12.2024 e concesso nel 2025: resta il regime transitorio basato sulle emissioni di CO₂ (L. 207/2024, art. 1 c. 48-bis).',
      };
    }
    const usato25 = inp.anno === 2025 && !!(imm && imm < '2025-01-01');
    if (usato25) {
      w.push('Per il periodo d\'imposta 2025 la norma richiedeva un veicolo "di nuova immatricolazione": per un\'auto già immatricolata prima del 2025 il forfait è indicativo; per analogia con il caso 2020 il benefit andrebbe valorizzato al valore normale (art. 9 Tuir). Dal 2026 il requisito è stato eliminato (D.Lgs. 148/2026).');
    }
    return {
      chiave: 'nuovo', avvisi: w, valoreNormale: usato25,
      motivo: 'Veicolo concesso dal 1.01.2025 (e non ordinato entro il 31.12.2024): si applica il nuovo regime, con percentuale legata al tipo di alimentazione (10% elettrico, 20% ibrido plug-in, 50% altri).',
    };
  }

  function percentualeRegime(chiave, R, inp) {
    if (chiave === 'pre2020') return { perc: R.pre2020.perc, nota: 'Percentuale fissa' };
    if (chiave === 'co2') {
      const vuota = inp.co2 === '' || inp.co2 == null;
      if (vuota && inp.alim !== 'elettrico') {
        return { errore: 'Per il regime CO₂ serve il valore delle emissioni (campo V.7 della carta di circolazione).' };
      }
      const co2 = vuota ? 0 : num(inp.co2);
      if (!(co2 >= 0)) return { errore: 'Il valore delle emissioni di CO₂ non è valido.' };
      const s = R.co2.soglie.find((x) => x.fino == null || co2 <= x.fino);
      return { perc: s.perc, nota: `CO₂ = ${co2} g/km` };
    }
    const n = R.nuovo;
    if (inp.alim === 'elettrico') return { perc: n.perc_elettrico, nota: 'Veicolo a batteria a trazione esclusivamente elettrica' };
    if (inp.alim === 'plugin') return { perc: n.perc_plugin, nota: 'Veicolo elettrico ibrido plug-in' };
    if (inp.alim === 'idrogeno') return { perc: n.perc_altri, nota: 'Altri veicoli (le riduzioni valgono solo per elettrici a batteria e ibridi plug-in)' };
    return { perc: n.perc_altri, nota: 'Altri veicoli' };
  }

  /**
   * Calcolo completo per un regime (anche diverso da quello applicabile: serve ai confronti).
   * inp: { anno, dataImmatricolazione, alim, co2, ck, inizio, fine, trattenuta, accessori }
   */
  function calcolaRegime(chiave, inp, regole) {
    const R = regoleAnno(regole, inp.anno);
    if (!R) return { errore: `Nessuna regola definita per l'anno d'imposta ${inp.anno}: aggiungila in "Aggiornamento annuale".` };
    const ck = num(inp.ck);
    if (!(ck > 0)) return { errore: 'Manca il costo chilometrico ACI.' };
    const p = percentualeRegime(chiave, R, inp);
    if (p.errore) return { errore: p.errore };
    const okNum = (v) => typeof v === 'number' && v >= 0;
    if (!(R.km > 0) || !okNum(p.perc) || (R.anzianita.attiva && !(okNum(R.anzianita.anni) && okNum(R.anzianita.perc))) || (R.accessori.attiva && !okNum(R.accessori.perc))) {
      return { errore: `Le regole fiscali dal ${R.dal} contengono un valore mancante o non valido: correggile in "Aggiornamento annuale".` };
    }

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
    // Se l'inizio non è indicato si parte dall'atto di assegnazione (o dal 1° gennaio, se precedente)
    const gg = giorniAssegnazione(inp.anno, inp.inizio || inp.dataContratto, inp.fine);
    const proRata = r2(valoreAnnuo * gg / ga);
    if (gg !== ga) passi.push({ etichetta: 'Ragguaglio ai giorni di assegnazione', dettaglio: `${gg} / ${ga} giorni`, valore: proRata });

    const trattenuta = Math.max(0, num(inp.trattenuta) || 0);
    const imponibile = Math.max(0, r2(proRata - trattenuta));
    if (trattenuta) passi.push({ etichetta: 'Meno: importo trattenuto al dipendente (Iva inclusa)', dettaglio: '', valore: -trattenuta });

    return { chiave, perc: p.perc, nota: p.nota, base, valoreAnnuo, giorni: gg, giorniAnno: ga, proRata, trattenuta, imponibile, maggiorazioni, passi, regola: R };
  }

  const quota = (importo, gg, ga) => r2(importo * gg / ga);

  /**
   * Valore normale (art. 9 Tuir) di un veicolo non rientrante nel forfait ACI.
   * Veicolo usato in leasing/noleggio (Telefisco 2021, ris. 46/2020): canone pagato dal datore di lavoro
   * meno l'indennità chilometrica ACI per i km percorsi nell'interesse del datore di lavoro.
   * Uso esclusivamente personale dell'amministratore: costo annuo per intero (nessuno scorporo).
   * inp: { anno, canone, kmLavoro, tariffaKm, ck, inizio, fine, dataContratto, trattenuta, personale }
   */
  function calcolaNormale(inp, regole) {
    const R = regoleAnno(regole, inp.anno);
    if (!R) return { errore: `Nessuna regola definita per l'anno d'imposta ${inp.anno}: aggiungila in "Aggiornamento annuale".` };
    const canone = num(inp.canone);
    if (!(canone > 0)) return { errore: 'Per il valore normale indica il canone annuo (leasing/noleggio) o il costo annuo del veicolo.' };
    const ga = giorniNellAnno(inp.anno);
    const gg = giorniAssegnazione(inp.anno, inp.inizio || inp.dataContratto, inp.fine);
    const passi = [];
    const q = quota(canone, gg, ga);
    passi.push({ etichetta: inp.personale ? 'Costo annuo del veicolo, ragguagliato ai giorni' : 'Canone annuo di leasing/noleggio, ragguagliato ai giorni', dettaglio: `${canone.toLocaleString('it-IT', { minimumFractionDigits: 2 })} × ${gg} / ${ga}`, valore: q });
    let valore = q;
    if (!inp.personale) {
      const km = Math.max(0, num(inp.kmLavoro) || 0);
      const tariffa = num(inp.tariffaKm) > 0 ? num(inp.tariffaKm) : (num(inp.ck) || 0);
      const ind = r2(km * tariffa);
      if (km > 0 && !(tariffa > 0)) return { errore: 'Per scorporare i chilometri di lavoro serve la tariffa ACI al km: selezionare il modello o inserirla.' };
      valore = Math.max(0, r2(q - ind));
      passi.push({ etichetta: 'Meno: indennità chilometrica per i km nell\'interesse del datore di lavoro', dettaglio: `${km.toLocaleString('it-IT')} km × ${tariffa.toFixed(4).replace('.', ',')} €/km (tariffa ACI)`, valore: -ind });
    }
    const trattenuta = Math.max(0, num(inp.trattenuta) || 0);
    const imponibile = Math.max(0, r2(valore - trattenuta));
    if (trattenuta) passi.push({ etichetta: 'Meno: importo trattenuto al dipendente (Iva inclusa)', dettaglio: '', valore: -trattenuta });
    return { chiave: 'normale', perc: null, nota: 'Valore normale', base: q, valoreAnnuo: valore, giorni: gg, giorniAnno: ga, proRata: valore, trattenuta, imponibile, maggiorazioni: [], passi, regola: R };
  }

  const LIMITI = {
    acquisto: 'Limite di costo per acquisto/leasing: 18.075,99 € (la quota deducibile del 20% si calcola su questo importo: 3.615,20 €).',
    leasing: 'Limite di costo per acquisto/leasing: 18.075,99 € (canoni deducibili in proporzione; 20% su questo importo: 3.615,20 €).',
    noleggio: 'Limite di costo per noleggio: 3.615,20 € annui (20% = 723,04 €).',
    '': 'Il 20% si applica entro i limiti di costo: 18.075,99 € per acquisto/leasing (3.615,20 € deducibili), 3.615,20 € per noleggio (723,04 € deducibili).',
  };

  /**
   * Deducibilità per l'azienda (imposte dirette e Iva) in base a utilizzatore, uso, titolo e periodo.
   * Fonte: ebook "Fiscalità dei veicoli aziendali", cap. 3.1.3, 3.1.4 e schema 3.3.
   * res: risultato di calcola() (serve imponibile, giorni, giorniAnno).
   */
  function deducibilita(inp, res) {
    const costi = Math.max(0, num(inp.costiAnnui) || 0);
    const ivaCosti = Math.max(0, num(inp.ivaCosti) || 0);
    const amm = inp.beneficiario === 'amministratore';
    const out = { caso: '', imposte: { perc: null, testo: '', importo: null }, iva: { perc: 40, testo: '', detraibile: null, indetraibile: null }, limiti: [], note: [] };
    const ben = res && !res.errore ? res.imponibile : 0;
    const maggior = res && !res.errore ? res.giorni > res.giorniAnno / 2 : true;
    const limite = LIMITI[inp.titolo || ''];

    if (!amm) {
      if (maggior) {
        out.caso = 'Uso promiscuo al dipendente per la maggior parte del periodo d\'imposta';
        out.imposte = { perc: 70, testo: '70% dei costi (art. 164, c. 1, lett. b-bis Tuir), a prescindere dal valore dell\'auto e dal fringe benefit', importo: costi ? r2(costi * 0.7) : null };
        if (inp.addebito) { out.iva.perc = 100; out.iva.testo = 'Iva integralmente detraibile: al dipendente è addebitato uno specifico corrispettivo con fattura (veicolo considerato utilizzato esclusivamente nell\'impresa).'; }
        else out.iva.testo = 'Iva detraibile al 40% (art. 19-bis1 DPR 633/72); sale al 100% se si addebita al dipendente un corrispettivo con fattura.';
      } else {
        out.caso = 'Auto assegnata per meno della metà del periodo d\'imposta';
        out.imposte = { perc: 20, testo: '20% dei costi (art. 164, c. 1, lett. b Tuir): non vale il 70% perché l\'assegnazione non copre la maggior parte del periodo', importo: costi ? r2(costi * 0.2) : null };
        out.limiti.push(limite);
        out.iva.testo = 'Iva detraibile al 40%.';
      }
    } else if (inp.usoAmm === 'personale') {
      out.caso = 'Amministratore / co.co.co. — uso esclusivamente personale';
      out.imposte = { perc: null, testo: 'Deducibile il compenso in natura (art. 95, c. 5 Tuir), entro le spese sostenute: nessuna ulteriore deduzione', importo: costi ? r2(Math.min(ben, costi)) : null };
      out.iva.testo = 'Iva detraibile al 40% secondo la regola generale sui veicoli non strumentali (caso non trattato espressamente nell\'ebook: verifica).';
    } else if (inp.usoAmm === 'aziendale') {
      out.caso = 'Amministratore / co.co.co. — uso esclusivamente aziendale';
      out.imposte = { perc: 20, testo: '20% dei costi con limite di costo (art. 164, c. 1, lett. b Tuir), se l\'uso è inerente all\'attività', importo: costi ? r2(costi * 0.2) : null };
      out.limiti.push(limite);
      out.iva.testo = 'Iva detraibile al 40%.';
    } else {
      out.caso = 'Amministratore / co.co.co. — uso promiscuo';
      let imp = null, formula = 'Deducibile il compenso in natura erogato (art. 95, c. 5) più il 20% dell\'eccedenza delle spese su tale compenso (art. 164, c. 1, lett. b), con limite di costo';
      if (costi) {
        const base = Math.min(ben, costi);
        imp = r2(base + Math.max(0, costi - ben) * 0.2);
        formula += `: ${base.toLocaleString('it-IT', { minimumFractionDigits: 2 })} + 20% × ${Math.max(0, r2(costi - ben)).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
      }
      out.imposte = { perc: null, testo: formula, importo: imp };
      out.limiti.push(limite);
      out.note.push('Nei "costi annui" indica l\'importo già ridotto dei limiti di costo sull\'ammortamento/canone (nell\'esempio dell\'ebook, p. 43, 12.019 € e non 20.000 €).');
      out.iva.testo = 'Iva detraibile al 40%.';
    }
    if (ivaCosti) {
      out.iva.detraibile = r2(ivaCosti * out.iva.perc / 100);
      out.iva.indetraibile = r2(ivaCosti - out.iva.detraibile);
    }
    return out;
  }

  /** Regime applicabile + confronto con gli altri regimi calcolati sugli stessi dati. */
  function calcola(inp, regole) {
    const cat = CATEGORIE[inp.categoria];
    if (cat && !cat.forfait) {
      return { errore: 'Questo tipo di mezzo non rientra nel metodo forfetario dell\'art. 51, c. 4, lett. a) Tuir (autovetture, autoveicoli per trasporto promiscuo, autocaravan, motocicli, ciclomotori). Il benefit va valorizzato secondo il "valore normale" (art. 9 Tuir).' };
    }
    const amm = inp.beneficiario === 'amministratore';
    if (amm && inp.usoAmm === 'aziendale') {
      const ga = giorniNellAnno(inp.anno);
      const gg = giorniAssegnazione(inp.anno, inp.inizio || inp.dataContratto, inp.fine);
      return {
        regime: { chiave: 'nessuno', avvisi: [], motivo: 'Veicolo utilizzato dall\'amministratore soltanto per uso aziendale: non c\'è alcun reddito in natura da assoggettare a tassazione.' },
        chiave: 'nessuno', perc: null, valoreAnnuo: 0, giorni: gg, giorniAnno: ga, proRata: 0, trattenuta: 0, imponibile: 0, maggiorazioni: [], passi: [], confronto: [],
      };
    }
    if (amm && inp.usoAmm === 'personale') {
      const n = calcolaNormale({ ...inp, personale: true }, regole);
      if (n.errore) return { errore: n.errore };
      return {
        regime: { chiave: 'normale', avvisi: [], motivo: 'Uso esclusivamente personale dell\'amministratore: non si tratta di uso promiscuo, quindi non si applica il forfait ACI. Il compenso in natura è determinato al valore normale (art. 9 Tuir).' },
        ...n, confronto: [],
      };
    }
    const reg = determinaRegime(inp);
    if (reg.errore) return { errore: reg.errore };
    const forfait = calcolaRegime(reg.chiave, inp, regole);
    const normale = reg.valoreNormale && num(inp.canone) > 0 ? calcolaNormale(inp, regole) : null;
    let principale = forfait;
    if (normale) {
      principale = normale;
      reg.chiave = 'normale';
      reg.motivo = 'Veicolo usato assegnato quando la norma richiedeva la "nuova immatricolazione": il forfait ACI non si applica e il benefit è valorizzato al valore normale (art. 9 Tuir), come chiarito dall\'Agenzia (Telefisco 2021): canone di leasing/noleggio scorporato dall\'indennità chilometrica ACI per i km nell\'interesse del datore di lavoro.';
    } else if (reg.valoreNormale && !forfait.errore) {
      reg.avvisi.push('Importo indicativo calcolato con il forfait ACI: inserisci canone e chilometri di lavoro per ottenere il valore normale.');
    }
    const lista = ['pre2020', 'co2', 'nuovo'].map((k) => ({ chiave: k, applicabile: !normale && k === reg.chiave, ...calcolaRegime(k, inp, regole) }));
    if (normale) lista.unshift({ ...normale, applicabile: true });
    else if (reg.valoreNormale && num(inp.canone) > 0) lista.unshift({ ...calcolaNormale(inp, regole), applicabile: false });
    return { regime: reg, ...principale, confronto: lista };
  }

  const api = { calcolaNormale, deducibilita, num, DATE_REGIMI, REGOLE_DEFAULT, REGIMI, ALIMENTAZIONI, CATEGORIE, r2, anno, giorniNellAnno, giorniAssegnazione, regoleAnno, determinaRegime, calcolaRegime, calcola };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FB = api;
})(typeof window !== 'undefined' ? window : globalThis);
