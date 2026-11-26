/** NavLaterale: navigazione delle viste e cronologia chat persistente. */

import { byId, confirmDialog } from './utils.js';
import { GENERAL_CONVERSATION_ID } from './store.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function formatWhen(value) {
  if (!value) return 'nessun messaggio';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data sconosciuta';
  return date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function createHistory({ store, onOpenConversation, onNewChat, onDeleteConversation, onViewChange }) {
  const lists = {
    challenge: byId('chat-history-challenge'),
    general: byId('chat-history-general'),
  };
  const counts = {
    challenge: byId('history-challenge-count'),
    general: byId('history-general-count'),
  };
  const navButtons = [...document.querySelectorAll('[data-sidebar-view]')];

  function historyItem(meta, activeId) {
    const item = node('div', 'history-item');
    item.setAttribute('role', 'listitem');
    if (meta.id === activeId) item.classList.add('is-active');

    const open = node('button', 'history-item__open');
    open.type = 'button';
    open.append(node('span', 'history-item__title', meta.title));
    const detail = meta.kind === 'challenge'
      ? `${meta.challengeIds.length} challenge · ${formatWhen(meta.updatedAt)}`
      : `generale · ${formatWhen(meta.updatedAt)}`;
    open.append(node('span', 'history-item__meta', detail));
    open.addEventListener('click', () => onOpenConversation?.(meta.id));

    const rename = node('button', 'history-item__action', '✎');
    rename.type = 'button';
    rename.title = 'Rinomina chat';
    rename.setAttribute('aria-label', `Rinomina la chat ${meta.title}`);
    rename.addEventListener('click', () => {
      const input = node('input', 'history-item__rename');
      input.type = 'text';
      input.maxLength = 120;
      input.value = meta.title;
      input.setAttribute('aria-label', 'Nuovo titolo della chat');
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        if (save) store.renameConversation(meta.id, input.value);
        input.replaceWith(open);
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      open.replaceWith(input);
      input.focus();
      input.select();
    });

    const remove = node('button', 'history-item__action history-item__action--delete', '×');
    remove.type = 'button';
    remove.title = 'Elimina chat';
    remove.setAttribute('aria-label', `Elimina la chat ${meta.title}`);
    remove.addEventListener('click', async () => {
      const ok = await confirmDialog(`Eliminare la chat “${meta.title}”? L'operazione non è reversibile.`);
      if (!ok) return;
      onDeleteConversation?.(meta.id);
    });

    item.append(open, rename, remove);
    return item;
  }

  function render() {
    const activeId = store.getActiveConversation();
    const conversations = store.listConversations();
    for (const kind of ['challenge', 'general']) {
      const list = lists[kind];
      if (!list) continue;
      const entries = conversations.filter((meta) => meta.kind === kind);
      counts[kind].textContent = String(entries.length);
      list.replaceChildren();
      if (!entries.length) {
        const empty = node('p', 'history-empty', kind === 'challenge'
          ? 'Nessuna chat challenge: seleziona una challenge e scrivi a OliDuck.'
          : 'Nessuna chat generale: una è sempre disponibile.');
        list.append(empty);
        continue;
      }
      for (const meta of entries) list.append(historyItem(meta, activeId));
    }
  }

  byId('new-chat')?.addEventListener('click', () => onNewChat?.());

  for (const button of navButtons) {
    button.addEventListener('click', () => {
      const view = button.dataset.sidebarView;
      for (const item of navButtons) item.setAttribute('aria-pressed', String(item === button));
      onViewChange?.(view);
    });
  }

  function setActiveView(view) {
    for (const button of navButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.sidebarView === view));
    }
  }

  return { render, setActiveView, openDefault: () => onOpenConversation?.(GENERAL_CONVERSATION_ID) };
}
