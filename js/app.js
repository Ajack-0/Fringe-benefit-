/* Interfaccia: calcolo guidato, parco auto, guida, tabelle ACI, aggiornamento annuale. */
(function () {
  'use strict';
  const { REGOLE_DEFAULT, REGIMI, ALIMENTAZIONI, CATEGORIE, r2 } = FB;

  // ---------- utilità ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  const n4 = (n) => Number(n).toFixed(4).replace('.', ',');
  const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage non disponibile */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
  };
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function scarica(nome, contenuto, tipo = 'text/plain') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenuto], { type: `${tipo};charset=utf-8` }));
    a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((x, k) => x[k], o)[l] = v; };

  /** Porta i costi del formato precedente (un solo totale) nei campi separati del passo "Costi e Iva". */
  function migraCosti(d) {
    const legacy = FB.num(d.costiAnnui) > 0 && !['prezzoAcquisto', 'ivaAcquisto', 'canoneAnnuo', 'ivaCanone', 'altriCosti', 'ivaAltri', 'ammManuale'].some((k) => d[k] !== '' && d[k] != null);
    if (!legacy) return d;
    const C = FB.num(d.costiAnnui), Q = Math.min(FB.num(d.quotaBene) || 0, C), V = FB.num(d.ivaCosti) || 0;
    const ivaQ = d.titolo === 'acquisto' || !C ? 0 : FB.r2(V * Q / C);
    const out = { ...d, altriCosti: String(FB.r2(C - Q)), ivaAltri: V ? String(FB.r2(V - ivaQ)) : '', costiAnnui: '', ivaCosti: '', quotaBene: '' };
    if (Q) { if (d.titolo === 'acquisto') out.ammManuale = String(Q); else { out.canoneAnnuo = String(Q); out.ivaCanone = ivaQ ? String(ivaQ) : ''; } }
    return out;
  }

  // ---------- stato ----------
  const nuoviDati = () => ({
    targa: '', marca: '', modello: '', dataImm: '', categoria: 'autovettura', alim: '', co2: '', cc: '', kw: '', posti: '',
    dataContratto: '', dataOrdine: '', aciKey: '', aciLabel: '', ck: '', ckManuale: false,
    inizio: '', fine: '', trattenuta: '', accessori: false, dipendente: '', azienda: '',
    beneficiario: 'dipendente', usoAmm: 'promiscuo', canone: '', metodoScorporo: 'km', kmLavoro: '', tariffaKm: '', percAziendale: '',
    titolo: '', addebito: false, costoVeicolo: '',
    prezzoAcquisto: '', ivaAcquisto: '', annoAcquisto: '', ammManuale: '', canoneAnnuo: '', ivaCanone: '', altriCosti: '', ivaAltri: '',
    costiAnnui: '', ivaCosti: '', quotaBene: '', // formato precedente (veicoli salvati prima della versione con passo "Costi e Iva")
  });
  const S = {
    tab: 'calcolo', anno: null,
    regole: unisciRegole(LS.get('fb.regole', null)),
    flotta: LS.get('fb.flotta', []),
    step: 1, d: migraCosti({ ...nuoviDati(), ...LS.get('fb.bozza', {}) }), editId: null,
    q: '', qChiave: null, qSolo: true, qProd: true,
    aci: { anno: null, q: '', alim: '', prod: false },
    regSel: null, imp: null,
  };
  /**
   * Regole salvate dall'utente + versioni predefinite che l'utente non ha (es. una nuova versione
   * "dal 2027" rilasciata nel codice): le sue modifiche restano, le novità arrivano comunque.
   */
  function unisciRegole(salvate) {
    if (!Array.isArray(salvate) || !salvate.length) return clone(REGOLE_DEFAULT);
    const nuove = REGOLE_DEFAULT.filter((d) => !salvate.some((x) => x.dal === d.dal)).map(clone);
    return [...salvate, ...nuove];
  }
  /** Id interno di un veicolo: solo lettere minuscole e cifre, altrimenti se ne genera uno nuovo. */
  const idSicuro = (id) => (typeof id === 'string' && /^[a-z0-9]{1,40}$/.test(id) ? id : uid());
  /** Dati di un veicolo da backup: solo i campi previsti, come testo o sì/no. */
  function datiSicuri(d) {
    const base = nuoviDati(), out = { ...base };
    for (const k of Object.keys(base)) {
      if (!(k in d)) continue;
      const v = d[k];
      out[k] = typeof base[k] === 'boolean' ? v === true : (v == null ? '' : String(v).slice(0, 200));
    }
    if (d.ck != null && d.ck !== '') out.ck = String(d.ck).slice(0, 20);
    return out;
  }
  const salvaBozza = () => LS.set('fb.bozza', S.d);
  const salvaFlotta = () => { LS.set('fb.flotta', S.flotta); $('#n-flotta').textContent = S.flotta.length; };

  // ---------- utilità sul tipo di utilizzatore ----------
  const isAmm = (d) => d.beneficiario === 'amministratore';
  const regimeDi = (d) => (d.dataContratto ? FB.determinaRegime({ dataContratto: d.dataContratto, dataOrdine: d.dataOrdine, dataImmatricolazione: d.dataImm, anno: S.anno }) : null);
  const personaleAmm = (d) => isAmm(d) && d.usoAmm === 'personale';
  const aziendaleAmm = (d) => isAmm(d) && d.usoAmm === 'aziendale';
  /** Servono canone e km di lavoro (valore normale)? */
  const serveNormale = (d) => {
    if (aziendaleAmm(d)) return false;
    if (personaleAmm(d)) return true;
    const r = regimeDi(d);
    return !!(r && r.valoreNormale);
  };
  const percTxt = (x) => (x == null ? '' : `${x}%`);

  // ---------- calcolo di un veicolo ----------
  function calcolaVeicolo(d, anno) {
    let ck = FB.num(d.ck, false) || 0, riga = null, mancante = false;
    if (d.aciKey && !d.ckManuale) {
      riga = ACI.perChiave(anno, d.aciKey);
      if (riga) ck = riga.ck; else mancante = true;
    }
    const inp = {
      anno, dataImmatricolazione: d.dataImm, dataContratto: d.dataContratto, dataOrdine: d.dataOrdine, alim: d.alim,
      categoria: d.categoria, co2: d.co2, ck, inizio: d.inizio, fine: d.fine, trattenuta: d.trattenuta, accessori: d.accessori,
      beneficiario: d.beneficiario, usoAmm: isAmm(d) ? d.usoAmm : '', canone: d.canone, metodoScorporo: d.metodoScorporo, kmLavoro: d.kmLavoro, tariffaKm: d.tariffaKm, percAziendale: d.percAziendale,
      titolo: d.titolo, addebito: d.addebito, costoVeicolo: d.titolo === 'leasing' ? d.costoVeicolo : '',
      prezzoAcquisto: d.prezzoAcquisto, ivaAcquisto: d.ivaAcquisto, annoAcquisto: d.annoAcquisto, ivaCanone: d.titolo === 'acquisto' ? '' : d.ivaCanone,
      quotaBene: d.titolo === 'acquisto' ? d.ammManuale : d.canoneAnnuo, altriCosti: d.altriCosti, ivaAltri: d.ivaAltri,
      costiAnnui: d.costiAnnui, ivaCosti: d.ivaCosti,
    };
    return { inp, riga, mancante, ck, res: FB.calcola(inp, S.regole) };
  }
  const nomeVeicolo = (d) => [d.targa, d.marca, d.modello].filter(Boolean).join(' ') || 'Veicolo senza nome';

  // ---------- libretto ----------
  const LIB = [
    ['A', 'Targa', 'AB 123 CD', 'targa'], ['B', 'Data prima immatricolazione', '15.03.2021', 'dataImm'],
    ['D.1', 'Marca', 'FIAT', 'marca'], ['D.3', 'Denominazione commerciale', 'PANDA 1.0 HYBRID', 'modello', 1],
    ['J', 'Categoria del veicolo', 'M1', 'categoria'], ['S.1', 'Posti a sedere (con conducente)', '5', 'posti'],
    ['P.1', 'Cilindrata (cm³)', '999', 'cc'], ['P.2', 'Potenza netta massima (kW)', '51', 'kw'],
    ['P.3', 'Alimentazione', 'BENZINA', 'alim'], ['V.7', 'Emissioni CO₂ (g/km)', '88,0', 'co2'],
  ];
  const libretto = () => `<aside class="lib" aria-label="Dove trovare i dati sul libretto">
    <h3>Carta di circolazione (libretto)</h3>
    <div class="lib-g">${LIB.map(([c, l, v, f, w]) => `<div class="lib-c${w ? ' w2' : ''}" data-lf="${f}"><b>(${c})</b>${esc(l)}<span>${esc(v)}</span></div>`).join('')}</div>
    <small>Valori d'esempio. Quando selezioni un campo del modulo, qui si evidenzia la casella corrispondente sul tuo documento.</small></aside>`;
  const evidenzia = (f) => $$('.lib-c').forEach((el) => el.classList.toggle('on', el.dataset.lf === f));

  // ---------- campi ----------
  function campo({ f, label, code, type = 'text', hint = '', opts = null, attrs = '', err = '', wrapId = '', hidden = false }) {
    const v = S.d[f] ?? '';
    let ctl;
    if (opts) ctl = `<select id="f-${f}" data-f="${f}">${opts.map(([val, t]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    else ctl = `<input id="f-${f}" data-f="${f}" type="${type}" value="${esc(v)}" ${attrs}>`;
    return `<div class="f${err ? ' err' : ''}" ${wrapId ? `id="${wrapId}"` : ''} ${hidden ? 'hidden' : ''}>
      <label for="f-${f}">${label}${code ? `<span class="code">${code}</span>` : ''}</label>${ctl}
      ${hint ? `<span class="hint">${hint}</span>` : ''}${err ? `<span class="errmsg">${esc(err)}</span>` : ''}</div>`;
  }
  const checkbox = ({ f, label, hint = '', wrapId = '', hidden = false }) => `<div class="check" ${wrapId ? `id="${wrapId}"` : ''} ${hidden ? 'hidden' : ''}>
    <input type="checkbox" id="f-${f}" data-f="${f}" ${S.d[f] ? 'checked' : ''}><label for="f-${f}"><b>${label}</b>${hint ? `<br><span class="hint">${hint}</span>` : ''}</label></div>`;

  // ---------- validazione dei passi ----------
  function valida(step) {
    const d = S.d, e = {};
    if (step === 1) {
      if (!d.dataImm) e.dataImm = 'Indica la data di prima immatricolazione (campo B).';
      if (!d.alim) e.alim = 'Seleziona l\'alimentazione (campo P.3).';
      if (d.co2 !== '' && !(FB.num(d.co2, false) >= 0)) e.co2 = 'Valore non valido.';
    }
    if (step === 2) {
      if (!d.dataContratto) e.dataContratto = 'Indica la data di stipula dell\'atto di assegnazione.';
      if (!e.dataContratto) {
        const reg = regimeDi(d);
        if (reg.chiave === 'co2' && d.alim !== 'elettrico' && d.co2 === '' && !personaleAmm(d) && !aziendaleAmm(d)) e.co2 = 'Per il regime CO₂ serve il valore del campo V.7.';
      }
    }
    if (step === 3 && !(FB.num(d.ck, false) > 0) && !personaleAmm(d) && !aziendaleAmm(d)) e.ck = 'Seleziona il modello dalla tabella ACI oppure inserisci il costo chilometrico.';
    if (step === 4) {
      if (d.inizio && d.fine && d.inizio > d.fine) e.fine = 'La data di fine è precedente all\'inizio.';
      if (d.trattenuta !== '' && !(FB.num(d.trattenuta) >= 0)) e.trattenuta = 'Importo non valido.';
      if (personaleAmm(d) && !(FB.num(d.canone) > 0)) e.canone = 'Per l\'uso personale indica il costo annuo del veicolo (valore normale).';
      for (const f of ['canone', 'kmLavoro', 'tariffaKm']) if (d[f] !== '' && !e[f] && !(FB.num(d[f], f !== 'tariffaKm') >= 0)) e[f] = 'Importo non valido.';
      if (d.metodoScorporo === 'perc' && d.percAziendale !== '' && !(FB.num(d.percAziendale, false) >= 0 && FB.num(d.percAziendale, false) <= 100)) e.percAziendale = 'Indica una percentuale tra 0 e 100.';
    }
    if (step === 5) {
      for (const f of ['prezzoAcquisto', 'ivaAcquisto', 'ammManuale', 'canoneAnnuo', 'ivaCanone', 'costoVeicolo', 'altriCosti', 'ivaAltri']) if (d[f] !== '' && !(FB.num(d[f]) >= 0)) e[f] = 'Importo non valido: scrivi solo il numero, es. 1.250,00.';
      if (d.annoAcquisto !== '' && !(Number(d.annoAcquisto) >= 1990 && Number(d.annoAcquisto) <= S.anno + 1)) e.annoAcquisto = 'Anno non valido.';
      if (FB.num(d.ivaAcquisto) > FB.num(d.prezzoAcquisto) * 0.3) e.ivaAcquisto = 'L\'Iva sembra troppo alta rispetto al prezzo: inserisci il prezzo senza Iva e l\'Iva a parte.';
    }
    return e;
  }
  const puoAndare = (i) => { for (let j = 1; j < i; j++) if (Object.keys(valida(j)).length) return false; return true; };

  const regoleCorrenti = () => FB.regoleAnno(S.regole, S.anno);
  function testoAnzianita() {
    const R = regoleCorrenti();
    return R && R.anzianita.attiva ? `Stabilisce l'anzianità: nel ${S.anno} +${R.anzianita.perc}% dopo il 31.12 del ${R.anzianita.anni}° anno successivo all'immatricolazione.` : 'Stabilisce l\'anzianità del veicolo.';
  }
  function testoAccessori() {
    const R = regoleCorrenti();
    return R && R.accessori.attiva ? `Nel ${S.anno} il valore è maggiorato del ${R.accessori.perc}% (solo nuovo regime).` : `Nel ${S.anno} non è prevista maggiorazione.`;
  }

  // ---------- CALCOLO GUIDATO ----------
  const PASSI = [['Veicolo', 'dal libretto'], ['Assegnazione', 'utilizzatore e date'], ['Modello ACI', 'costo al km'], ['Periodo', 'e trattenute'], ['Costi e Iva', 'facoltativo'], ['Risultato', 'e confronto']];

  function renderCalcolo(errs = {}) {
    const root = $('#tab-calcolo');
    const stepsHtml = `<div class="steps">${PASSI.map(([t, s], i) => {
      const n = i + 1, cls = n === S.step ? 'on' : (n < S.step ? 'done' : '');
      return `<button class="step ${cls}" data-go="${n}" ${n > S.step && !puoAndare(n) ? 'disabled' : ''}><small>Passo ${n}</small><b>${t}</b>${s}</button>`;
    }).join('')}</div>`;
    const corpo = [null, passo1, passo2, passo3, passo4, passoCosti, passo5][S.step](errs);
    root.innerHTML = stepsHtml + corpo;
    ({ 1: dyn1, 2: dyn2, 3: dyn3, 4: dyn4, 5: dyn5 }[S.step] || (() => {}))();
  }

  const navBtns = (avanti = 'Avanti →', extra = '') => `<div class="actions"><div>${S.step > 1 ? '<button class="btn ghost" data-nav="-1">← Indietro</button>' : ''}</div><div class="r">${extra}<button class="btn" data-nav="1">${avanti}</button></div></div>`;

  function passo1(e) {
    return `<div class="cols"><div class="card">
      <h2>1. Il veicolo</h2>
      <div class="need"><b>Cosa ci serve:</b> la carta di circolazione (il "libretto") dell'auto.
        <ul><li><b>B</b> – data di prima immatricolazione</li><li><b>J</b> – categoria e <b>P.3</b> – alimentazione</li>
        <li><b>V.7</b> – emissioni di CO₂ (necessaria solo se l'auto è stata assegnata prima del 2025)</li>
        <li><b>D.1 / D.3 / P.2</b> – marca, modello e potenza: ci servono per trovare l'auto nella tabella ACI</li></ul></div>
      <div class="row2">
        ${campo({ f: 'targa', label: 'Targa', code: 'A', attrs: 'autocomplete="off" placeholder="AB123CD"', hint: 'Facoltativa: serve solo a riconoscere l\'auto nel parco auto.' })}
        ${campo({ f: 'dataImm', label: 'Data di prima immatricolazione', code: 'B', type: 'date', err: e.dataImm, hint: testoAnzianita() })}
      </div>
      <div class="row2">
        ${campo({ f: 'marca', label: 'Marca', code: 'D.1', attrs: 'autocomplete="off" placeholder="es. Volkswagen"' })}
        ${campo({ f: 'modello', label: 'Modello', code: 'D.3', attrs: 'autocomplete="off" placeholder="es. Golf 1.5 TSI 150CV"' })}
      </div>
      ${campo({ f: 'categoria', label: 'Tipo di veicolo', code: 'J · J.2', opts: Object.entries(CATEGORIE).map(([k, v]) => [k, v.nome]), hint: 'J = M1 è un\'autovettura; N1 è un autocarro (nel forfait solo se è per trasporto promiscuo di persone e cose); L indica moto e ciclomotori.' })}
      <div id="dyn1-cat"></div>
      ${campo({ f: 'alim', label: 'Alimentazione', code: 'P.3', err: e.alim, opts: [['', '— seleziona —'], ...Object.entries(ALIMENTAZIONI).map(([k, v]) => [k, v.nome])], hint: 'Sul libretto: BENZ = benzina, DIESEL = gasolio, ELETTR = elettrico. Gli ibridi riportano due alimentazioni (es. BENZ/ELETTR): se si ricaricano anche dalla presa sono <b>plug-in</b>.' })}
      <div class="row2">
        ${campo({ f: 'co2', label: 'Emissioni di CO₂ (g/km)', code: 'V.7', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 88,0"', err: e.co2, hint: 'Obbligatoria solo per le auto assegnate dal 1.07.2020 al 31.12.2024 (e ordinate entro il 2024). Per i veicoli elettrici lascia vuoto.' })}
        ${campo({ f: 'kw', label: 'Potenza netta massima (kW)', code: 'P.2', type: 'number', attrs: 'min="0" step="1" inputmode="numeric"', hint: '<span id="kw-cv">Le tabelle ACI indicano la potenza in CV (1 kW ≈ 1,36 CV).</span>' })}
      </div>
      <div class="row2">
        ${campo({ f: 'cc', label: 'Cilindrata (cm³)', code: 'P.1', type: 'number', attrs: 'min="0" step="1" inputmode="numeric"', hint: 'Facoltativa, aiuta a riconoscere la versione.' })}
        ${campo({ f: 'posti', label: 'Posti a sedere', code: 'S.1', type: 'number', attrs: 'min="1" step="1" inputmode="numeric"', hint: 'Facoltativo: il forfait vale fino a 9 posti, conducente compreso.' })}
      </div>
      <div id="dyn1-posti"></div>
      ${navBtns()}
    </div>${libretto()}</div>`;
  }
  function dyn1() {
    const d = S.d;
    $('#dyn1-cat').innerHTML = CATEGORIE[d.categoria] && !CATEGORIE[d.categoria].forfait
      ? '<div class="note bad"><p><b>Attenzione:</b> questo tipo di mezzo non rientra nel metodo forfetario ACI. Il benefit si valorizza al "valore normale" (art. 9 Tuir). Il calcolo non sarà disponibile.</p></div>' : '';
    $('#dyn1-posti').innerHTML = Number(d.posti) > 9 ? '<div class="note warn"><p>Con più di 9 posti (conducente compreso) il veicolo non è un\'autovettura ai sensi dell\'art. 54 C.d.S.: verifica l\'inquadramento.</p></div>' : '';
    const cv = $('#kw-cv');
    if (cv) cv.textContent = Number(d.kw) > 0 ? `≈ ${Math.round(Number(d.kw) * 1.35962)} CV (le tabelle ACI indicano la potenza in CV, es. "150CV").` : 'Le tabelle ACI indicano la potenza in CV (1 kW ≈ 1,36 CV).';
  }

  function passo2(e) {
    return `<div class="card"><h2>2. L'assegnazione al dipendente</h2>
      <div class="need"><b>Cosa ci serve:</b> chi usa l'auto e la data in cui è stato firmato l'atto di assegnazione (lettera o contratto di assegnazione).
        È questa data – <u>non</u> quella di immatricolazione – a stabilire quale disciplina si applica.</div>
      ${campo({ f: 'beneficiario', label: 'Chi usa l\'auto?', opts: [['dipendente', 'Dipendente'], ['amministratore', 'Amministratore o collaboratore coordinato e continuativo (co.co.co.)']], hint: 'Il reddito in natura si calcola allo stesso modo (redditi assimilati al lavoro dipendente); cambia la deducibilità per la società.' })}
      ${campo({ f: 'usoAmm', label: 'Come usa l\'auto l\'amministratore?', opts: [['promiscuo', 'Uso promiscuo (aziendale e personale)'], ['personale', 'Solo uso personale'], ['aziendale', 'Solo uso aziendale']], wrapId: 'w-usoamm', hidden: true, hint: 'Promiscuo: forfait ACI. Solo personale: valore normale. Solo aziendale: nessun reddito in natura.' })}
      <div class="row2">
        ${campo({ f: 'dataContratto', label: 'Data dell\'atto di assegnazione', type: 'date', err: e.dataContratto, hint: 'Se l\'auto è stata riassegnata a un altro dipendente, indica la data del <b>primo</b> contratto valido per il regime.' })}
        ${campo({ f: 'dataOrdine', label: 'Data dell\'ordine del veicolo al concessionario / locatore', type: 'date', wrapId: 'w-ordine', hidden: true, hint: 'Per le assegnazioni del 2025: se l\'auto è stata <b>ordinata entro il 31.12.2024</b> resta il vecchio regime CO₂.' })}
      </div>
      ${campo({ f: 'co2', label: 'Emissioni di CO₂ (g/km)', code: 'V.7', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 88,0"', wrapId: 'w-co2', hidden: true, err: e.co2, hint: 'Nel regime CO₂ la percentuale dipende dalle emissioni: ≤ 60 → 25%, ≤ 160 → 30%, ≤ 190 → 50%, oltre → 60%.' })}
      <div id="regime-box"></div>
      ${navBtns()}</div>`;
  }
  function dyn2() {
    const d = S.d;
    const anno = d.dataContratto ? FB.anno(d.dataContratto) : 0;
    $('#w-ordine').hidden = anno !== 2025;
    $('#w-usoamm').hidden = !isAmm(d);
    const reg = regimeDi(d);
    $('#w-co2').hidden = !(reg && reg.chiave === 'co2') || personaleAmm(d) || aziendaleAmm(d);
    if (aziendaleAmm(d)) { $('#regime-box').innerHTML = '<div class="note ok"><p><b>Nessun reddito in natura.</b> L\'auto è usata dall\'amministratore soltanto per uso aziendale: non c\'è nulla da assoggettare a tassazione. Resta la deducibilità dei costi per la società (passo 4).</p></div>'; return; }
    if (personaleAmm(d)) { $('#regime-box').innerHTML = '<div class="note ok"><p><b>Disciplina applicabile: valore normale (art. 9 Tuir).</b></p><p>Uso esclusivamente personale: non è uso promiscuo, quindi il forfait ACI non si applica. Al passo 4 ti chiediamo il costo annuo del veicolo.</p></div>'; return; }
    $('#regime-box').innerHTML = reg
      ? `<div class="note ok"><p><b>Disciplina applicabile: ${esc(REGIMI[reg.chiave].nome)}</b></p><p>${esc(reg.motivo)}</p></div>${reg.avvisi.map((a) => `<div class="note warn"><p>${esc(a)}</p></div>`).join('')}`
      : '<div class="note"><p>Inserisci la data dell\'atto di assegnazione: ti diciamo subito quale regola si applica.</p></div>';
  }

  function passo3(e) {
    const d = S.d;
    const chiaveRicerca = `${d.marca}|${d.modello}|${d.alim}`;
    if (S.qChiave !== chiaveRicerca) { S.q = `${d.marca} ${d.modello}`.trim(); S.qChiave = chiaveRicerca; }
    return `<div class="card"><h2>3. Il modello nella tabella ACI</h2>
      <div class="need"><b>Cosa ci serve:</b> trovare l'auto nelle tabelle ACI ${S.anno} (Gazzetta Ufficiale). Da lì prendiamo il <b>costo chilometrico di esercizio su 15.000 km</b>.
        Cerca per marca e modello; ricorda che la potenza è indicata in CV. Se il modello esatto manca, scegli quello <b>più simile per caratteristiche</b>, oppure inserisci il costo a mano.</div>
      <div class="f"><label for="q">Cerca marca / modello</label><input type="search" id="q" value="${esc(S.q)}" placeholder="es. golf 1.5 tsi 150"></div>
      <div class="check"><input type="checkbox" id="q-solo" ${S.qSolo ? 'checked' : ''}><label for="q-solo">Solo alimentazione indicata (${esc(ALIMENTAZIONI[d.alim]?.nome || '—')})</label></div>
      <div class="check"><input type="checkbox" id="q-prod" ${S.qProd ? 'checked' : ''}><label for="q-prod">Includi i modelli fuori produzione (utile per auto assegnate da anni)</label></div>
      <p class="muted" id="q-n"></p>
      <div class="res" id="q-res"></div>
      <div id="q-sel" style="margin-top:12px"></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      ${checkbox({ f: 'ckManuale', label: 'Non trovo il modello: inserisco il costo chilometrico a mano', hint: 'Valore "Costo km 15.000 km" della tabella ACI del modello più simile (€/km, 4 decimali).' })}
      ${campo({ f: 'ck', label: 'Costo chilometrico ACI su 15.000 km (€/km)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 0,5777"', wrapId: 'w-ck', err: e.ck, hidden: !d.ckManuale })}
      ${e.ck && !d.ckManuale ? `<div class="errmsg">${esc(e.ck)}</div>` : ''}
      ${navBtns()}</div>`;
  }
  function dyn3() {
    const d = S.d;
    const cat = d.categoria === 'autocaravan' ? ['autocaravan'] : (/motociclo|ciclomotore/.test(d.categoria) ? ['moto'] : null);
    const alim = S.qSolo && d.alim && ALIMENTAZIONI[d.alim].aci.length ? ALIMENTAZIONI[d.alim].aci : null;
    const filtro = cat || alim;
    const r = ACI.cerca(S.anno, { testo: S.q, alim: filtro, soloInProduzione: !S.qProd });
    $('#q-n').textContent = r.totale ? `${r.totale} modelli trovati${r.totale > r.righe.length ? ` (primi ${r.righe.length}: restringi la ricerca)` : ''}.` : 'Nessun modello trovato: prova con meno parole o togli il filtro sull\'alimentazione.';
    $('#q-res').innerHTML = r.righe.map((x) => {
      const k = ACI.chiave(x);
      return `<button type="button" data-aci="${esc(k)}" class="${S.d.aciKey === k && !S.d.ckManuale ? 'sel' : ''}"><span><b>${esc(x.marca)}</b> ${esc(x.modello)}<span class="tag">${esc(ACI.ALIM_ETICHETTE[x.alim])}</span>${x.prod ? '' : '<span class="tag">fuori produzione</span>'}</span><span class="num">${n4(x.ck)} €/km</span></button>`;
    }).join('') || '';
    $('#q-res').style.display = d.ckManuale || !r.righe.length ? 'none' : '';
    const sel = d.aciKey && !d.ckManuale ? ACI.perChiave(S.anno, d.aciKey) : null;
    $('#q-sel').innerHTML = sel ? `<div class="note ok"><p><b>Selezionato:</b> ${esc(sel.marca)} ${esc(sel.modello)} — ${n4(sel.ck)} €/km (tabella ${S.anno})</p></div>`
      : (d.aciKey && !d.ckManuale ? `<div class="note warn"><p>Il modello selezionato (${esc(d.aciLabel)}) non è presente nella tabella ${S.anno}: sceglilo di nuovo o inserisci il costo a mano.</p></div>` : '');
    $('#w-ck').hidden = !d.ckManuale;
  }

  function passo4(e) {
    return `<div class="card"><h2>4. Periodo di assegnazione, trattenute e accessori</h2>
      <div class="need"><b>Cosa ci serve:</b> per quanti giorni dell'anno ${S.anno} l'auto è stata assegnata (il valore va ragguagliato ai giorni, a prescindere dall'uso effettivo) e
        se il dipendente paga qualcosa per l'uso privato (trattenuta in busta paga o canone), perché va sottratto dal valore tassabile.</div>
      <div class="row2">
        ${campo({ f: 'inizio', label: `Assegnata dal (anno ${S.anno})`, type: 'date', hint: 'Se lo lasci vuoto si usa la data dell\'atto di assegnazione (o il 1° gennaio, se è precedente).' })}
        ${campo({ f: 'fine', label: 'Fino al', type: 'date', err: e.fine, hint: 'Lascia vuoto se l\'assegnazione prosegue fino al 31 dicembre.' })}
      </div>
      <div id="dyn4-gg"></div>
      <div id="dyn4-prev"></div>
      <div id="w-normale" hidden>
        <div class="note warn"><p id="normale-txt"></p></div>
        ${campo({ f: 'canone', label: 'Canone annuo di leasing/noleggio, o costo annuo del veicolo (€)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 6.000,00"', err: e.canone, hint: 'Importo pagato dal datore di lavoro per l\'intero anno (verrà ragguagliato ai giorni di assegnazione).' })}
        <div id="w-scorporo">
        ${campo({ f: 'metodoScorporo', label: 'Come distingui l\'uso aziendale da quello privato?', opts: [['km', 'Con i chilometri percorsi per lavoro (× tariffa ACI al km)'], ['perc', 'Con una percentuale di uso aziendale']], hint: 'Si sottrae dal canone la parte che riguarda l\'uso nell\'interesse del datore di lavoro: scegli il dato che hai documentato.' })}
        <div class="row2" id="w-kmlav">
          ${campo({ f: 'kmLavoro', label: 'Km percorsi nell\'interesse del datore di lavoro nell\'anno', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 4.000"', err: e.kmLavoro, hint: 'Dentro e fuori dal Comune della sede di lavoro: documentali (note spese, registro viaggi).' })}
          ${campo({ f: 'tariffaKm', label: 'Tariffa ACI al km (€/km)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="uguale al costo km del modello"', err: e.tariffaKm, hint: 'Se vuoto si usa il costo chilometrico del modello scelto al passo 3.' })}
        </div>
        <div class="row2" id="w-percaz">
          ${campo({ f: 'percAziendale', label: 'Percentuale di uso nell\'interesse del datore di lavoro (%)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 40"', err: e.percAziendale, hint: 'Esempio: 40 significa che il 40% del canone riguarda l\'uso aziendale e il 60% quello privato.' })}
          <div class="note"><p>Il metodo indicato dall'Agenzia (Telefisco 2021) è quello dei chilometri. La percentuale è un'alternativa: deve basarsi su elementi oggettivi e documentati (es. registro dei viaggi, rapporto km aziendali / km totali).</p></div>
        </div>
        </div>
      </div>
      ${campo({ f: 'trattenuta', label: 'Importo trattenuto o pagato dal dipendente nell\'anno (€, Iva inclusa)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="0,00"', err: e.trattenuta, hint: 'Se è previsto un canone o un prezzo per l\'uso privato, il reddito è la differenza tra valore forfetario e quanto versato (al lordo dell\'Iva). Se cambi anno d\'imposta nel parco auto l\'importo viene riproposto uguale: aggiornalo.' })}
      <div id="acc-info"></div>
      ${checkbox({ f: 'accessori', label: 'L\'auto ha accessori o allestimenti non valorizzati nelle tabelle ACI e non acquistati direttamente dal dipendente', hint: `${testoAccessori()} Es. optional montati dal concessionario non compresi nella versione ACI.`, wrapId: 'w-acc' })}
      <div class="row2">
        ${campo({ f: 'dipendente', label: 'Utilizzatore (facoltativo)', attrs: 'autocomplete="off"' })}
        ${campo({ f: 'azienda', label: 'Azienda (facoltativo)', attrs: 'autocomplete="off"' })}
      </div>
      ${navBtns()}</div>`;
  }
  function dyn4() {
    const d = S.d;
    const gg = FB.giorniAssegnazione(S.anno, d.inizio || d.dataContratto, d.fine), ga = FB.giorniNellAnno(S.anno);
    $('#dyn4-gg').innerHTML = `<div class="note"><p>Giorni di assegnazione nel ${S.anno}: <b>${gg}</b> su ${ga}${gg === 0 ? ' — controlla le date: nessun giorno cade nell\'anno scelto.' : ''}</p></div>`;
    const reg = regimeDi(d);
    const R = FB.regoleAnno(S.regole, S.anno);
    const accAttivo = !!(R && R.accessori.attiva);
    const nuovo = !!(reg && reg.chiave === 'nuovo') && !serveNormale(d) && !aziendaleAmm(d);
    $('#w-acc').hidden = !(nuovo && accAttivo);
    $('#acc-info').innerHTML = !reg || serveNormale(d) || aziendaleAmm(d) ? ''
      : (!nuovo ? '<div class="note"><p>La maggiorazione del 5% per gli accessori non valorizzati riguarda solo il <b>nuovo regime</b> (assegnazioni dal 2025): per questa auto non si applica.</p></div>'
        : (!accAttivo ? `<div class="note"><p>Per l'anno d'imposta ${S.anno} la maggiorazione del 5% per gli accessori <b>non è prevista</b> (vale dal 2026, D.Lgs. 148/2026): nessun effetto sul calcolo.</p></div>` : ''));
    anteprima4();
    $('#w-normale').hidden = !serveNormale(d);
    $('#w-scorporo').hidden = personaleAmm(d);
    $('#w-kmlav').hidden = d.metodoScorporo === 'perc';
    $('#w-percaz').hidden = d.metodoScorporo !== 'perc';
    $('#normale-txt').innerHTML = personaleAmm(d)
      ? '<b>Uso esclusivamente personale:</b> il compenso in natura è il valore normale dell\'auto (art. 9 Tuir). Indica il costo annuo sostenuto dalla società per il veicolo.'
      : '<b>Veicolo usato assegnato quando la norma richiedeva la "nuova immatricolazione".</b> Per l\'Agenzia (Telefisco 2021) il benefit non è forfettario: si prende il canone di leasing/noleggio pagato dal datore di lavoro e si <b>scorpora la parte riferibile all\'uso aziendale</b>, con i km percorsi per lavoro × tariffa ACI oppure con una percentuale di uso aziendale. Se non indichi i dati, l\'app mostra solo il forfait ACI come stima.';
  }

  /** Anteprima viva del calcolo, aggiornata a ogni modifica dei campi del passo 4. */
  function anteprima4() {
    const c = calcolaVeicolo(S.d, S.anno), r = c.res, box = $('#dyn4-prev');
    if (!box) return;
    if (r.errore) { box.innerHTML = `<div class="note warn"><p><b>Anteprima non disponibile:</b> ${esc(r.errore)}</p></div>`; return; }
    const extra = r.maggiorazioni.length ? ` · maggiorazioni: ${r.maggiorazioni.map((m) => (m === 'anzianita' ? `+${r.regola.anzianita.perc}% anzianità` : `+${r.regola.accessori.perc}% accessori`)).join(', ')}` : '';
    box.innerHTML = `<div class="note ok"><p><b>Anteprima del calcolo</b> (${esc(REGIMI[r.regime.chiave].breve)}${r.perc != null ? ' ' + r.perc + '%' : ''}${extra})</p>
      <p>Valore ${r.regime.chiave === 'normale' ? 'del benefit' : 'annuo pieno'}: <b>${eur(r.valoreAnnuo)}</b> · ragguagliato a ${r.giorni}/${r.giorniAnno} giorni: <b>${eur(r.proRata)}</b> · trattenuta: <b>${eur(r.trattenuta)}</b> → <b>imponibile ${eur(r.imponibile)}</b></p></div>`;
  }

  // ---------- passo 5: costi e Iva ----------
  function passoCosti(e) {
    const d = S.d;
    const annoDef = d.dataImm ? FB.anno(d.dataImm) : S.anno;
    return `<div class="card"><h2>5. Costi dell'auto e Iva <small class="muted">(facoltativo)</small></h2>
      <div class="need"><b>A cosa serve:</b> calcolare, per questa targa, quanto l'azienda può <b>dedurre</b> (imposte dirette) e <b>detrarre</b> (Iva). Il fringe benefit del ${isAmm(d) ? 'beneficiario' : 'dipendente'} non cambia: se non ti serve, premi <b>Salta</b>.
        <ul><li>Scrivi gli importi <b>senza Iva</b> (imponibile) e l'<b>Iva a parte</b>, nel campo accanto: la divisione tra detraibile e non detraibile la facciamo noi.</li>
        <li>Indica i costi <b>dell'anno ${S.anno}</b> (es. i 12 canoni dell'anno, il carburante dell'anno), non i totali del contratto.</li>
        <li>Assicurazione e bollo non hanno Iva: mettili negli altri costi e lascia l'Iva com'è.</li></ul></div>
      <div id="iva-spiega"></div>
      ${campo({ f: 'titolo', label: 'Come l\'azienda ha l\'auto', opts: [['', '— non indicato —'], ['acquisto', 'Acquisto (di proprietà)'], ['leasing', 'Leasing'], ['noleggio', 'Noleggio a lungo termine']] })}
      <div id="b-acq" hidden>
        <h3>A. Fattura d'acquisto</h3>
        <div class="row2">
          ${campo({ f: 'prezzoAcquisto', label: 'Prezzo d\'acquisto senza Iva (€)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 30.000,00"', err: e.prezzoAcquisto, hint: 'L\'imponibile della fattura del concessionario.' })}
          ${campo({ f: 'ivaAcquisto', label: 'Iva della fattura d\'acquisto (€)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 6.600,00"', err: e.ivaAcquisto, hint: 'Si detrae nell\'anno d\'acquisto; la parte non detraibile si aggiunge al costo dell\'auto.' })}
        </div>
        <div class="row2">
          ${campo({ f: 'annoAcquisto', label: 'Anno d\'acquisto', attrs: `inputmode="numeric" autocomplete="off" placeholder="${annoDef}"`, err: e.annoAcquisto, hint: `Se vuoto usiamo l'anno di immatricolazione (${annoDef}).` })}
          ${campo({ f: 'ammManuale', label: `Ammortamento ${S.anno} (€) — facoltativo`, attrs: 'inputmode="decimal" autocomplete="off" placeholder="lo calcoliamo noi"', err: e.ammManuale, hint: 'Lascialo vuoto: lo calcoliamo al 25% (12,5% nel primo anno). Compilalo solo se a bilancio hai una quota diversa.' })}
        </div>
        <div id="acq-info"></div>
      </div>
      <div id="b-can" hidden>
        <h3 id="b-can-tit">A. Canoni dell'anno</h3>
        <div class="row2">
          ${campo({ f: 'canoneAnnuo', label: `Canoni del ${S.anno} senza Iva (€)`, attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 6.000,00"', err: e.canoneAnnuo, hint: 'Somma dei canoni di competenza dell\'anno (imponibile).' })}
          ${campo({ f: 'ivaCanone', label: 'Iva sui canoni (€)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 1.320,00"', err: e.ivaCanone, hint: 'L\'Iva delle fatture dei canoni dell\'anno.' })}
        </div>
        ${campo({ f: 'costoVeicolo', label: 'Costo del veicolo indicato nel contratto di leasing (€)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 35.000,00"', err: e.costoVeicolo, wrapId: 'w-costoveicolo', hint: 'Serve per il limite di 18.075,99 €: se il costo è superiore, i canoni sono deducibili in proporzione.' })}
      </div>
      <h3 id="b-altri-tit">B. Altri costi dell'anno</h3>
      <div class="row2">
        ${campo({ f: 'altriCosti', label: `Altri costi del ${S.anno} senza Iva (€)`, attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 3.500,00"', err: e.altriCosti, hint: 'Carburante, manutenzione, pneumatici, assicurazione, bollo, pedaggi…' })}
        ${campo({ f: 'ivaAltri', label: 'Iva sugli altri costi (€)', attrs: 'inputmode="decimal" autocomplete="off" placeholder="es. 600,00"', err: e.ivaAltri, hint: 'Solo l\'Iva effettivamente in fattura (assicurazione e bollo ne sono esenti).' })}
      </div>
      <div id="w-addebito">
        <h3>C. Corrispettivo al dipendente</h3>
        ${checkbox({ f: 'addebito', label: 'Al dipendente è addebitato un corrispettivo con fattura per l\'uso privato', hint: 'Il corrispettivo è l\'importo indicato al passo 4 come trattenuta (Iva inclusa): su di esso l\'azienda emette fattura con Iva. In cambio, se l\'auto è assegnata per più di metà anno, l\'Iva sull\'auto diventa detraibile al 100%.' })}
      </div>
      <div id="dyn5-prev"></div>
      <div class="actions"><div><button class="btn ghost" data-nav="-1">← Indietro</button></div><div class="r"><button class="btn ghost" data-skip="1">Salta</button><button class="btn" data-nav="1">Calcola →</button></div></div></div>`;
  }

  function dyn5() {
    const d = S.d, c = calcolaVeicolo(d, S.anno);
    const t = d.titolo;
    $('#b-acq').hidden = t !== 'acquisto';
    $('#b-can').hidden = !(t === 'leasing' || t === 'noleggio');
    $('#b-can-tit').textContent = t === 'noleggio' ? 'A. Canoni di noleggio dell\'anno' : 'A. Canoni di leasing dell\'anno';
    $('#w-costoveicolo').hidden = t !== 'leasing';
    $('#b-altri-tit').textContent = t ? 'B. Altri costi dell\'anno' : 'Costi dell\'anno';
    $('#w-addebito').hidden = isAmm(d);
    if (c.res.errore) { $('#iva-spiega').innerHTML = ''; $('#dyn5-prev').innerHTML = `<div class="note warn"><p>Completa prima i passi precedenti: ${esc(c.res.errore)}</p></div>`; return; }
    const dd = FB.deducibilita(c.inp, c.res), cc = dd.costi, p = dd.iva.perc;
    // spiegazione in parole semplici, aggiornata alle scelte fatte
    const righe = [
      `<li><b>Percentuale di detrazione:</b> ${esc(dd.iva.testo)}</li>`,
      t === 'acquisto' ? `<li><b>Iva della fattura d'acquisto:</b> il ${p}% si recupera tutto nell'anno d'acquisto; il resto non si recupera, si aggiunge al prezzo e forma il <b>costo dell'auto</b>, che si deduce poco per volta con l'ammortamento.</li>` : '',
      t === 'leasing' || t === 'noleggio' ? `<li><b>Iva sui canoni:</b> il ${p}% si recupera nell'anno; il resto diventa un costo e si somma ai canoni.</li>` : '',
      `<li><b>Iva sugli altri costi:</b> il ${p}% si recupera nell'anno; il resto si somma ai costi.</li>`,
      `<li><b>Imposte dirette:</b> ${esc(dd.imposte.perc != null ? `deducibile il ${dd.imposte.perc}% del totale dei costi così ottenuto` : dd.imposte.testo.split(':')[0])}${dd.imposte.perc === 20 || dd.imposte.perc == null && isAmm(d) && d.usoAmm !== 'personale' ? ', con i limiti di costo (18.075,99 € sul costo dell\'auto in acquisto/leasing, 3.615,20 € annui per il noleggio)' : ''}.</li>`,
      !isAmm(d) && d.addebito ? `<li><b>Iva a debito:</b> dalla trattenuta del dipendente (Iva inclusa) scorporiamo l'Iva al ${(c.res.regola && c.res.regola.aliquotaIva) || 22}% da indicare in fattura e versare.</li>` : '',
    ].join('');
    $('#iva-spiega').innerHTML = `<div class="note"><p><b>Come calcoliamo l'Iva e i costi per questa auto</b> (${esc(dd.caso.toLowerCase())})</p><ul style="margin:6px 0 0;padding-left:20px">${righe}</ul></div>`;
    // informazioni sull'acquisto
    if (t === 'acquisto') {
      const a = cc.acquisto, am = cc.ammortamento;
      $('#acq-info').innerHTML = cc.costoVeicolo ? `<div class="note ok"><p>Costo dell'auto ai fini fiscali: <b>${eur(cc.costoVeicolo)}</b>${a && a.indetraibile ? ` (prezzo ${eur(a.prezzo)} + Iva non detraibile ${eur(a.indetraibile)})` : ''}.
        ${am && !am.manuale ? (am.coeff ? `Ammortamento ${S.anno} (${am.anno}° anno, ${String(am.coeff).replace('.', ',')}%): <b>${eur(cc.quota)}</b>.` : `Nel ${S.anno} l'auto risulta già ammortizzata (o non ancora acquistata): ammortamento 0.`) : ''}
        ${a && a.iva ? (a.nellAnno ? `Iva detraibile nel ${S.anno}: <b>${eur(a.detraibile)}</b>.` : `L'Iva della fattura si detrae nel ${a.anno}, non nel ${S.anno}.`) : ''}</p></div>` : '';
    }
    $('#dyn5-prev').innerHTML = `<h3 style="margin-top:16px">Anteprima</h3>${deducibilitaHtml(dd)}`;
  }

  // ---------- risultato ----------
  function passo5() {
    const c = calcolaVeicolo(S.d, S.anno), r = c.res;
    const nome = esc(nomeVeicolo(S.d));
    if (r.errore) {
      return `<div class="card"><h2>6. Risultato</h2><div class="note bad"><p><b>Non è possibile calcolare:</b> ${esc(r.errore)}</p></div>
        <div class="actions"><button class="btn ghost" data-nav="-1">← Indietro</button><div class="r"><button class="btn ghost" data-go="1">Rivedi i dati del libretto</button></div></div></div>`;
    }
    const mensile = r2(r.imponibile / 12);
    const salvaTxt = S.editId ? 'Aggiorna nel parco auto' : 'Salva nel parco auto';
    const alt = r.confronto.map((x) => {
      if (x.errore) return `<tr class="dim"><td>${esc(REGIMI[x.chiave].nome)}</td><td colspan="3"><small>${esc(x.errore)}</small></td></tr>`;
      const dlt = r2(x.imponibile - r.imponibile);
      return `<tr class="${x.applicabile ? 'hl' : 'dim'}"><td>${esc(REGIMI[x.chiave].nome)} ${x.applicabile ? '<span class="pill">applicabile</span>' : '<span class="pill gray">solo confronto</span>'}</td>
        <td class="num">${x.perc != null ? x.perc + '%' : '—'}</td><td class="num">${eur(x.imponibile)}</td>
        <td class="num">${x.applicabile ? '—' : `<span class="delta ${dlt > 0 ? 'up' : 'down'}">${dlt > 0 ? '+' : ''}${eur(dlt)}</span>`}</td></tr>`;
    }).join('');
    return `<div class="card" id="risultato"><h2>6. Risultato — ${nome}</h2>
      <p class="muted">${esc(S.d.dipendente ? `Dipendente: ${S.d.dipendente} · ` : '')}${esc(S.d.azienda ? `${S.d.azienda} · ` : '')}Anno d'imposta ${S.anno} · Tabelle ACI ${S.anno}</p>
      ${c.mancante ? `<div class="note warn"><p>Il modello scelto non è nella tabella ${S.anno}: è stato usato l'ultimo costo km salvato (${n4(c.ck)}). Riseleziona il modello al passo 3.</p></div>` : ''}
      <div class="kpis">
        <div class="kpi"><small>Valore da assoggettare a tassazione (anno ${S.anno})</small><span class="big">${eur(r.imponibile)}</span></div>
        <div class="kpi"><small>${r.regime.chiave === 'normale' ? 'Valore del benefit (prima delle trattenute)' : 'Fringe benefit annuo pieno'}</small><b>${eur(r.valoreAnnuo)}</b></div>
        <div class="kpi"><small>Equivalente mensile (÷ 12)</small><b>${eur(mensile)}</b></div>
        <div class="kpi"><small>Disciplina</small><b>${esc(REGIMI[r.regime.chiave].breve)}${r.perc != null ? ' · ' + r.perc + '%' : ''}</b></div>
      </div>
      <div class="note ok"><p><b>Perché questa disciplina?</b> ${esc(r.regime.motivo)}</p></div>
      ${r.regime.avvisi.map((a) => `<div class="note warn"><p>${esc(a)}</p></div>`).join('')}
      <h3>Come è stato calcolato</h3>
      <div class="scroll"><table><tbody>${r.passi.map((p) => `<tr><td>${esc(p.etichetta)}${p.dettaglio ? `<br><small>${esc(p.dettaglio)}</small>` : ''}</td><td class="num">${eur(p.valore)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Valore imponibile del dipendente</td><td class="num">${eur(r.imponibile)}</td></tr></tfoot></table></div>
      <p><small>Il valore concorre al reddito di lavoro dipendente (Irpef, addizionali, contributi). Il costo chilometrico di esercizio proviene dalle tabelle ACI pubblicate in G.U. con effetto dall'anno d'imposta.</small></p>
    </div>
    ${r.confronto.length ? `<div class="card"><h3>Confronto con le altre discipline (stessi dati)</h3>
      <p class="muted">Utile per valutare il passaggio al nuovo regime, per esempio in caso di rinnovo o sostituzione dell'auto.</p>
      <div class="scroll"><table><thead><tr><th>Disciplina</th><th class="num">%</th><th class="num">Imponibile ${S.anno}</th><th class="num">Differenza rispetto a questa auto</th></tr></thead><tbody>${alt}</tbody></table></div>
      <p><small>I regimi "solo confronto" non sono applicabili a questa auto in base alla data del contratto: mostrano cosa cambierebbe con un nuovo contratto.</small></p></div>` : ''}
    ${deducibilitaCard(c.inp, r)}
    <div class="actions noprint"><div><button class="btn ghost" data-go="1">← Modifica i dati</button></div>
      <div class="r"><button class="btn ghost" data-act="stampa">Stampa / PDF</button><button class="btn ghost" data-act="nuovo">Nuovo calcolo</button><button class="btn" data-act="salva">${salvaTxt}</button></div></div>`;
  }

  /** Tabella dei passaggi del calcolo, divisa per sezione: ogni riga ha la formula con i numeri usati. */
  function tabellaCalcolo(dd) {
    if (!dd.calcolo.length) return '<p><small>Nessun importo da calcolare: inserisci costi e Iva al passo 5.</small></p>';
    let sez = '', n = 0;
    const righe = dd.calcolo.map((x) => {
      let h = '';
      if (x.sezione !== sez) { sez = x.sezione; h = `<tr class="sez"><th colspan="4">${esc(sez)}</th></tr>`; }
      n++;
      return `${h}<tr class="${x.totale ? 'hl' : (x.info ? 'dim' : '')}"><td class="num"><small>${n}</small></td><td>${esc(x.etichetta)}${x.nota ? `<br><small>${esc(x.nota)}</small>` : ''}</td>
        <td class="mono-cell">${x.formula ? esc(x.formula) + (/[×+−/]|minore tra/.test(x.formula) ? ' =' : '') : ''}</td><td class="num">${eur(x.valore)}</td></tr>`;
    }).join('');
    return `<div class="scroll"><table class="calcolo"><thead><tr><th class="num">#</th><th>Passaggio</th><th>Calcolo</th><th class="num">Importo</th></tr></thead><tbody>${righe}</tbody></table></div>`;
  }

  /** Deducibilità e Iva: riepilogo, regole applicate, calcolo passo per passo (passo 5 e risultato). */
  function deducibilitaHtml(dd) {
    const kpi = (lab, v, sub = '') => `<div class="kpi"><small>${lab}</small><b>${v == null ? '—' : eur(v)}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    return `<p class="muted">${esc(dd.caso)}</p>
      <div class="kpis">
        ${kpi('Costi deducibili (imposte dirette)', dd.imposte.importo, dd.imposte.perc != null ? `${dd.imposte.perc}% dei costi` : 'compenso + 20% eccedenza')}
        ${kpi('Costi non deducibili', dd.imposte.nonDeducibile, 'da riprendere in dichiarazione')}
        ${kpi(`Iva detraibile ${S.anno}`, dd.iva.detraibile, `aliquota di detrazione ${dd.iva.perc}%`)}
        ${dd.iva.debito ? kpi('Iva a debito (fattura al dipendente)', dd.iva.debito.iva, `su imponibile ${eur(dd.iva.debito.imponibile)}`) : ''}
      </div>
      <div class="note"><p><b>Regole applicate.</b> Imposte dirette: ${esc(dd.imposte.testo)}. Iva: ${esc(dd.iva.testo)}</p></div>
      <h3>Come si calcola, passo per passo</h3>
      ${tabellaCalcolo(dd)}
      ${dd.limiti.map((l) => `<div class="note warn"><p>${esc(l)}</p></div>`).join('')}
      ${dd.note.map((l) => `<div class="note"><p>${esc(l)}</p></div>`).join('')}`;
  }

  function deducibilitaCard(inp, r) {
    const dd = FB.deducibilita(inp, r);
    const vuoto = !dd.costi.haCosti && !dd.costi.haIva;
    return `<div class="card"><h3>Deducibilità e Iva per l'azienda</h3>
      ${deducibilitaHtml(dd)}
      ${vuoto ? '<p><small>Per vedere gli importi in euro compila il passo 5 "Costi e Iva".</small> <button class="btn ghost sm noprint" data-go="5">Vai al passo 5</button></p>' : ''}
    </div>`;
  }

  // ---------- eventi del calcolo guidato ----------
  function vai(n) { S.step = n; renderCalcolo(); window.scrollTo({ top: 0 }); }
  function avanti() {
    const e = valida(S.step);
    if (Object.keys(e).length) { renderCalcolo(e); const el = $('.f.err input, .f.err select') || $('.errmsg'); if (el) el.scrollIntoView({ block: 'center' }); return; }
    if (S.step === 1 && CATEGORIE[S.d.categoria] && !CATEGORIE[S.d.categoria].forfait && !(isAmm(S.d))) { vai(6); return; }
    vai(Math.min(6, S.step + 1));
  }
  $('#tab-calcolo').addEventListener('click', (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.go) vai(Number(t.dataset.go));
    else if (t.dataset.nav) (Number(t.dataset.nav) > 0 ? avanti() : vai(Math.max(1, S.step - 1)));
    else if (t.dataset.skip) vai(6);
    else if (t.dataset.aci) {
      const r = ACI.perChiave(S.anno, t.dataset.aci);
      if (r) { Object.assign(S.d, { aciKey: t.dataset.aci, aciLabel: `${r.marca} ${r.modello}`, ck: r.ck, ckManuale: false }); salvaBozza(); dyn3(); }
    } else if (t.dataset.act === 'stampa') window.print();
    else if (t.dataset.act === 'nuovo') { S.d = nuoviDati(); S.editId = null; S.qChiave = null; salvaBozza(); vai(1); }
    else if (t.dataset.act === 'salva') salvaInFlotta();
  });
  $('#tab-calcolo').addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'q') { S.q = t.value; dyn3(); return; }
    if (t.id === 'q-solo') { S.qSolo = t.checked; dyn3(); return; }
    if (t.id === 'q-prod') { S.qProd = t.checked; dyn3(); return; }
    const f = t.dataset.f; if (!f) return;
    S.d[f] = t.type === 'checkbox' ? t.checked : t.value;
    if (f === 'ckManuale' && t.checked) S.d.aciKey = '';
    salvaBozza();
    ({ 1: dyn1, 2: dyn2, 3: dyn3, 4: dyn4, 5: dyn5 }[S.step] || (() => {}))();
  });
  $('#tab-calcolo').addEventListener('focusin', (ev) => { if (ev.target.dataset && ev.target.dataset.f) evidenzia(ev.target.dataset.f); });

  function salvaInFlotta() {
    const c = calcolaVeicolo(S.d, S.anno);
    if (c.res.errore) return;
    if (S.editId) {
      const i = S.flotta.findIndex((x) => x.id === S.editId);
      if (i >= 0) S.flotta[i].d = clone(S.d);
    } else {
      S.flotta.push({ id: uid(), d: clone(S.d) });
    }
    salvaFlotta(); toast(S.editId ? 'Veicolo aggiornato nel parco auto' : 'Veicolo salvato nel parco auto');
    S.editId = null; S.d = nuoviDati(); S.qChiave = null; salvaBozza(); S.step = 1; setTab('flotta');
  }

  // ---------- PARCO AUTO ----------
  function renderFlotta() {
    const root = $('#tab-flotta');
    if (!S.flotta.length) {
      root.innerHTML = `<div class="card"><h2>Parco auto</h2><p>Non hai ancora salvato veicoli. Completa il <a href="#" data-tab-link="calcolo">calcolo guidato</a> e salva ogni auto: qui vedrai il totale, il confronto con il nuovo regime e,
        quando importerai le tabelle ACI del nuovo anno, <b>tutto si ricalcola da solo</b>.</p>
        <p><button class="btn ghost" data-fl="import">Ripristina da un backup</button></p></div>`;
      return;
    }
    let totImp = 0, totNuovo = 0;
    const righe = S.flotta.map((rec) => {
      const c = calcolaVeicolo(rec.d, S.anno), r = c.res;
      const nm = `<b>${esc(nomeVeicolo(rec.d))}</b>${rec.d.aciLabel ? `<br><small>ACI: ${esc(rec.d.aciLabel)}</small>` : ''}`;
      const az = `<td><button class="btn ghost sm" data-fl="edit" data-id="${esc(rec.id)}">Apri</button> <button class="btn danger sm" data-fl="del" data-id="${esc(rec.id)}">Elimina</button></td>`;
      if (r.errore) return `<tr><td>${nm}</td><td>${esc(rec.d.dipendente)}</td><td colspan="5"><span class="pill warn">da completare</span> <small>${esc(r.errore)}</small></td>${az}</tr>`;
      const nu = r.confronto.find((x) => x.chiave === 'nuovo');
      const nuovoVal = nu && !nu.errore ? nu.imponibile : null;
      totImp += r.imponibile; totNuovo += nuovoVal ?? r.imponibile;
      const dlt = nuovoVal == null || r.regime.chiave === 'nuovo' ? null : r2(nuovoVal - r.imponibile);
      return `<tr><td>${nm}${c.mancante ? '<br><span class="pill warn">modello non in tabella ' + S.anno + '</span>' : ''}</td><td>${esc(rec.d.dipendente || (isAmm(rec.d) ? 'Amministratore' : 'Dipendente'))}</td>
        <td><span class="pill ${r.regime.chiave === 'nuovo' ? '' : 'gray'}">${esc(REGIMI[r.regime.chiave].breve)}</span> <small>${percTxt(r.perc)}</small></td>
        <td class="num">${eur(r.valoreAnnuo)}</td><td class="num"><b>${eur(r.imponibile)}</b></td>
        <td class="num">${nuovoVal == null ? '—' : eur(nuovoVal)}</td><td class="num">${dlt == null ? '—' : `<span class="delta ${dlt > 0 ? 'up' : 'down'}">${dlt > 0 ? '+' : ''}${eur(dlt)}</span>`}</td>${az}</tr>`;
    }).join('');
    root.innerHTML = `<div class="card"><h2>Parco auto — anno d'imposta ${S.anno}</h2>
      <p class="muted">Ogni riga è ricalcolata con le tabelle ACI e le regole dell'anno selezionato in alto. Cambia anno per vedere l'effetto dell'aggiornamento annuale.</p>
      <div class="scroll"><table><thead><tr><th>Veicolo</th><th>Utilizzatore</th><th>Disciplina</th><th class="num">Fringe annuo pieno</th><th class="num">Imponibile ${S.anno}</th><th class="num">Se nuovo regime</th><th class="num">Differenza</th><th></th></tr></thead>
        <tbody>${righe}</tbody>
        <tfoot><tr><td colspan="4">Totale</td><td class="num">${eur(totImp)}</td><td class="num">${eur(totNuovo)}</td><td class="num">${totNuovo - totImp ? eur(r2(totNuovo - totImp)) : '—'}</td><td></td></tr></tfoot></table></div>
      </div>
    ${deducibilitaFlotta()}
    <div class="card"><div class="actions noprint" style="margin-top:0"><div class="r"><button class="btn ghost" data-fl="csv">Esporta CSV</button><button class="btn ghost" data-fl="backup">Backup (JSON)</button><button class="btn ghost" data-fl="import">Ripristina backup</button></div>
        <div class="r"><button class="btn" data-tab-link="calcolo">+ Aggiungi veicolo</button></div></div></div>`;
  }

  /** Tabella riepilogativa: deducibilità di imposte dirette e Iva per ogni targa del parco auto. */
  function deducibilitaFlotta() {
    let totCosti = 0, totDed = 0, totIvaD = 0, totIvaI = 0, totIvaDeb = 0, haImporti = false;
    const dettagli = [];
    const righe = S.flotta.map((rec) => {
      const c = calcolaVeicolo(rec.d, S.anno), d = rec.d;
      const nome = `<b>${esc(d.targa || nomeVeicolo(d))}</b>${d.targa ? `<br><small>${esc([d.marca, d.modello].filter(Boolean).join(' '))}</small>` : ''}`;
      if (c.res.errore) return `<tr><td>${nome}</td><td colspan="9"><span class="pill warn">da completare</span> <small>${esc(c.res.errore)}</small></td></tr>`;
      const dd = FB.deducibilita(c.inp, c.res);
      if (dd.calcolo.length) dettagli.push(`<details class="det-box" id="det-${esc(rec.id)}"><summary><b>${esc(d.targa || nomeVeicolo(d))}</b> — ${esc(dd.caso)}</summary>
        <p class="muted">${esc(dd.imposte.testo)}. ${esc(dd.iva.testo)}</p>${tabellaCalcolo(dd)}</details>`);
      const costi = dd.costi.base;
      if (dd.imposte.importo != null) { totCosti += costi; totDed += dd.imposte.importo; haImporti = true; }
      if (dd.iva.detraibile != null) { totIvaD += dd.iva.detraibile; totIvaI += dd.iva.indetraibile; }
      if (dd.iva.debito) totIvaDeb += dd.iva.debito.iva;
      const chi = isAmm(d) ? `Amministratore/co.co.co.<br><small>${{ promiscuo: 'uso promiscuo', personale: 'uso personale', aziendale: 'uso aziendale' }[d.usoAmm]}</small>` : `Dipendente${d.dipendente ? `<br><small>${esc(d.dipendente)}</small>` : ''}`;
      return `<tr><td>${nome}</td><td>${chi}</td>
        <td>${dd.imposte.perc != null ? `<span class="pill">${dd.imposte.perc}%</span>` : '<span class="pill gray">compenso + 20%</span>'}</td>
        <td class="num">${costi ? eur(costi) : '—'}</td><td class="num">${dd.imposte.importo != null ? `<b>${eur(dd.imposte.importo)}</b>` : '—'}</td>
        <td><span class="pill">${dd.iva.perc}%</span></td><td class="num">${dd.iva.detraibile != null ? eur(dd.iva.detraibile) : '—'}${dd.iva.acquisto && dd.iva.acquisto.nellAnno ? `<br><small>di cui acquisto ${eur(dd.iva.acquisto.detraibile)}</small>` : ''}</td><td class="num">${dd.iva.indetraibile != null ? eur(dd.iva.indetraibile) : '—'}</td><td class="num">${dd.iva.debito ? eur(dd.iva.debito.iva) : '—'}</td>
        <td>${dd.calcolo.length ? `<button class="btn ghost sm noprint" data-fl="det" data-id="${esc(rec.id)}">Calcolo</button>` : ''}</td></tr>`;
    }).join('');
    return `<div class="card"><h2>Deducibilità per targa — ${S.anno}</h2>
      <p class="muted">Calcolata in base a utilizzatore, uso, giorni di assegnazione e ai costi indicati al passo 5 "Costi e Iva" di ogni auto. La percentuale c'è sempre; gli importi compaiono se hai inserito costi e Iva.</p>
      <div class="scroll"><table><thead><tr><th>Targa</th><th>Utilizzatore</th><th>Imposte dirette</th><th class="num">Costi rilevanti</th><th class="num">Costi deducibili</th><th>Iva</th><th class="num">Iva detraibile</th><th class="num">Iva non detraibile</th><th class="num">Iva a debito</th><th></th></tr></thead>
        <tbody>${righe}</tbody>
        <tfoot><tr><td colspan="3">Totale</td><td class="num">${haImporti ? eur(totCosti) : '—'}</td><td class="num">${haImporti ? eur(totDed) : '—'}</td><td></td><td class="num">${totIvaD || totIvaI ? eur(r2(totIvaD)) : '—'}</td><td class="num">${totIvaD || totIvaI ? eur(r2(totIvaI)) : '—'}</td><td class="num">${totIvaDeb ? eur(r2(totIvaDeb)) : '—'}</td><td></td></tr></tfoot></table></div>
      ${dettagli.length ? `<h3 style="margin-top:18px">Calcoli passo per passo</h3>
      <p class="noprint"><button class="btn ghost sm" data-fl="detall">Apri tutti</button> <button class="btn ghost sm" data-fl="csvdet">Esporta i calcoli (CSV)</button></p>
      ${dettagli.join('')}` : ''}
      <p><small>Dipendenti: 70% se l'auto è assegnata per più di metà anno (altrimenti 20% con limiti di costo), Iva 40% (100% con corrispettivo addebitato). Amministratori: compenso in natura + 20% dell'eccedenza (promiscuo), solo il compenso (personale), 20% (aziendale); Iva 40%.</small></p></div>`;
  }
  $('#tab-flotta').addEventListener('click', (ev) => {
    const lnk = ev.target.closest('[data-tab-link]'); if (lnk) { ev.preventDefault(); if (lnk.dataset.tabLink === 'calcolo') { S.editId = null; S.d = nuoviDati(); S.step = 1; S.qChiave = null; } setTab(lnk.dataset.tabLink); return; }
    const t = ev.target.closest('button[data-fl]'); if (!t) return;
    const a = t.dataset.fl;
    if (a === 'edit') { const rec = S.flotta.find((x) => x.id === t.dataset.id); S.d = migraCosti({ ...nuoviDati(), ...clone(rec.d) }); S.editId = rec.id; S.qChiave = null; S.step = 6; setTab('calcolo'); }
    else if (a === 'del') { if (confirm('Eliminare questo veicolo dal parco auto?')) { S.flotta = S.flotta.filter((x) => x.id !== t.dataset.id); salvaFlotta(); renderFlotta(); } }
    else if (a === 'csv') esportaCsvFlotta();
    else if (a === 'det') { const box = $(`#det-${t.dataset.id}`); box.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (a === 'detall') { const tutti = $$('#tab-flotta details.det-box'); const apri = tutti.some((x) => !x.open); tutti.forEach((x) => { x.open = apri; }); t.textContent = apri ? 'Chiudi tutti' : 'Apri tutti'; }
    else if (a === 'csvdet') esportaCsvCalcoli();
    else if (a === 'backup') scarica(`parco-auto-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ versione: 1, flotta: S.flotta }, null, 2), 'application/json');
    else if (a === 'import') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
      inp.onchange = async () => {
        try { const j = JSON.parse(await inp.files[0].text()); if (!Array.isArray(j.flotta)) throw new Error('formato');
          S.flotta = j.flotta.filter((x) => x && typeof x.d === 'object').map((x) => ({ id: idSicuro(x.id), d: migraCosti(datiSicuri(x.d)) })); salvaFlotta(); renderFlotta(); toast(`${S.flotta.length} veicoli ripristinati`);
        } catch (e) { toast('File di backup non valido'); }
      };
      inp.click();
    }
  });
  /** Un passaggio per riga: targa, sezione, passaggio, calcolo, importo — per ricostruire tutto in un foglio di calcolo. */
  function esportaCsvCalcoli() {
    const num = (n) => Number(n).toFixed(2).replace('.', ',');
    const righe = [['Targa', 'Veicolo', 'Caso', 'Sezione', 'N.', 'Passaggio', 'Calcolo', 'Importo', 'Nota']];
    for (const rec of S.flotta) {
      const c = calcolaVeicolo(rec.d, S.anno);
      if (c.res.errore) continue;
      const dd = FB.deducibilita(c.inp, c.res);
      dd.calcolo.forEach((x, i) => righe.push([rec.d.targa, nomeVeicolo(rec.d), dd.caso, x.sezione, i + 1, x.etichetta, x.formula, num(x.valore), x.nota || '']));
    }
    scarica(`deducibilita-calcoli-${S.anno}.csv`, '\ufeff' + righe.map((l) => l.map(ACI.cellaCsv).join(';')).join('\n'), 'text/csv');
  }

  function esportaCsvFlotta() {
    const num = (n) => String(n).replace('.', ',');
    const head = ['Targa', 'Marca', 'Modello', 'Dipendente', 'Prima immatricolazione', 'Data contratto', 'Disciplina', 'Percentuale', 'Costo km ACI', 'Fringe annuo pieno', 'Giorni', `Imponibile ${S.anno}`, 'Imponibile con nuovo regime', 'Tipo utilizzatore', 'Imposte dirette %', 'Costi rilevanti', 'Costi deducibili', 'Iva detraibile %', 'Iva detraibile', 'Iva non detraibile', 'Iva a debito (fattura dipendente)'];
    const rows = S.flotta.map((rec) => {
      const c = calcolaVeicolo(rec.d, S.anno), r = c.res, d = rec.d;
      if (r.errore) return [d.targa, d.marca, d.modello, d.dipendente, d.dataImm, d.dataContratto, 'DA COMPLETARE: ' + r.errore];
      const nu = r.confronto.find((x) => x.chiave === 'nuovo');
      const dd = FB.deducibilita(c.inp, r);
      return [d.targa, d.marca, d.modello, d.dipendente, d.dataImm, d.dataContratto, REGIMI[r.regime.chiave].nome, r.perc ?? '', num(c.ck), num(r.valoreAnnuo.toFixed(2)), r.giorni, num(r.imponibile.toFixed(2)), nu && !nu.errore ? num(nu.imponibile.toFixed(2)) : '',
        isAmm(d) ? `Amministratore (${d.usoAmm})` : 'Dipendente', dd.imposte.perc ?? 'compenso + 20% eccedenza', dd.costi.base ? num(dd.costi.base.toFixed(2)) : '', dd.imposte.importo != null ? num(dd.imposte.importo.toFixed(2)) : '',
        dd.iva.perc, dd.iva.detraibile != null ? num(dd.iva.detraibile.toFixed(2)) : '', dd.iva.indetraibile != null ? num(dd.iva.indetraibile.toFixed(2)) : '', dd.iva.debito ? num(dd.iva.debito.iva.toFixed(2)) : ''];
    });
    scarica(`fringe-benefit-${S.anno}.csv`, '﻿' + [head, ...rows].map((l) => l.map(ACI.cellaCsv).join(';')).join('\n'), 'text/csv');
  }

  // ---------- GUIDA ----------
  function renderGuida() {
    $('#tab-guida').innerHTML = `
    <div class="card"><h2>Come sono cambiate le regole</h2>
      <p>L'auto concessa in uso promiscuo al dipendente genera un reddito in natura, determinato in modo forfetario: una percentuale dell'importo corrispondente a
        <b>15.000 km</b> di percorrenza, calcolato con il <b>costo chilometrico di esercizio</b> delle tabelle ACI (pubblicate in Gazzetta Ufficiale entro il 31.12, valide dall'anno successivo), al netto di quanto il dipendente paga.
        Quello che cambia, nel tempo, è la <b>percentuale</b> e le <b>condizioni</b>.</p>
      <div class="scroll"><table class="timeline"><thead><tr><th>Se il contratto di assegnazione è…</th><th>Percentuale</th><th>Note</th></tr></thead><tbody>
        <tr><td>stipulato entro il <b>30.06.2020</b></td><td>30% fissa</td><td>Disciplina ante riforma, resta valida per tutta la durata del contratto.</td></tr>
        <tr><td>stipulato dal <b>1.07.2020 al 31.12.2024</b><br><small>(o veicolo ordinato entro il 31.12.2024 e concesso nel 2025)</small></td>
          <td>in base alla CO₂:<br>≤ 60 g/km → 25%<br>61–160 → 30%<br>161–190 → 50%<br>&gt; 190 → 60%</td><td>Dal 2026: <b>+50%</b> dopo il 31.12 del 5° anno successivo alla prima immatricolazione.</td></tr>
        <tr><td>concesso dal <b>1.01.2025</b><br><small>(L. 207/2024)</small></td><td>50% (altri)<br>20% ibrido plug-in<br>10% elettrico a batteria</td>
          <td>Non conta più la CO₂. Dal 2026 (Omnibus): quota trattenuta al dipendente anche per accessori/allestimenti, <b>+50%</b> oltre il 5° anno, <b>+5%</b> con accessori non valorizzati nelle tabelle.</td></tr>
      </tbody></table></div></div>
    <div class="card"><h2>Novità dal 1.01.2026 (Decreto Omnibus, D.Lgs. 148/2026)</h2><ul>
      <li>Eliminato il riferimento alla "nuova immatricolazione" e ai contratti stipulati dal 1.01.2025: le nuove regole valgono per i veicoli concessi in uso promiscuo, dal periodo d'imposta 2026.</li>
      <li>Nelle somme trattenute al dipendente si includono anche quelle relative ad <b>accessori e allestimenti</b>.</li>
      <li>Il valore è aumentato del <b>50%</b> dopo il 31.12 del <b>5° anno successivo</b> a quello di prima immatricolazione (vale anche per il regime transitorio CO₂ e se l'auto passa a un altro dipendente).</li>
      <li>Il valore è aumentato del <b>5%</b> in presenza di accessori o allestimenti non valorizzati nelle tabelle ACI e non acquistati direttamente dal lavoratore.</li>
      <li>Sono fatti salvi i comportamenti tenuti dai datori di lavoro fino al 31.12.2025 sulla tassazione di accessori e allestimenti.</li>
      <li>Dal 1.01.2027 le norme confluiscono nei nuovi Testi unici (Iva e imposte sui redditi) senza modifiche di sostanza.</li></ul></div>
    <div class="card"><h2>Amministratori e collaboratori coordinati e continuativi</h2><ul>
      <li><b>Reddito in natura:</b> è assimilato al lavoro dipendente, quindi per l'uso promiscuo si applica lo stesso forfait ACI del dipendente.</li>
      <li><b>Uso solo personale:</b> non è uso promiscuo, quindi niente forfait: il compenso è al valore normale (art. 9 Tuir).</li>
      <li><b>Uso solo aziendale:</b> nessun reddito in natura.</li>
      <li><b>Deducibilità per la società</b> (art. 95 c. 5 e art. 164 Tuir): uso promiscuo = compenso in natura + 20% dell'eccedenza delle spese (con limite di costo); uso personale = solo il compenso in natura; uso aziendale = 20% con limite di costo. Non vale il 70% previsto per i dipendenti.</li></ul></div>
    <div class="card"><h2>Auto usata assegnata dopo il 2020 (valore normale)</h2>
      <p>Il regime CO₂ riguarda i veicoli di <b>nuova immatricolazione</b> (dal 1.07.2020). Per un'auto immatricolata prima di quella data e assegnata dopo, secondo l'Agenzia (Telefisco 2021, risoluzione 46/2020) il benefit si valorizza al <b>valore normale</b>:
        canone di leasing o noleggio pagato dal datore di lavoro, <b>meno</b> la parte riferibile all'uso aziendale, <b>meno</b> quanto trattiene il dipendente. La parte aziendale si calcola a scelta con i <b>chilometri</b> percorsi per lavoro (dentro e fuori dal Comune della sede) × tariffa ACI, come indicato dall'Agenzia, oppure con una <b>percentuale</b> di uso aziendale documentata.
        L'app lo calcola quando inserisci canone e chilometri; lo stesso vale per un'auto usata assegnata nel 2025.</p></div>
    <div class="card"><h2>Come l'app calcola l'Iva e i costi deducibili</h2>
      <p>Al passo 5 gli importi si inseriscono <b>senza Iva</b>, con l'<b>Iva a parte</b>: la divisione tra detraibile e non detraibile la fa l'app.</p>
      <div class="scroll"><table><thead><tr><th>Voce</th><th>Iva</th><th>Costo per le imposte dirette</th></tr></thead><tbody>
        <tr><td><b>Fattura d'acquisto</b></td><td>Detraibile (40%, o 100% con corrispettivo al dipendente) <b>tutta nell'anno d'acquisto</b></td><td>Prezzo + Iva non detraibile = costo dell'auto, dedotto con l'ammortamento (12,5% il primo anno, poi 25%)</td></tr>
        <tr><td><b>Canoni di leasing o noleggio</b></td><td>Detraibile nell'anno, stessa percentuale</td><td>Canoni + Iva non detraibile, con il limite di costo quando la deduzione è al 20%</td></tr>
        <tr><td><b>Altri costi</b> (carburante, manutenzione, assicurazione, bollo)</td><td>Detraibile nell'anno, stessa percentuale</td><td>Costi + Iva non detraibile, senza limiti</td></tr>
        <tr><td><b>Corrispettivo al dipendente</b></td><td>Iva <b>a debito</b>: si scorpora dalla trattenuta (Iva inclusa) e va in fattura</td><td>—</td></tr>
      </tbody></table></div>
      <p><small>Percentuali di deduzione: 70% per l'auto assegnata al dipendente per più di metà anno (senza limiti); 20% con limiti di costo negli altri casi; per gli amministratori compenso in natura + 20% dell'eccedenza. Riferimenti: art. 164 e art. 95, c. 5 Tuir; art. 19-bis1 DPR 633/72.</small></p></div>
    <div class="card"><h2>Checklist per aggiornare la tassazione</h2><ol>
      <li><b>Censisci le auto assegnate</b>: per ognuna serve data di prima immatricolazione (B), alimentazione (P.3), CO₂ (V.7) e data dell'atto di assegnazione (e dell'ordine se concessa nel 2025).</li>
      <li><b>Individua la disciplina</b> di ciascuna auto: l'app lo fa dalle date, spiegandoti il perché.</li>
      <li><b>Controlla l'anzianità</b>: le auto immatricolate nel 2020 o prima entrano nella maggiorazione +50% già dal 2026.</li>
      <li><b>Verifica gli accessori</b>: optional non compresi nella versione ACI → +5% (nuovo regime) e inclusione nelle trattenute.</li>
      <li><b>Importa le tabelle ACI</b> del nuovo anno appena pubblicate in G.U. (scheda "Aggiornamento annuale") e ricalcola l'intero parco auto.</li>
      <li><b>Aggiorna cedolini e conguagli</b>: il fringe è determinato annualmente, ragguagliato ai giorni di assegnazione.</li>
      <li>Se l'auto cambia dipendente o contratto, ripeti il calcolo con le nuove date.</li></ol></div>
    <div class="card"><h2>Dove trovo i dati sul libretto?</h2>
      <div class="scroll"><table><thead><tr><th>Campo</th><th>Cosa indica</th><th>A cosa serve qui</th></tr></thead><tbody>
        <tr><td><b>A</b></td><td>Targa</td><td>Riconoscere l'auto</td></tr>
        <tr><td><b>B</b></td><td>Data di prima immatricolazione</td><td>Anzianità: +50% dopo il 5° anno successivo</td></tr>
        <tr><td><b>D.1 / D.3</b></td><td>Marca / denominazione commerciale</td><td>Cercare il modello nella tabella ACI</td></tr>
        <tr><td><b>J · J.2</b></td><td>Categoria (M1, N1, L…) e carrozzeria</td><td>Stabilire se è nel forfait (autovettura, promiscuo, autocaravan, moto)</td></tr>
        <tr><td><b>P.1 / P.2</b></td><td>Cilindrata / potenza kW</td><td>Scegliere la versione giusta nella tabella ACI (potenza in CV)</td></tr>
        <tr><td><b>P.3</b></td><td>Alimentazione</td><td>Nuovo regime: 10% elettrico, 20% plug-in, 50% altri</td></tr>
        <tr><td><b>S.1</b></td><td>Posti a sedere</td><td>Il forfait vale fino a 9 posti</td></tr>
        <tr><td><b>V.7</b></td><td>Emissioni CO₂ (g/km)</td><td>Percentuale nel regime CO₂ (assegnazioni 07/2020–12/2024)</td></tr>
      </tbody></table></div></div>
    <p class="muted">Riferimenti normativi: art. 51, c. 4, lett. a) Tuir; L. 207/2024, art. 1, cc. 48 e 48-bis; D.Lgs. 148/2026; tabelle ACI pubblicate in G.U. n. 297 del 23.12.2025, S.O. n. 40.</p>`;
  }

  // ---------- TABELLE ACI ----------
  function renderAci() {
    const anni = ACI.anni();
    if (!S.aci.anno || !anni.includes(S.aci.anno)) S.aci.anno = S.anno;
    const d = ACI.get(S.aci.anno);
    $('#tab-aci').innerHTML = `<div class="card"><h2>Tabelle ACI dei costi chilometrici</h2>
      <div class="row2"><div class="f"><label for="aci-anno">Anno</label><select id="aci-anno">${anni.map((a) => `<option ${a === S.aci.anno ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        <div class="f"><label for="aci-alim">Tipo di alimentazione</label><select id="aci-alim"><option value="">Tutte</option>${ACI.ALIM_ACI.map((a) => `<option value="${a}" ${S.aci.alim === a ? 'selected' : ''}>${ACI.ALIM_ETICHETTE[a]}</option>`).join('')}</select></div></div>
      <div class="f"><label for="aci-q">Cerca</label><input type="search" id="aci-q" value="${esc(S.aci.q)}" placeholder="marca o modello"></div>
      <div class="check"><input type="checkbox" id="aci-prod" ${S.aci.prod ? 'checked' : ''}><label for="aci-prod">Solo modelli in produzione</label></div>
      ${d ? `<p class="muted">${d.righe.length.toLocaleString('it-IT')} modelli · ${esc(d.fonte)} · ${d.origine === 'importata' ? 'importata da te' : 'integrata nell\'app'}</p>` : ''}
      <div id="aci-out"></div></div>`;
    aciTabella();
  }
  function aciTabella() {
    const r = ACI.cerca(S.aci.anno, { testo: S.aci.q, alim: S.aci.alim ? [S.aci.alim] : null, soloInProduzione: S.aci.prod, limite: 100 });
    const km = (ACI.get(S.aci.anno) || {}).km || 15000;
    const p = [10, 20, 25, 30, 50, 60];
    $('#aci-out').innerHTML = `<p><b>${r.totale.toLocaleString('it-IT')}</b> risultati${r.totale > 100 ? ' (primi 100)' : ''}</p><div class="scroll"><table><thead><tr><th>ID</th><th>Marca</th><th>Modello</th><th>Alimentazione</th><th class="num">Costo km</th>${p.map((x) => `<th class="num">${x}%</th>`).join('')}</tr></thead>
      <tbody>${r.righe.map((x) => `<tr><td>${x.id ?? ''}</td><td>${esc(x.marca)}</td><td>${esc(x.modello)}${x.prod ? '' : ' <span class="pill gray">f.p.</span>'}</td><td>${esc(ACI.ALIM_ETICHETTE[x.alim])}</td><td class="num">${n4(x.ck)}</td>${p.map((y) => `<td class="num">${r2(x.ck * km * y / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p><small>Importi annui = costo km × ${km.toLocaleString('it-IT')} km × percentuale. f.p. = fuori produzione.</small></p>`;
  }
  $('#tab-aci').addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'aci-anno') { S.aci.anno = Number(t.value); renderAci(); }
    else if (t.id === 'aci-alim') { S.aci.alim = t.value; aciTabella(); }
    else if (t.id === 'aci-q') { S.aci.q = t.value; aciTabella(); }
    else if (t.id === 'aci-prod') { S.aci.prod = t.checked; aciTabella(); }
  });

  // ---------- AGGIORNAMENTO ANNUALE ----------
  const CAMPI_SOGLIE = [0, 1, 2, 3];
  function renderAgg() {
    const anni = ACI.anni();
    const prox = (anni[anni.length - 1] || new Date().getFullYear()) + 1;
    const ordine = [...S.regole].sort((a, b) => a.dal - b.dal);
    if (S.regSel == null || !ordine.some((x) => x.dal === S.regSel)) S.regSel = ordine[ordine.length - 1].dal;
    $('#tab-agg').innerHTML = `
    <div class="card"><h2>1. Tabelle ACI</h2>
      <p>Ogni anno l'ACI elabora le tabelle entro il 30 novembre e l'Agenzia delle Entrate le pubblica in <b>Gazzetta Ufficiale entro il 31 dicembre</b>, con effetto dal periodo d'imposta successivo.
        Appena escono, carica qui il PDF: l'app legge i modelli e li aggiunge. I calcoli e il parco auto si aggiornano da soli.</p>
      <div class="scroll"><table><thead><tr><th>Anno</th><th>Fonte</th><th class="num">Modelli</th><th>Origine</th><th></th></tr></thead><tbody>
      ${anni.map((a) => { const d = ACI.get(a); return `<tr><td><b>${a}</b></td><td>${esc(d.fonte)}</td><td class="num">${d.righe.length.toLocaleString('it-IT')}</td><td><span class="pill ${d.origine === 'importata' ? 'warn' : 'gray'}">${d.origine}</span></td>
        <td><button class="btn ghost sm" data-ag="dljs" data-a="${a}">Scarica .js</button> <button class="btn ghost sm" data-ag="dlcsv" data-a="${a}">CSV</button>
        ${d.origine === 'importata' ? `<button class="btn danger sm" data-ag="rm" data-a="${a}">Elimina</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
      <h3 style="margin-top:20px">Importa le tabelle di un nuovo anno</h3>
      <div class="row2"><div class="f"><label for="imp-anno">Anno d'imposta di applicazione</label><input type="number" id="imp-anno" value="${prox}" min="2020" max="2100"></div>
        <div class="f"><label for="imp-fonte">Fonte (facoltativa)</label><input type="text" id="imp-fonte" placeholder="es. G.U. n. 298 del 30-12-${prox - 1}, S.O. n. 41"></div></div>
      <div class="drop" id="drop"><p><b>Trascina qui il PDF della Gazzetta Ufficiale</b><br><small>oppure un CSV (id;marca;modello;alimentazione;costo_km;in_produzione) o un JSON già convertito</small></p>
        <input type="file" id="imp-file" accept=".pdf,.csv,.json"><p><small>Il file viene letto nel tuo browser e non viene inviato a nessuno.</small></p></div>
      <div id="imp-out"></div></div>

    <div class="card"><h2>2. Regole fiscali per anno</h2>
      <p>Percentuali e soglie non sono scritte nel programma: sono <b>versioni per anno</b>. Se la legge cambia (nuove percentuali, nuove maggiorazioni), aggiungi una versione "dal" primo anno d'imposta di applicazione:
        per gli anni precedenti continuerà a valere la versione vecchia.</p>
      <div class="row2"><div class="f"><label for="reg-sel">Versione</label><select id="reg-sel">${ordine.map((x) => `<option value="${x.dal}" ${x.dal === S.regSel ? 'selected' : ''}>dal ${x.dal} — ${esc(x.etichetta)}</option>`).join('')}</select></div>
        <div class="f"><label for="reg-new">Nuova versione dal anno</label><div style="display:flex;gap:8px"><input type="number" id="reg-new" value="${ordine[ordine.length - 1].dal + 1}" min="2020" max="2100"><button class="btn ghost" data-ag="regadd">Aggiungi</button></div><span class="hint">Parte da una copia della versione più recente.</span></div></div>
      <div id="reg-form"></div></div>`;
    regForm();
    const dz = $('#drop');
    ['dragover', 'dragenter'].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (ev) => { if (ev.dataTransfer.files[0]) leggiFile(ev.dataTransfer.files[0]); });
    if (S.imp) mostraAnteprima();
  }

  function regForm() {
    const R = S.regole.find((x) => x.dal === S.regSel);
    const num = (p, label, step = 1) => `<div class="f"><label>${label}</label><input type="number" step="${step}" data-r="${p}" value="${getPath(R, p) ?? ''}"></div>`;
    const chk = (p, label) => `<div class="check"><input type="checkbox" data-r="${p}" ${getPath(R, p) ? 'checked' : ''}><label>${label}</label></div>`;
    $('#reg-form').innerHTML = `
      <div class="f"><label>Riferimento normativo</label><input type="text" data-r="etichetta" value="${esc(R.etichetta)}"></div>
      <div class="row2">${num('km', 'Percorrenza convenzionale (km)')}${num('pre2020.perc', 'Contratti entro 30.06.2020 — % del costo km')}</div>
      <h3>Regime CO₂ (contratti 07/2020 – 12/2024)</h3>
      <div class="scroll"><table><thead><tr><th>Emissioni fino a (g/km) — vuoto = oltre</th><th>Percentuale</th></tr></thead><tbody>
      ${CAMPI_SOGLIE.map((i) => `<tr><td><input type="number" data-r="co2.soglie.${i}.fino" value="${R.co2.soglie[i].fino ?? ''}" ${i === 3 ? 'placeholder="oltre l\'ultima soglia"' : ''}></td><td><input type="number" data-r="co2.soglie.${i}.perc" value="${R.co2.soglie[i].perc}"></td></tr>`).join('')}</tbody></table></div>
      <h3 style="margin-top:16px">Nuovo regime (dal 2025)</h3>
      <div class="row2">${num('nuovo.perc_altri', 'Altri veicoli — %')}${num('nuovo.perc_plugin', 'Ibridi plug-in — %')}</div>
      <div class="row2">${num('nuovo.perc_elettrico', 'Elettrici a batteria — %')}<span></span></div>
      <h3>Maggiorazioni</h3>
      ${chk('anzianita.attiva', 'Maggiorazione per anzianità del veicolo')}
      <div class="row2">${num('anzianita.anni', 'Dopo il 31.12 del … anno successivo all\'immatricolazione')}${num('anzianita.perc', 'Maggiorazione %')}</div>
      ${chk('accessori.attiva', 'Maggiorazione per accessori non valorizzati (solo nuovo regime)')}
      <div class="row2">${num('accessori.perc', 'Maggiorazione %')}<span></span></div>
      <h3>Iva</h3>
      <div class="row2">${num('aliquotaIva', 'Aliquota Iva sul corrispettivo addebitato al dipendente (%)')}<span></span></div>
      <div class="actions"><div class="r"><button class="btn ghost" data-ag="regexp">Esporta regole (JSON)</button><button class="btn danger" data-ag="regreset">Ripristina predefinite</button></div>
        <div class="r">${S.regole.length > 1 ? '<button class="btn danger" data-ag="regdel">Elimina questa versione</button>' : ''}</div></div>`;
  }

  $('#tab-agg').addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'reg-sel') { S.regSel = Number(t.value); regForm(); return; }
    if (t.id === 'imp-file') { if (t.files[0]) leggiFile(t.files[0]); return; }
    if (t.dataset.r) {
      const R = S.regole.find((x) => x.dal === S.regSel);
      let v = t.type === 'checkbox' ? t.checked : (t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value);
      setPath(R, t.dataset.r, v); LS.set('fb.regole', S.regole);
    }
  });
  $('#tab-agg').addEventListener('click', async (ev) => {
    const t = ev.target.closest('button[data-ag]'); if (!t) return;
    const a = t.dataset.ag;
    if (a === 'dljs') { const d = ACI.get(t.dataset.a); scarica(`aci-${d.anno}.js`, ACI.esportaJs(d), 'text/javascript'); }
    else if (a === 'dlcsv') { const d = ACI.get(t.dataset.a); scarica(`aci-${d.anno}.csv`, ACI.esportaCsv(d), 'text/csv'); }
    else if (a === 'rm') { if (confirm(`Eliminare le tabelle ${t.dataset.a} importate?`)) { await ACI.eliminaImportata(t.dataset.a); aggiornaAnni(); renderAgg(); } }
    else if (a === 'regadd') {
      const dal = Number($('#reg-new').value);
      if (!dal || S.regole.some((x) => x.dal === dal)) { toast('Esiste già una versione per quell\'anno'); return; }
      const ultima = clone([...S.regole].sort((x, y) => x.dal - y.dal).filter((x) => x.dal < dal).pop() || S.regole[0]);
      ultima.dal = dal; ultima.etichetta = `Nuove regole dal ${dal} (da descrivere)`;
      S.regole.push(ultima); S.regSel = dal; LS.set('fb.regole', S.regole); renderAgg(); toast(`Versione dal ${dal} creata: modifica i valori che cambiano`);
    }
    else if (a === 'regdel') { if (confirm('Eliminare questa versione delle regole?')) { S.regole = S.regole.filter((x) => x.dal !== S.regSel); LS.set('fb.regole', S.regole); S.regSel = null; renderAgg(); } }
    else if (a === 'regreset') { if (confirm('Ripristinare le regole predefinite? Le tue modifiche andranno perse.')) { S.regole = clone(REGOLE_DEFAULT); LS.del('fb.regole'); S.regSel = null; renderAgg(); } }
    else if (a === 'regexp') scarica('regole-fringe-benefit.json', JSON.stringify(S.regole, null, 2), 'application/json');
    else if (a === 'impsalva') salvaImport();
  });

  async function leggiFile(file) {
    const out = $('#imp-out');
    const ext = file.name.split('.').pop().toLowerCase();
    out.innerHTML = '<p>Lettura in corso… <progress id="imp-p" max="100" value="0"></progress></p>';
    try {
      let res;
      if (ext === 'pdf') {
        const testo = await ACI.testoDaPdf(await file.arrayBuffer(), (p, n) => { const el = $('#imp-p'); if (el) el.value = Math.round(p * 100 / n); });
        res = ACI.parseTesto(testo);
      } else if (ext === 'csv') res = ACI.parseCsv(await file.text());
      else if (ext === 'json') {
        const j = JSON.parse(await file.text());
        if (!Array.isArray(j.righe)) throw new Error('JSON non nel formato atteso (campo "righe").');
        const righe = [], anomalie = [];
        j.righe.forEach((r, i) => {
          const ck = FB.num(Array.isArray(r) ? r[6] : NaN, false);
          const alim = Array.isArray(r) ? String(r[3] || '').toLowerCase() : '';
          if (!Array.isArray(r) || !(ck > 0) || !ACI.ALIM_ACI.includes(alim)) { anomalie.push(`riga ${i + 1}: costo km o alimentazione non validi`); return; }
          righe.push({ id: r[0] == null || r[0] === '' ? null : Number(r[0]), marca: String(r[1] || ''), modello: String(r[2] || ''), alim, sotto: String(r[4] || ''), prod: r[5] === 1 || r[5] === true, ck });
        });
        res = { righe, anomalie };
        if (j.anno) $('#imp-anno').value = j.anno;
        if (j.fonte) $('#imp-fonte').value = j.fonte;
      } else throw new Error('Formato non supportato: usa PDF, CSV o JSON.');
      S.imp = { nome: file.name, ...res };
      mostraAnteprima();
    } catch (e) {
      out.innerHTML = `<div class="note bad"><p><b>Impossibile leggere il file:</b> ${esc(e.message || e)}</p></div>`;
    }
  }
  function mostraAnteprima() {
    const { righe, anomalie, nome } = S.imp, out = $('#imp-out');
    const per = {}; righe.forEach((r) => { per[r.alim] = (per[r.alim] || 0) + 1; });
    const anni = ACI.anni(), prec = anni.length ? ACI.get(anni[anni.length - 1]).righe.length : 0;
    const avvisi = [];
    if (righe.length < 1000) avvisi.push(`Sono stati letti solo ${righe.length} modelli: le tabelle complete ne contengono migliaia. Il PDF potrebbe non essere quello giusto o il formato è cambiato.`);
    else if (prec && Math.abs(righe.length - prec) / prec > 0.3) avvisi.push(`Il numero di modelli (${righe.length}) differisce di oltre il 30% dall'ultima tabella (${prec}): controlla l'anteprima.`);
    if (!per.autocaravan && !per.moto) avvisi.push('Non risultano sezioni autocaravan o motoveicoli: verifica che il PDF sia completo.');
    out.innerHTML = `<h3>Anteprima: ${esc(nome)}</h3>
      <div class="note ${righe.length ? 'ok' : 'bad'}"><p><b>${righe.length.toLocaleString('it-IT')} modelli letti.</b> ${Object.entries(per).map(([k, v]) => `${ACI.ALIM_ETICHETTE[k]}: ${v}`).join(' · ')}</p></div>
      ${avvisi.map((a) => `<div class="note warn"><p>${esc(a)}</p></div>`).join('')}
      ${anomalie.length ? `<details><summary>${anomalie.length} righe da controllare</summary><ul>${anomalie.slice(0, 20).map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul></details>` : ''}
      <div class="scroll"><table><thead><tr><th>ID</th><th>Marca</th><th>Modello</th><th>Alim.</th><th class="num">Costo km</th></tr></thead><tbody>${righe.slice(0, 5).map((r) => `<tr><td>${r.id ?? ''}</td><td>${esc(r.marca)}</td><td>${esc(r.modello)}</td><td>${esc(r.alim)}</td><td class="num">${n4(r.ck)}</td></tr>`).join('')}</tbody></table></div>
      <div class="note"><p>Le regole fiscali per questo anno saranno quelle della versione più recente ≤ anno (vedi sezione 2): controlla che siano ancora corrette.</p></div>
      <div class="actions"><div></div><div class="r"><button class="btn" data-ag="impsalva" ${righe.length ? '' : 'disabled'}>Salva le tabelle nel browser</button></div></div>`;
  }
  async function salvaImport() {
    const anno = Number($('#imp-anno').value);
    if (!(anno >= 2020)) { toast('Indica l\'anno d\'imposta'); return; }
    if (ACI.get(anno) && !confirm(`Esistono già tabelle per il ${anno}: sostituirle con queste?`)) return;
    const d = ACI.creaDataset(anno, $('#imp-fonte').value, S.imp.righe);
    try { await ACI.salvaImportata(d); } catch (e) { toast('Impossibile salvare nel browser: scarica il file .js'); scarica(`aci-${anno}.js`, ACI.esportaJs(d), 'text/javascript'); return; }
    S.imp = null; S.anno = anno; LS.set('fb.anno', anno); aggiornaAnni(); renderAgg();
    toast(`Tabelle ACI ${anno} salvate. Anno d'imposta impostato su ${anno}.`);
    $('#imp-out').innerHTML = `<div class="note ok"><p>Fatto. Per averle <b>per tutti gli utenti</b>, scarica il file <code>aci-${anno}.js</code> dall'elenco sopra, copialo in <code>data/aci/</code> e aggiungi ${anno} in <code>data/aci/manifest.js</code>
      (oppure usa <code>tools/pdf_to_aci.py</code>, che lo fa da solo).</p></div>`;
  }

  // ---------- navigazione ----------
  function aggiornaAnni() {
    const anni = ACI.anni();
    if (!anni.includes(S.anno)) S.anno = anni[anni.length - 1];
    $('#anno').innerHTML = anni.map((a) => `<option ${a === S.anno ? 'selected' : ''}>${a}</option>`).join('');
  }
  function setTab(t) {
    S.tab = t;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab').forEach((s) => { s.hidden = s.id !== `tab-${t}`; });
    ({ calcolo: renderCalcolo, flotta: renderFlotta, guida: renderGuida, aci: renderAci, agg: renderAgg })[t]();
    window.scrollTo({ top: 0 });
  }
  $('#tabs').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setTab(b.dataset.tab); });
  $('#anno').addEventListener('change', (ev) => { S.anno = Number(ev.target.value); LS.set('fb.anno', S.anno); setTab(S.tab); });

  (async function avvio() {
    await ACI.init();
    const salvato = LS.get('fb.anno', null);
    const anni = ACI.anni();
    S.anno = anni.includes(salvato) ? salvato : anni[anni.length - 1];
    aggiornaAnni();
    $('#n-flotta').textContent = S.flotta.length;
    setTab('calcolo');
    window.__app = { S, calcolaVeicolo, setTab }; // per i test
  })();
})();
