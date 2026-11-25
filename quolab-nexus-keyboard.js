/* QuOLab / QuOLab Nexus — keyboard interaction layer
 * Adds keyboard access to custom controls without replacing native browser
 * keyboard behavior or changing tool execution logic.
 */
(() => {
  'use strict';
  if (window.__quolabKeyboardReady) return;
  window.__quolabKeyboardReady = true;

  const isTyping = (el) => !!el && (
    el.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    !!el.closest('[contenteditable="true"], .cm-content, .CodeMirror')
  );

  const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  function enhance(root = document) {
    const selector = [
      '[onclick]', '[role="button"]', '[role="tab"]',
      '.menu-card', '.tool-card', '.module-card',
      '.btn-back', '.filter-tag', '.exec-tab'
    ].join(',');
    root.querySelectorAll(selector).forEach((el) => {
      if (!isVisible(el) || el.matches('button,a,input,select,textarea,summary')) return;
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      if (!el.hasAttribute('role') && (el.hasAttribute('onclick') || el.matches('.menu-card,.tool-card,.module-card'))) {
        el.setAttribute('role', 'button');
      }
      if (!el.hasAttribute('aria-label')) {
        const label = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        if (label) el.setAttribute('aria-label', label);
      }
    });
  }

  function activeScreen() {
    return document.querySelector('.screen.active, [data-screen].active, main.active') || document;
  }

  function activate(el) {
    if (!el || !isVisible(el)) return;
    if (typeof el.click === 'function') el.click();
  }

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = isTyping(target);

    // Enter/Space activate custom controls exactly as a mouse click would.
    if (!typing && (event.key === 'Enter' || event.key === ' ')) {
      const custom = target && target.closest('[role="button"],[role="tab"],.menu-card,.tool-card,.module-card,.filter-tag,.exec-tab');
      if (custom && !custom.matches('button,a,input,select,textarea')) {
        event.preventDefault();
        activate(custom);
        return;
      }
    }

    // Escape closes the topmost open dialog or returns from the current tool.
    if (event.key === 'Escape' && !typing) {
      const dialogs = [...document.querySelectorAll('.modal-ov.open,.modal.open,[role="dialog"][aria-modal="true"]')].filter(isVisible);
      if (dialogs.length) {
        const dialog = dialogs[dialogs.length - 1];
        const close = dialog.querySelector('[data-close],.btn-close-x,.btn-cancel,[aria-label*="close" i],[aria-label*="cerrar" i]');
        if (close) { event.preventDefault(); activate(close); return; }
      }
      const back = activeScreen().querySelector('.btn-back,[data-action="back"]');
      if (back) { event.preventDefault(); activate(back); }
      return;
    }

    // Alt+1…9 opens the corresponding visible tool/menu card.
    if (event.altKey && /^[1-9]$/.test(event.key) && !typing) {
      const cards = [...activeScreen().querySelectorAll('.menu-card:not(.locked),.tool-card:not(.locked),.module-card:not(.locked)')].filter(isVisible);
      const item = cards[Number(event.key) - 1];
      if (item) { event.preventDefault(); activate(item); }
      return;
    }

    // Slash focuses the current screen's search field, unless the user is typing.
    if (event.key === '/' && !typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const search = [...activeScreen().querySelectorAll('input[type="search"],input[placeholder*="search" i],input[placeholder*="buscar" i],#searchInput')].find(isVisible);
      if (search) { event.preventDefault(); search.focus(); search.select?.(); }
    }
  }, true);

  // Ensure keyboard focus is visible and custom controls are discoverable.
  const style = document.createElement('style');
  style.textContent = `
    :where(button,a,input,select,textarea,[tabindex="0"],[role="button"],[role="tab"]):focus-visible {
      outline: 2px solid var(--bl2, #00ccff) !important;
      outline-offset: 3px !important;
      scroll-margin: 84px;
    }
    [data-keyboard-hint]::after { content: attr(data-keyboard-hint); }
  `;
  document.head.appendChild(style);

  enhance();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          enhance(node);
          if (node.querySelectorAll) enhance(node);
        }
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Expose a small, non-invasive API for embedded tools loaded same-origin.
  window.QuOLabKeyboard = Object.freeze({
    version: '2026.11.25',
    refresh: () => enhance(),
    activate
  });
})();