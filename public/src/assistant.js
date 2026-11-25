/** Assistente: conversazioni separate per challenge, modalità generale, streaming e annullamento sicuro. */

import { byId, formatTime, toast, confirmDialog } from './utils.js';
import { sendChat, ApiError } from './api.js';
import { GENERAL_CONVERSATION_ID } from './store.js';

const MAX_HISTORY = 12;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

export function createAssistant({ store, getChallenge, onConversationChange }) {
  const log = byId('chat-log');
  const empty = byId('chat-empty');
  const form = byId('chat-form');
  const input = byId('chat-input');
  const sendButton = byId('send-chat');
  const cancelButton = byId('cancel-chat');
  const clearButton = byId('clear-chat');
  const contextLabel = byId('assistant-context-label');
  const status = byId('chat-status');
  const errorBox = byId('chat-error');
  const errorMessage = byId('chat-error-message');
  const retryButton = byId('retry-chat');
  const modeButtons = [byId('mode-general'), byId('mode-challenge')];
  const challengeHint = byId('mode-challenge-hint');

  let challenge = getChallenge() || null;
  let mode = challenge ? 'challenge' : 'general';
  let key = challenge ? challenge.id : GENERAL_CONVERSATION_ID;
  let active = null;
  let aiMode = null;
  const lastRequests = new Map();

  function messageNode(message) {
    const wrapper = node('div', `chat-message chat-message--${message.role}`);
    wrapper.append(node('span', 'chat-message__role', message.role === 'user' ? 'Tu' : 'OliDuck'));
    wrapper.append(node('div', 'chat-message__bubble', message.content));
    if (message.createdAt) wrapper.append(node('span', 'chat-message__time', formatTime(message.createdAt)));
    return wrapper;
  }

  function greeting() {
    if (mode === 'challenge' && challenge) {
      const goals = challenge.metadata?.learningGoals || [];
      const suffix = goals.length ? ` Obiettivi: ${goals.join(', ')}.` : '';
      return `Contesto pronto: "${challenge.title}" (${challenge.category || 'categoria non indicata'}, ${challenge.difficulty || 'difficoltà non indicata'}).${suffix}\n\nDescrivi cosa hai capito, chiedi un primo hint o proponi il tuo ragionamento: procederò per passaggi, senza darti subito una soluzione.`;
    }
    return 'Modalità generale: nessuna challenge selezionata. Puoi chiedermi di spiegare un concetto di cybersecurity, un metodo di analisi o come impostare lo studio. Per un tutor contestuale, apri i dettagli di una challenge e scegli la modalità Challenge.';
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
    const canChallenge = Boolean(challenge);
    for (const button of modeButtons) {
      const selected = button.id === (mode === 'general' ? 'mode-general' : 'mode-challenge');
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('is-active', selected);
    }
    challengeHint.textContent = canChallenge ? challenge.title : 'Seleziona una challenge';

    const suffix = aiMode === 'demo' ? ' · DEMO' : aiMode === 'error' ? ' · offline' : '';
    contextLabel.textContent = mode === 'challenge' && canChallenge
      ? `Challenge: ${challenge.title}${suffix}`
      : `Modalità generale${suffix}`;

    log.replaceChildren();
    empty.hidden = true;
    log.append(messageNode({ role: 'assistant', content: greeting() }));
    for (const message of store.getConversation(key)) log.append(messageNode(message));

    clearButton.disabled = store.getConversation(key).length === 0;
    sendButton.disabled = busyHere || !input.value.trim();
    cancelButton.hidden = !busyHere;
    input.disabled = busyHere;
    status.textContent = busyHere ? 'OliDuck sta rispondendo…' : '';
    scrollToEnd();
  }

  function finalize(request) {
    if (active?.controller !== request.controller) return;
    active = null;
    render();
  }

  async function submit(rawMessage, { isRetry = false } = {}) {
    const message = String(rawMessage || '').trim();
    if (!message || active) return;
    const requestKey = key;
    if (requestKey !== GENERAL_CONVERSATION_ID && !challenge) {
      showError('Seleziona una challenge per usare la modalità contestuale.');
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
    log.append(typing);
    scrollToEnd();

    try {
      const result = await sendChat(
        { challengeId: requestKey, message, history },
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
        if (active?.controller === controller) status.textContent = 'Richiesta annullata.';
      } else {
        const text = error instanceof ApiError
          ? error.message
          : 'Non è stato possibile contattare l’assistente. Controlla la connessione e riprova.';
        if (active?.controller === controller) showError(text, lastRequests.has(requestKey));
      }
      finalize(request);
      if (error?.name !== 'AbortError' && active === null) status.textContent = 'Richiesta non riuscita.';
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
    if (!challenge && mode === 'general') {
      const okGeneral = await confirmDialog('Cancellare la conversazione generale salvata in questo browser?');
      if (!okGeneral) return;
    } else if (challenge) {
      const okChallenge = await confirmDialog(`Cancellare la conversazione di "${challenge.title}"? L'operazione non è reversibile.`);
      if (!okChallenge) return;
    }
    if (active?.key === key) { active.controller.abort(); active = null; }
    store.clearConversation(key);
    lastRequests.delete(key);
    hideError();
    render();
    toast('Conversazione cancellata.');
    onConversationChange?.();
  });

  function switchMode(next) {
    const target = next === 'challenge' ? 'challenge' : 'general';
    if (target === 'challenge' && !challenge) {
      showError('Seleziona una challenge dalla libreria per aprire una conversazione contestuale.');
      return;
    }
    if (target === mode) return;
    if (active) { active.controller.abort(); active = null; }
    mode = target;
    key = target === 'challenge' ? challenge.id : GENERAL_CONVERSATION_ID;
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
    selectChallenge(next) {
      const id = next?.id || null;
      if (id === challenge?.id && mode === 'challenge') return;
      if (active) { active.controller.abort(); active = null; }
      challenge = next || null;
      if (challenge) {
        mode = 'challenge';
        key = challenge.id;
      } else {
        mode = 'general';
        key = GENERAL_CONVERSATION_ID;
      }
      input.value = '';
      input.style.height = '';
      hideError();
      render();
    },
    switchMode,
    focus() { if (!input.disabled) input.focus(); },
    setMode(next) { aiMode = next; render(); },
    get isBusy() { return Boolean(active && active.key === key); },
    get conversationKey() { return key; },
  };
}
