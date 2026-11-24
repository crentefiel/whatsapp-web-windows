// Script injetado no WhatsApp Web para observar mensagens e respostas do usuário.
// Atenção: os seletores do WhatsApp mudam frequentemente. Ajuste conforme necessário.

(function () {
  if (window.__iaObserverInjected) return;
  window.__iaObserverInjected = true;

  console.log('[IA Observador] Script injetado.');

  let lastIncoming = null;
  let lastChatName = 'Desconhecido';

  function getChatName() {
    const header = document.querySelector('header span[title]') ||
                   document.querySelector('#main header span[title]') ||
                   document.querySelector('div[data-testid="conversation-header"] span');
    return header ? header.textContent.trim() : 'Desconhecido';
  }

  function extractText(el) {
    if (!el) return '';
    const textEl = el.querySelector('span.selectable-text') ||
                   el.querySelector('div.copyable-text span') ||
                   el.querySelector('[data-testid="msg-container"] span');
    return textEl ? textEl.textContent.trim() : (el.textContent || '').trim();
  }

  function isOutgoing(msgEl) {
    return msgEl.classList.contains('message-out') ||
           msgEl.querySelector('.message-out') ||
           (msgEl.getAttribute('data-id') || '').includes('true_') ||
           msgEl.closest('.message-out');
  }

  function sendExample(incomingText, userReply, chatName) {
    const data = { incomingText, userReply, chatName };
    // Ponte simples via console (capturada no main process)
    console.log('LEARNING_EXAMPLE:' + JSON.stringify(data));
  }

  function observeMessages() {
    const main = document.querySelector('#main') || document.querySelector('[data-testid="conversation-panel-wrapper"]');
    if (!main) {
      setTimeout(observeMessages, 2000);
      return;
    }

    const observer = new MutationObserver((mutations) => {
      lastChatName = getChatName();

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          const msgEls = node.matches && node.matches('[data-testid="msg-container"], .message-in, .message-out, div[data-id]')
            ? [node]
            : Array.from(node.querySelectorAll ? node.querySelectorAll('[data-testid="msg-container"], .message-in, .message-out, div[data-id]') : []);

          for (const msgEl of msgEls) {
            const text = extractText(msgEl);
            if (!text || text.length < 1) continue;

            if (isOutgoing(msgEl)) {
              if (lastIncoming && lastIncoming !== text) {
                sendExample(lastIncoming, text, lastChatName);
                console.log('[IA Observador] Exemplo capturado');
              }
              lastIncoming = null;
            } else {
              lastIncoming = text;
            }
          }
        }
      }
    });

    observer.observe(main, { childList: true, subtree: true });
    console.log('[IA Observador] Observando mensagens...');
  }

  const interval = setInterval(() => {
    if (document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]')) {
      clearInterval(interval);
      observeMessages();
    }
  }, 1000);
})();
