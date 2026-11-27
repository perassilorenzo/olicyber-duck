/** Assistente: chat persistenti, contesto challenge, streaming e annullamento sicuro. */

import { byId, formatTime, toast, confirmDialog } from './utils.js';
import { sendChat, ApiError } from './api.js';
import { renderMarkdownInto } from './markdown.js';
import {
  GENERAL_CONVERSATION_ID, SELECTED_CHALLENGE_ID_PATTERN, CHAT_CONVERSATION_PREFIX,
} from './store.js';

const MAX_HISTORY = 20;
const MAX_HISTORY_ANCHORS = 2;
const MAX_EXCERPT_CHARS = 2000;

/**
 * Nelle conversazioni lunghe conserva le prime domande che stabiliscono
 * l'argomento insieme agli scambi più recenti, mantenendo l'ordine originale.
 */
function historyForRequest(conversation) {
  const older = conversation.slice(0, Math.max(0, conversation.length - MAX_HISTORY));
  const anchors = older.filter((item) => item?.role === 'user').slice(0, MAX_HISTORY_ANCHORS);
  const recent = conversation.slice(-MAX_HISTORY);
  const kept = new Set([...anchors, ...recent]);
  return conversation.filter((item) => kept.has(item)).map(({ role, content }) => ({ role, content }));
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

/** Chiave stabile per le conversazioni contestuali automatiche. */
function conversationKeyFor(ids) {
  return ids.length ? `ctx:${[...ids].sort().join('|')}` : GENERAL_CONVERSATION_ID;
}

function isExplicitChat(id) {
  return typeof id === 'string' && id.startsWith(CHAT_CONVERSATION_PREFIX);
}

function shortTitle(message) {
  return String(message || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function createAssistant({ store, getSelectedChallenges, getChallenge, onConversationChange }) {
  const log = byId('chat-log');
  const empty = byId('chat-empty');
  const form = byId('chat-form');
  const input = byId('chat-input');
  const sendButton = byId('send-chat');
  const cancelButton = byId('cancel-chat');
  const clearButton = byId('clear-chat');
  const contextLabel = byId('assistant-context-label');
  const contextChips = byId('assistant-context-chips');
  const status = byId('chat-status');
  const errorBox = byId('chat-error');
  const errorMessage = byId('chat-error-message');
  const retryButton = byId('retry-chat');
  const modeButtons = [byId('mode-general'), byId('mode-challenge')];
  const challengeHint = byId('mode-challenge-hint');
  const statementInput = byId('statement-input');

  function readSelection() {
    const provider = getSelectedChallenges
      || (() => { const challenge = getChallenge?.(); return challenge ? [challenge] : []; });
    return (provider() || [])
      .filter((challenge) => challenge && typeof challenge.id === 'string'
        && SELECTED_CHALLENGE_ID_PATTERN.test(challenge.id));
  }

  // Una chat salvata viene riaperta con i suoi ID: il contesto non dipende
  // dall'ordine con cui l'utente ha cliccato le card nella sessione corrente.
  let applyingContext = false;
  const savedId = store.getActiveConversation();
  if (savedId !== GENERAL_CONVERSATION_ID && store.getConversation(savedId).length) {
    const savedMeta = store.getConversationMeta(savedId);
    if (savedMeta.challengeIds.length) {
      applyingContext = true;
      store.setSelectedChallengeIds(savedMeta.challengeIds);
      applyingContext = false;
    }
  }
  let selections = readSelection();
  let mode = savedId !== GENERAL_CONVERSATION_ID
    && store.getConversationMeta(savedId).kind === 'challenge'
    ? 'challenge'
    : (selections.length ? 'challenge' : 'general');
  let key = savedId !== GENERAL_CONVERSATION_ID && store.getConversation(savedId).length
    ? savedId
    : (mode === 'challenge' ? conversationKeyFor(selections.map((challenge) => challenge.id)) : GENERAL_CONVERSATION_ID);
  if (mode === 'challenge' && !selections.length) mode = 'general';
  if (mode === 'general' && key !== GENERAL_CONVERSATION_ID && !store.getConversationMeta(key).challengeIds.length) {
    // Le chat generali esplicite restano valide: solo le chiavichallenge orfane
    // vengono riportate alla chat generale canonica.
    if (!isExplicitChat(key)) key = GENERAL_CONVERSATION_ID;
  }
  let active = null;
  let aiMode = null;
  let statusMessage = '';
  const lastRequests = new Map();

  function messageNode(message, options = {}) {
    const wrapper = node('div', `chat-message chat-message--${message.role}`);
    if (options.greeting) wrapper.classList.add('chat-message--greeting');
    wrapper.append(node('span', 'chat-message__role', message.role === 'user' ? 'Tu' : 'OliDuck'));
    const bubble = node('div', 'chat-message__bubble');
    if (message.role === 'assistant') {
      // Markdown del modello: renderizzato in nodi, mai come HTML.
      bubble.classList.add('chat-message__bubble--markdown');
      renderMarkdownInto(bubble, message.content);
    } else {
      bubble.textContent = String(message.content ?? '');
    }
    wrapper.append(bubble);
    if (message.createdAt) wrapper.append(node('span', 'chat-message__time', formatTime(message.createdAt)));
    return wrapper;
  }

  function readStatementExcerpt() {
    return statementInput ? String(statementInput.value || '').trim().slice(0, MAX_EXCERPT_CHARS) : '';
  }

  function clearStatementExcerpt() {
    if (statementInput) statementInput.value = '';
  }

  function selectedTitles() {
    return selections.map((challenge) => challenge.title);
  }

  function greeting() {
    if (mode === 'challenge' && selections.length) {
      const titles = selectedTitles().map((title) => `"${title}"`).join(', ');
      return `Contesto pronto: ${titles}.\n\nDescrivi cosa hai capito, chiedi un primo hint o proponi il tuo ragionamento: procederò per passaggi, senza darti subito una soluzione.`;
    }
    const pending = selectedTitles().length
      ? ` Hai ${selectedTitles().length} challenge selezionate (${selectedTitles().join(', ')}), ma la conversazione generale non le include.`
      : ' Per un tutor contestuale, seleziona una challenge dalla libreria.';
    return `Modalità generale: nessuna challenge inclusa nel contesto.${pending} Puoi chiedermi di spiegare un concetto di cybersecurity, un metodo di analisi o come impostare lo studio.`;
  }

  function renderChips() {
    if (!contextChips) return;
    contextChips.replaceChildren();
    contextChips.hidden = selections.length === 0;
    for (const challenge of selections) {
      const chip = node('span', 'context-chip');
      chip.dataset.id = challenge.id;
      chip.append(node('span', 'context-chip__label', challenge.title));
      const remove = node('button', 'context-chip__remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Rimuovi ${challenge.title} dal contesto`);
      remove.addEventListener('click', () => {
        store.setSelectedChallengeIds(store.getSelectedChallengeIds().filter((id) => id !== challenge.id));
      });
      chip.append(remove);
      contextChips.append(chip);
    }
  }

  function hideError() {
    errorBox.hidden = true;
    errorMessage.textContent = '';
    retryButton.hidden = true;
  }

  function showError(message, canRetry = false) {
    errorMessage.textContent = message;
    retryButton.hidden = !canRetry;
    errorBox.hidden = false;
  }

  function scrollToEnd() {
    log.scrollTop = log.scrollHeight;
  }

  function render() {
    const busyHere = Boolean(active && active.key === key);
    const canChallenge = selections.length > 0;
    for (const button of modeButtons) {
      const selected = button.id === (mode === 'general' ? 'mode-general' : 'mode-challenge');
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('is-active', selected);
    }
    challengeHint.textContent = canChallenge
      ? (selections.length === 1 ? selections[0].title : `${selections.length} challenge selezionate`)
      : 'Seleziona una challenge';

    const suffix = aiMode === 'demo' ? ' · DEMO' : aiMode === 'error' ? ' · offline' : '';
    const titles = selectedTitles();
    contextLabel.textContent = mode === 'challenge' && titles.length
      ? `Challenge: ${titles.join(', ')}${suffix}`
      : `Modalità generale${titles.length ? ` · selezionate: ${titles.join(', ')}` : ''}${suffix}`;
    renderChips();

    log.replaceChildren();
    empty.hidden = true;
    log.append(messageNode({ role: 'assistant', content: greeting() }, { greeting: true }));
    const messages = store.getConversation(key);
    for (const message of messages) log.append(messageNode(message));
    if (busyHere && active?.typing) log.append(active.typing);

    clearButton.disabled = messages.length === 0;
    sendButton.disabled = busyHere || !input.value.trim();
    cancelButton.hidden = !busyHere;
    input.disabled = busyHere;
    status.textContent = busyHere ? 'OliDuck sta rispondendo…' : statusMessage;
    scrollToEnd();
  }

  /** Apre una chat esistente, ripristinando il suo contesto challenge. */
  function openConversation(id, { keepSelection = false } = {}) {
    if (typeof id !== 'string' || !id) return false;
    const automaticContext = id.startsWith('ctx:');
    if (id !== GENERAL_CONVERSATION_ID && !store.getConversation(id).length
      && !isExplicitChat(id) && !automaticContext) return false;
    if (active) { active.controller.abort(); active = null; }
    const meta = store.getConversationMeta(id);
    if (meta.kind === 'challenge' && meta.challengeIds.length) {
      mode = 'challenge';
      if (!keepSelection) {
        applyingContext = true;
        store.setSelectedChallengeIds(meta.challengeIds);
        applyingContext = false;
      }
      selections = readSelection();
    } else {
      mode = 'general';
    }
    key = id;
    store.setActiveConversation(id);
    statusMessage = '';
    input.value = '';
    input.style.height = '';
    clearStatementExcerpt();
    hideError();
    render();
    onConversationChange?.();
    return true;
  }

  /** Una nuova chat parte sempre senza contesto challenge: non eredita la sessione. */
  function newChat() {
    const id = store.createConversation({
      title: 'Nuova chat',
      challengeIds: [],
    });
    openConversation(id, { keepSelection: true });
    input.focus();
    return id;
  }

  /** Rilegge lo store dopo una selezione multipla e mantiene coerente la conversazione. */
  function syncSelection() {
    if (applyingContext) return;
    selections = readSelection();
    if (mode === 'challenge' && !selections.length) mode = 'general';
    const canonical = mode === 'challenge'
      ? conversationKeyFor(selections.map((challenge) => challenge.id))
      : GENERAL_CONVERSATION_ID;
    if (canonical === key) { render(); return; }
    // Una chat esplicita con lo stesso contesto non viene sostituita dalla
    // conversazione automatica: resta nella cronologia con il suo titolo.
    const currentMeta = store.getConversationMeta(key);
    const sameContext = currentMeta.kind === (mode === 'challenge' ? 'challenge' : 'general')
      && JSON.stringify(currentMeta.challengeIds) === JSON.stringify(mode === 'challenge' ? selections.map((c) => c.id) : []);
    if (isExplicitChat(key) && sameContext) { render(); return; }
    openConversation(canonical, { keepSelection: true });
  }

  function finalize(request) {
    if (active?.controller !== request.controller) return;
    active = null;
    render();
  }

  async function submit(rawMessage, { isRetry = false } = {}) {
    const message = String(rawMessage || '').trim();
    if (!message || active) return;
    const previous = lastRequests.get(key);
    const storedExcerpt = store.getConversationMeta(key).statementExcerpt || '';
    const statementExcerpt = isRetry
      ? (previous?.statementExcerpt || storedExcerpt)
      : (readStatementExcerpt() || storedExcerpt);
    statusMessage = '';
    const requestChallengeIds = mode === 'challenge'
      ? selections.map((challenge) => challenge.id)
      : [];
    if (mode === 'challenge' && !requestChallengeIds.length) {
      showError('Seleziona almeno una challenge per usare la modalità contestuale.');
      return;
    }

    let conversation = store.getConversation(key);
    if (isRetry && conversation.at(-1)?.role === 'user' && conversation.at(-1)?.content === message) {
      conversation = conversation.slice(0, -1);
    }
    const history = historyForRequest(conversation);
    if (!isRetry) {
      const metaPatch = {};
      if (statementExcerpt) metaPatch.statementExcerpt = statementExcerpt;
      if (isExplicitChat(key) && /^Nuova chat/.test(store.getConversationMeta(key).title)) {
        metaPatch.title = shortTitle(message) || 'Chat';
      }
      if (Object.keys(metaPatch).length) store.setConversationMeta(key, metaPatch);
      store.appendMessage(key, {
        role: 'user', content: message, createdAt: new Date().toISOString(),
      });
    }
    lastRequests.set(key, { message, statementExcerpt, challengeIds: [...requestChallengeIds] });
    hideError();

    input.value = '';
    input.style.height = '';
    clearStatementExcerpt();
    const typing = node('div', 'chat-message chat-message--assistant');
    typing.append(node('span', 'chat-message__role', 'OliDuck'));
    const bubble = node('div', 'chat-message__bubble typing');
    bubble.setAttribute('aria-label', 'OliDuck sta rispondendo');
    for (let dot = 0; dot < 3; dot += 1) bubble.append(node('i'));
    typing.append(bubble);
    log.append(typing);
    scrollToEnd();

    const controller = new AbortController();
    const request = { key, controller, typing, message };
    active = request;
    render();
    scrollToEnd();

    try {
      const result = await sendChat(
        { challengeIds: requestChallengeIds, message, history, statementExcerpt },
        {
          signal: controller.signal,
          onProgress: (cumulative) => {
            if (request.typing.isConnected) {
              bubble.classList.remove('typing');
              bubble.classList.add('chat-message__bubble--markdown');
              renderMarkdownInto(bubble, cumulative);
              scrollToEnd();
            }
          },
        },
      );
      const reply = result.reply || 'Il backend non ha restituito una risposta utilizzabile.';
      if (active?.controller === controller) {
        store.appendMessage(key, {
          role: 'assistant', content: reply, createdAt: new Date().toISOString(),
        });
        onConversationChange?.();
      }
      finalize(request);
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (active?.controller === controller) statusMessage = 'Richiesta annullata.';
      } else {
        const text = error instanceof ApiError
          ? error.message
          : 'Non è stato possibile contattare l’assistente. Controlla la connessione e riprova.';
        if (active?.controller === controller) {
          showError(text, lastRequests.has(key));
          statusMessage = 'Richiesta non riuscita.';
        }
      }
      finalize(request);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!active) submit(input.value);
  });

  input.addEventListener('keydown', (event) => {
    // IME: Invio completa la composizione del carattere, non il messaggio.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!active) form.requestSubmit();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    if (!active) {
      sendButton.disabled = !input.value.trim();
      if (!errorBox.hidden) hideError();
    }
  });

  cancelButton.addEventListener('click', () => active?.controller.abort());

  retryButton.addEventListener('click', () => {
    const previous = lastRequests.get(key);
    if (previous?.message) submit(previous.message, { isRetry: true });
  });

  clearButton.addEventListener('click', async () => {
    const meta = store.getConversationMeta(key);
    const ok = await confirmDialog(`Cancellare la chat “${meta.title}” salvata in questo browser? L'operazione non è reversibile.`);
    if (!ok) return;
    if (active?.key === key) { active.controller.abort(); active = null; }
    if (isExplicitChat(key)) store.deleteConversation(key);
    else store.clearConversation(key);
    lastRequests.delete(key);
    statusMessage = '';
    hideError();
    openConversation(GENERAL_CONVERSATION_ID, { keepSelection: true });
    toast('Chat cancellata.');
  });

  function switchMode(next) {
    const target = next === 'challenge' ? 'challenge' : 'general';
    if (target === 'challenge') {
      selections = readSelection();
      if (!selections.length) {
        showError('Seleziona una challenge dalla libreria per aprire una conversazione contestuale.');
        return;
      }
      mode = 'challenge';
      const canonical = conversationKeyFor(selections.map((challenge) => challenge.id));
      if (canonical === key) { render(); return; }
      openConversation(canonical, { keepSelection: true });
      return;
    }
    mode = 'general';
    if (key === GENERAL_CONVERSATION_ID) { render(); return; }
    openConversation(GENERAL_CONVERSATION_ID, { keepSelection: true });
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => switchMode(button.id === 'mode-general' ? 'general' : 'challenge'));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = button.id === 'mode-general' ? 'challenge' : 'general';
      switchMode(next);
      modeButtons.find((item) => item.id === (next === 'general' ? 'mode-general' : 'mode-challenge'))?.focus();
    });
  }

  render();

  return {
    render,
    syncSelection,
    switchMode,
    newChat,
    openConversation,
    deleteConversation(id) {
      if (typeof id !== 'string') return;
      if (active?.key === id) { active.controller.abort(); active = null; }
      store.deleteConversation(id);
      lastRequests.delete(id);
      if (key === id) openConversation(GENERAL_CONVERSATION_ID, { keepSelection: true });
      else onConversationChange?.();
    },
    focus() { if (!input.disabled) input.focus(); },
    setMode(next) { aiMode = next; render(); },
    /** Compatibilità con il vecchio singolo ID: sostituisce la selezione. */
    selectChallenge(next) {
      const id = typeof next === 'string' ? next : next?.id;
      store.selectChallenge(id || null);
      syncSelection();
      switchMode(id ? 'challenge' : 'general');
    },
    get selectedChallenges() { return [...selections]; },
    get isBusy() { return Boolean(active && active.key === key); },
    get conversationKey() { return key; },
    get isApplyingContext() { return applyingContext; },
  };
}
