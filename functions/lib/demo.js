/** Risposta simulata, esplicitamente etichettata: NON è una generazione AI. */

const HEADER = '**[MODALITÀ DEMO — risposta simulata, non generata da un modello AI]**\n\n';

export function demoReply({ challenge, history = [], message }) {
  const attempts = history.filter((item) => item.role === 'user').length + 1;
  const general = challenge?.general === true;
  const topics = challenge?.hintTopics?.length ? challenge.hintTopics : (challenge?.tags || []);
  const topic = topics[Math.min(attempts - 1, Math.max(topics.length - 1, 0))] || 'il testo della challenge';
  const title = challenge?.title || 'questa challenge';

  let body;
  if (general) {
    body = `Sei in modalità di studio generale sulla cybersecurity (nessuna challenge selezionata).\n\n`
      + `Per iniziare, dimmi quale concetto vuoi esplorare e cosa ne hai già capito. `
      + `In modalità AI, OliDuck ti guiderebbe con spiegazioni e hint progressivi, senza sostituire il tuo ragionamento.`;
  } else if (attempts === 1) {
    body = `Hai selezionato "${title}" (${challenge.category || 'categoria non indicata'}, ${challenge.difficulty || 'difficoltà non indicata'}).\n\n`
      + `Per iniziare, prova a rispondere a due domande: quali informazioni sono esplicitamente date e cosa devi ottenere? `
      + `Un primo aspetto da osservare è: ${topic}.\n\n`
      + 'Scrivimi il tuo ragionamento: in modalità AI, OliDuck lo analizzerebbe e ti darebbe un hint progressivo senza rivelare la soluzione.';
  } else if (attempts === 2) {
    body = `Hai già fatto un tentativo: questo è il secondo passo del percorso didattico.\n\n`
      + `Cerca di collegare ciò che hai osservato con ${topic}. `
      + 'Quale concetto tecnico spiega quel comportamento? Se vuoi, descrivi il passaggio in cui ti sei bloccato.';
  } else {
    body = `Stai procedendo per tentativi: il metodo è corretto.\n\n`
      + `A questo punto conviene verificare l'ipotesi su ${topic} e spiegare perché funziona. `
      + 'Un tutor AI analizzerebbe la tua ipotesi e ti aiuterebbe a validarla, senza dare la risposta finale.';
  }

  const notice = '\n\n---\nPer ricevere risposte reali, configura il binding Workers AI (vedi README).';
  return HEADER + body + notice;
}
