/** Pannello dell'assistente: chat per challenge, stato di generazione ed errori. */

import { byId, formatTime, toast, confirmDialog } from './utils.js';
import { sendChat, ApiError } from './api.js';

const MAX_HISTORY = 12;

function greetingFor(challenge) {
  if (!challenge) return null;
  const goal = Array.isArray(challenge.learningGoals) && challenge.learningGoals.length
    ? ` Gli obiettivi sono: ${challenge.learningGoals.join(', ')}.`
    : '';
  return `Contesto pronto: "${challenge.title}" (${challenge.category}, ${challenge.difficulty}).${goal}\n\nDescrivi cosa hai capito, chiedi un primo hint o proponi il tuo ragionamento: procederò per passaggi, senza darti subito una soluzione.`;
}

export function createAssistant({ store, getChallenge, onConversationChange }) {
  const log = byId('chat-log');
  const empty = byId('chat-empty');
  const form = byId('chat-form');
  const input = byId('chat-input');
  const sendButton = byId('send-chat');
  const clearButton = byId('clear-chat');
  const contextLabel = byId('assistant-context-label');
  const errorBox = byId('chat-error');
  const errorMessage = byId('chat-error-message');
  const retryButton = byId('retry-chat');

  let challenge = null;
  let busy = false;
  let controller = null;
  let lastRequest = null;
  let mode = null;

  function messageNode(role, content, createdAt) {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message chat-message--${role}`;
    const label = document.createElement('span');
    label.className = 'chat-message__role';
    label.textContent = role === 'user' ? 'Tu' : 'OliDuck';
    const bubble = document.createElement('div');
    bubble.className = 'chat-message__bubble';
    bubble.textContent = content;
    wrapper.append(label, bubble);
    if (createdAt) {
      const time = document.createElement('span');
      time.className = 'chat-message__time';
      time.textContent = formatTime(createdAt);
      wrapper.append(time);
    }
    return wrapper;
  }

  function typingNode() {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message chat-message--assistant';
    const label = document.createElement('span');
    label.className = 'chat-message__role';
    label.textContent = 'OliDuck';
    const bubble = document.createElement('div');
    bubble.className = 'chat-message__bubble typing';
    bubble.setAttribute('aria-label', 'OliDuck sta rispondendo');
    bubble.innerHTML = '<i></i><i></i><i></i>';
    wrapper.append(label, bubble);
    return wrapper;
  }

  function hideError() {
    errorBox.hidden = true;
    errorMessage.textContent = '';
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
    log.replaceChildren();
    const hasChallenge = Boolean(challenge);
    empty.hidden = hasChallenge;
    clearButton.disabled = !hasChallenge || busy;
    input.disabled = !hasChallenge || busy;
    sendButton.disabled = !hasChallenge || busy || !input.value.trim();
    const modeSuffix = mode === 'demo' ? ' · DEMO' : mode === 'error' ? ' · offline' : '';
    contextLabel.textContent = hasChallenge
      ? `Challenge: ${challenge.title}${modeSuffix}`
      : `Nessuna challenge selezionata${modeSuffix}`;

    if (!hasChallenge) return;
    const greeting = greetingFor(challenge);
    if (greeting) log.append(messageNode('assistant', greeting));
    for (const message of store.getConversation(challenge.id)) {
      log.append(messageNode(message.role, message.content, message.createdAt));
    }
    scrollToEnd();
  }

  async function submit(message, { isRetry = false } = {}) {
    if (!challenge || busy || !message?.trim()) return;
    const challengeId = challenge.id;
    const context = challenge;

    busy = true;
    hideError();
    if (!isRetry) {
      const saved = { id: `m-${Date.now()}`, role: 'user', content: message.trim(), createdAt: new Date().toISOString() };
      store.appendMessage(challengeId, saved);
      log.append(messageNode('user', saved.content, saved.createdAt));
    }
    lastRequest = { challengeId, message: message.trim() };

    const history = store.getConversation(challengeId)
      .slice(0, -1)
      .slice(-MAX_HISTORY)
      .map(({ role, content }) => ({ role, content }));

    input.value = '';
    const typing = typingNode();
    log.append(typing);
    sendButton.disabled = true;
    input.disabled = true;
    scrollToEnd();

    controller = new AbortController();
    try {
      const result = await sendChat(
        { challengeId, challenge: context, message: message.trim(), history },
        {
          signal: controller.signal,
          onToken: (text) => {
            const bubble = typing.querySelector('.chat-message__bubble');
            if (bubble) { bubble.classList.remove('typing'); bubble.textContent = text; }
            scrollToEnd();
          },
        },
      );
      typing.remove();
      const reply = result.reply || 'Il backend non ha restituito alcuna risposta.';
      store.appendMessage(challengeId, { role: 'assistant', content: reply, createdAt: new Date().toISOString() });
      log.append(messageNode('assistant', reply, new Date().toISOString()));
      onConversationChange?.();
      scrollToEnd();
    } catch (error) {
      typing.remove();
      if (error?.name === 'AbortError') return;
      const text = error instanceof ApiError
        ? error.message
        : 'Non è stato possibile contattare l’assistente. Controlla la connessione e riprova.';
      showError(text, Boolean(lastRequest));
    } finally {
      busy = false;
      controller = null;
      if (challenge?.id === challengeId) {
        input.disabled = false;
        sendButton.disabled = !input.value.trim();
        input.focus();
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  input.addEventListener('input', () => {
    sendButton.disabled = !input.value.trim() || busy;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });

  retryButton.addEventListener('click', () => {
    if (lastRequest) submit(lastRequest.message, { isRetry: true });
  });

  clearButton.addEventListener('click', async () => {
    if (!challenge) return;
    const accepted = await confirmDialog(`Cancellare la conversazione di "${challenge.title}"? L'operazione non è reversibile.`);
    if (!accepted) return;
    controller?.abort();
    store.clearConversation(challenge.id);
    lastRequest = null;
    hideError();
    render();
    toast('Conversazione cancellata.');
    onConversationChange?.();
  });

  return {
    render,
    selectChallenge(next) {
      controller?.abort();
      busy = false;
      lastRequest = null;
      challenge = next || null;
      input.value = '';
      input.style.height = '';
      hideError();
      render();
    },
    focus() { if (!input.disabled) input.focus(); },
    setMode(next) {
      mode = next;
      // Non ricostruire la chat mentre una risposta è in corso.
      if (!busy) render();
    },
    get isBusy() { return busy; },
  };
}
