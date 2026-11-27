/** Risposta simulata, esplicitamente etichettata: NON è una generazione AI. */

const HEADER = '**[MODALITÀ DEMO — risposta simulata, non generata da un modello AI]**\n\n';

/**
 * Spiegazione DEMO della consegna incollata: usa solo termini presenti nel
 * testo fornito dallo studente. Non è una soluzione e non inventa selettori,
 * valori o risultati della challenge.
 */
function statementExplanation(text) {
  const clean = String(text || '').trim();
  const url = clean.match(/https?:\/\/[^\s.,;)]+/)?.[0] || '';
  const lines = [
    'Ho letto la consegna che hai incollato: la tengo come contesto della conversazione e non ti chiedo di ripeterla.',
  ];

  if (/\b(?:letter|caratter|highlight|evidenziat)\w*/i.test(clean)) {
    lines.push('In parole semplici: devi distinguere nel documento le parti che la consegna indica (qui le lettere evidenziate) dal resto del contenuto.');
  } else {
    lines.push('In parole semplici: la consegna descrive un compito e alcune informazioni da usare; il primo passo è separare ciò che è dato da ciò che devi ottenere.');
  }
  if (/\b(?:obiettivo|formano|concaten|ricav|isol|ottenere|presentat)\w*/i.test(clean)) {
    lines.push('Obiettivo: ricostruire il risultato richiesto partendo solo dai dati indicati, senza inventare il valore finale.');
  }
  if (url) {
    lines.push(`Cosa hai a disposizione: l’indirizzo ${url} citato nella consegna e il contenuto che ottieni aprendolo.`);
  }
  const technologies = [];
  if (/beautifulsoup/i.test(clean)) {
    technologies.push('BeautifulSoup serve a leggere il documento HTML come struttura di elementi');
  }
  if (/find_all/i.test(clean)) {
    technologies.push('`find_all()` serve a cercare elementi che soddisfano una condizione, non una condizione già nota');
  }
  if (/\b(?:iter|itera|iterare|ciclo|for)\b/i.test(clean)) {
    technologies.push('iterare significa esaminare un elemento alla volta i risultati di una ricerca');
  }
  if (/concaten/i.test(clean)) {
    technologies.push('concatenare significa unire i pezzi di testo raccolti in un’unica stringa');
  }
  if (technologies.length) {
    lines.push(`Tecnologie menzionate: ${technologies.join('; ')}.`);
  }
  lines.push('Come ragionare: osserva prima la struttura del documento, poi cerca una regola che distingua gli elementi rilevanti e verificala sulla pagina reale prima di scrivere codice.');
  lines.push('Da dove iniziare: apri la pagina, guarda il sorgente e descrivi con parole tue la differenza tra gli elementi evidenziati e gli altri, senza scrivere ancora una soluzione.');
  lines.push('Cosa impari: come passare da una descrizione in linguaggio naturale a una domanda precisa sui dati, primo passo di ogni analisi di una pagina web.');
  return lines.join('\n\n');
}

export function demoReply({
  challenges = [], challenge = null, history = [], message, sources = [],
  statement = '', intent = '',
} = {}) {
  const selected = Array.isArray(challenges) && challenges.length
    ? challenges
    : (challenge ? [challenge] : []);
  const real = selected.filter((item) => item && item.general !== true);
  const attempts = history.filter((item) => item.role === 'user').length + 1;
  const topics = unique(real.flatMap((item) => (Array.isArray(item.tags) ? item.tags : [])));
  const topic = topics[Math.min(attempts - 1, Math.max(topics.length - 1, 0))] || 'i concetti generali';
  const titles = real.map((item) => `"${item.title}"`).join(', ');
  const categories = unique(real.map((item) => item.category).filter(Boolean)).join(', ') || 'categoria non indicata';

  let body;
  if (statement && intent !== 'request_solution') {
    body = statementExplanation(statement);
  } else if (!real.length) {
    body = 'Sei in modalità di studio generale sulla cybersecurity (nessuna challenge selezionata).\n\n'
      + 'Per iniziare, dimmi quale concetto vuoi esplorare e cosa ne hai già capito. '
      + 'In modalità AI, OliDuck ti guiderebbe con spiegazioni e hint progressivi, senza sostituire il tuo ragionamento.';
  } else if (attempts === 1) {
    body = `Hai selezionato ${titles} (${categories}).\n\n`
      + 'Per iniziare, prova a rispondere a due domande: quali informazioni sono esplicitamente date e cosa devi ottenere? '
      + `Un primo aspetto da osservare è: ${topic}.\n\n`
      + 'Scrivimi il tuo ragionamento: in modalità AI, OliDuck lo analizzerebbe e ti darebbe un hint progressivo senza rivelare la soluzione.';
  } else if (attempts === 2) {
    body = 'Hai già fatto un tentativo: questo è il secondo passo del percorso didattico.\n\n'
      + `Cerca di collegare ciò che hai osservato con ${topic}. `
      + 'Quale concetto tecnico spiega quel comportamento? Se vuoi, descrivi il passaggio in cui ti sei bloccato.';
  } else {
    body = 'Stai procedendo per tentativi: il metodo è corretto.\n\n'
      + `A questo punto conviene verificare l'ipotesi su ${topic} e spiegare perché funziona. `
      + 'Un tutor AI analizzerebbe la tua ipotesi e ti aiuterebbe a validarla, senza dare la risposta finale.';
  }

  // In modalità DEMO non c'è generazione AI: vengono mostrati solo i metadati
  // delle fonti didattiche. I testi dei documenti non entrano nella risposta.
  const visibleSources = sources.slice(0, 3);
  const rag = visibleSources.length
    ? `\n\n---\nContesto recuperato dalla knowledge base didattica (${sources.length} document${sources.length === 1 ? 'o' : 'i'}; soli metadati, nessuna generazione AI): ${
      visibleSources.map((source) => source.title).join('; ')
    }.`
    : '\n\n---\nNessun documento didattico pertinente: informazioni insufficienti per un contesto aggiuntivo.';

  const notice = '\n\n---\nPer ricevere risposte reali, configura il binding Workers AI (vedi README).';
  return HEADER + body + rag + notice;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
