/** Assistente: conversazioni per contesto multiplo, modalità generale, streaming e annullamento sicuro. */

import { byId, formatTime, toast, confirmDialog } from './utils.js';
import { sendChat, ApiError } from './api.js';
import { GENERAL_CONVERSATION_ID, SELECTED_CHALLENGE_ID_PATTERN } from './store.js';

const MAX_HISTORY = 12;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

/** Chiave stabile: l'ordine di selezione non deve cambiare la conversazione. */
function conversationKeyFor(ids) {
  return ids.length ? `ctx:${[...ids].sort().join('|')}` : GENERAL_CONVERSATION_ID;
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

  function readSelection() {
    const provider = getSelectedChallenges
      || (() => { const challenge = getChallenge?.(); return challenge ? [challenge] : []; });
    return (provider() || [])
      .filter((challenge) => challenge && typeof challenge.id === 'string'
        && SELECTED_CHALLENGE_ID_PATTERN.test(challenge.id));
  }

  let selections = readSelection();
  let mode = selections.length ? 'challenge' : 'general';
  let key = conversationKeyFor(selections.map((challenge) => challenge.id));
  let active = null;
  let aiMode = null;
  let statusMessage = '';
  const lastRequests = new Map();

  function messageNode(message) {
    const wrapper = node('div', `chat-message chat-message--${message.role}`);
    wrapper.append(node('span', 'chat-message__role', message.role === 'user' ? 'Tu' : 'OliDuck'));
    wrapper.append(node('div', 'chat-message__bubble', message.content));
    if (message.createdAt) wrapper.append(node('span', 'chat-message__time', formatTime(message.createdAt)));
    return wrapper;
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
    log.append(messageNode({ role: 'assistant', content: greeting() }));
    for (const message of store.getConversation(key)) log.append(messageNode(message));
    if (busyHere && active?.typing) log.append(active.typing);

    clearButton.disabled = store.getConversation(key).length === 0;
    sendButton.disabled = busyHere || !input.value.trim();
    cancelButton.hidden = !busyHere;
    input.disabled = busyHere;
    status.textContent = busyHere ? 'OliDuck sta rispondendo…' : statusMessage;
    scrollToEnd();
  }

  /** Rilegge lo store dopo una selezione multipla e mantiene coerente la conversazione. */
  function syncSelection() {
    selections = readSelection();
    if (mode === 'challenge' && !selections.length) mode = 'general';
    const nextKey = mode === 'challenge'
      ? conversationKeyFor(selections.map((challenge) => challenge.id))
      : GENERAL_CONVERSATION_ID;
    if (nextKey !== key) {
      if (active) { active.controller.abort(); active = null; }
      statusMessage = '';
      input.value = '';
      input.style.height = '';
      hideError();
      key = nextKey;
    }
    render();
  }

  function finalize(request) {
    if (active?.controller !== request.controller) return;
    active = null;
    render();
  }

  async function submit(rawMessage, { isRetry = false } = {}) {
    const message = String(rawMessage || '').trim();
    if (!message || active) return;
    statusMessage = '';
    const requestChallengeIds = mode === 'challenge'
      ? selections.map((challenge) => challenge.id)
      : [];
    const requestKey = mode === 'challenge'
      ? conversationKeyFor(requestChallengeIds)
      : GENERAL_CONVERSATION_ID;
    if (mode === 'challenge' && !requestChallengeIds.length) {
      showError('Seleziona almeno una challenge per usare la modalità contestuale.');
      return;
    }

    let conversation = store.getConversation(requestKey);
    if (isRetry && conversation.at(-1)?.role === 'user' && conversation.at(-1)?.content === message) {
      conversation = conversation.slice(0, -1);
    }
    const history = conversation.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content }));
    if (!isRetry) {
      store.appendMessage(requestKey, {
        role: 'user', content: message, createdAt: new Date().toISOString(),
      });
    }
    lastRequests.set(requestKey, message);
    hideError();

    input.value = '';
    input.style.height = '';
    const typing = node('div', 'chat-message chat-message--assistant');
    typing.append(node('span', 'chat-message__role', 'OliDuck'));
    const bubble = node('div', 'chat-message__bubble typing');
    bubble.setAttribute('aria-label', 'OliDuck sta rispondendo');
    bubble.innerHTML = '<i></i><i></i><i></i>';
    typing.append(bubble);
    log.append(typing);
    scrollToEnd();

    const controller = new AbortController();
    const request = { key: requestKey, controller, typing, message };
    active = request;
    render();
    scrollToEnd();

    try {
      const result = await sendChat(
        { challengeIds: requestChallengeIds, message, history },
        {
          signal: controller.signal,
          onProgress: (cumulative) => {
            if (request.typing.isConnected) {
              bubble.classList.remove('typing');
              bubble.textContent = cumulative;
              scrollToEnd();
            }
          },
        },
      );
      const reply = result.reply || 'Il backend non ha restituito una risposta utilizzabile.';
      if (active?.controller === controller) {
        store.appendMessage(requestKey, {
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
          showError(text, lastRequests.has(requestKey));
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
    const message = lastRequests.get(key);
    if (message) submit(message, { isRetry: true });
  });

  clearButton.addEventListener('click', async () => {
    if (mode === 'general') {
      const okGeneral = await confirmDialog('Cancellare la conversazione generale salvata in questo browser?');
      if (!okGeneral) return;
    } else {
      const titles = selectedTitles().join(', ');
      const okChallenge = await confirmDialog(
        `Cancellare la conversazione di ${titles}? L'operazione non è reversibile.`,
      );
      if (!okChallenge) return;
    }
    if (active?.key === key) { active.controller.abort(); active = null; }
    store.clearConversation(key);
    lastRequests.delete(key);
    statusMessage = '';
    hideError();
    render();
    toast('Conversazione cancellata.');
    onConversationChange?.();
  });

  function switchMode(next) {
    const target = next === 'challenge' ? 'challenge' : 'general';
    if (target === 'challenge') syncSelection();
    if (target === 'challenge' && !selections.length) {
      showError('Seleziona una challenge dalla libreria per aprire una conversazione contestuale.');
      return;
    }
    if (target === mode) {
      if (target === 'challenge') key = conversationKeyFor(selections.map((challenge) => challenge.id));
      return;
    }
    if (active) { active.controller.abort(); active = null; }
    statusMessage = '';
    mode = target;
    key = target === 'challenge'
      ? conversationKeyFor(selections.map((challenge) => challenge.id))
      : GENERAL_CONVERSATION_ID;
    input.value = '';
    input.style.height = '';
    hideError();
    render();
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
  };
}
