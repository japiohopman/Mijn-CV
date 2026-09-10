(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('secretaryToggleBtn');
    const panel = document.getElementById('secretaryPanel');
    const closeBtn = document.getElementById('secretaryCloseBtn');
    const form = document.getElementById('secretaryForm');
    const input = document.getElementById('secretaryInput');
    const chatHistory = document.getElementById('secretaryChatHistory');
    const chipBtns = document.querySelectorAll('.secretary-chip');

    if (!toggleBtn || !panel || !form || !input || !chatHistory) {
      return;
    }

    let engineInstance = null;

    // Load knowledge data dynamically
    fetch('/data/secretary_knowledge.json')
      .then(res => res.json())
      .then(data => {
        if (typeof window.SecretaryEngine === 'function') {
          let llmAdapter = null;
          if (typeof window.SecretaryLLMAdapter === 'function' && window.SECRETARY_LLM_CONFIG) {
            llmAdapter = new window.SecretaryLLMAdapter(window.SECRETARY_LLM_CONFIG);
          }

          engineInstance = new window.SecretaryEngine(data, { llmAdapter });
          if (llmAdapter) {
            llmAdapter.secretaryEngine = engineInstance;
          }
        }
      })
      .catch(err => {
        console.warn('Portfolio Secretary knowledge base fallback mode active:', err);
      });

    const openPanel = () => {
      panel.classList.add('active');
      panel.setAttribute('aria-hidden', 'false');
      toggleBtn.setAttribute('aria-expanded', 'true');
      input.focus();
    };

    const closePanel = () => {
      panel.classList.remove('active');
      panel.setAttribute('aria-hidden', 'true');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.focus();
    };

    toggleBtn.addEventListener('click', () => {
      const isActive = panel.classList.contains('active');
      if (isActive) {
        closePanel();
      } else {
        openPanel();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', closePanel);
    }

    // Escape key closes panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('active')) {
        closePanel();
      }
    });

    const appendUserMessage = (text) => {
      const userMsgDiv = document.createElement('div');
      userMsgDiv.className = 'secretary-msg user-msg';
      userMsgDiv.innerHTML = `
        <div class="msg-content">
          ${escapeHTML(text)}
        </div>
      `;
      chatHistory.appendChild(userMsgDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
    };

    const appendAssistantMessage = (res) => {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'secretary-msg assistant-msg';

      let toolActionHTML = '';
      if (res.toolCall) {
        const actionLabels = {
          'navigateToSection': `Ga naar ${res.toolCall.parameters ? res.toolCall.parameters.anchor : 'sectie'} &rarr;`,
          'navigateToRoute': `Open route ${res.toolCall.parameters ? res.toolCall.parameters.route : ''} &rarr;`,
          'openProject': `Bekijk project &rarr;`,
          'openKitchenCV': `Open Keuken-CV &rarr;`,
          'openShare': `Open Deel / QR &rarr;`
        };

        const label = actionLabels[res.toolCall.tool] || 'Voer actie uit &rarr;';
        toolActionHTML = `
          <button type="button" class="secretary-action-btn" data-tool='${JSON.stringify(res.toolCall)}'>
            ${label}
          </button>
        `;
      }

      const sourceHTML = res.sourceFile ? `<div class="msg-source">Bron: ${escapeHTML(res.sourceFile)}</div>` : '';

      msgDiv.innerHTML = `
        <div class="msg-content">
          <p>${escapeHTML(res.answerText)}</p>
          ${toolActionHTML}
          ${sourceHTML}
        </div>
      `;

      chatHistory.appendChild(msgDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;

      // Attach event listener to action button if present
      const actionBtn = msgDiv.querySelector('.secretary-action-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', () => {
          try {
            const toolCall = JSON.parse(actionBtn.dataset.tool);
            if (window.SecretaryEngine && typeof window.SecretaryEngine.executeToolCall === 'function') {
              window.SecretaryEngine.executeToolCall(toolCall);
            }
          } catch (err) {
            console.error('Error executing assistant tool action:', err);
          }
        });
      }
    };

    const processQuery = async (rawQuery) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) return;

      appendUserMessage(trimmed);

      if (engineInstance) {
        let res;
        if (typeof engineInstance.processQuery === 'function') {
          res = await engineInstance.processQuery(trimmed);
        } else {
          res = engineInstance.matchIntent(trimmed);
        }

        appendAssistantMessage(res);

        // Auto execute tool call if confidence is high and user explicitly asked for navigation or action
        if (res.toolCall && res.confidenceScore >= 0.75) {
          if (typeof window.SecretaryEngine.executeToolCall === 'function') {
            window.SecretaryEngine.executeToolCall(res.toolCall);
          }
        }
      } else {
        // Fallback response if engine instance hasn't loaded
        appendAssistantMessage({
          matchedIntentId: 'fallback.unknown',
          confidenceScore: 0,
          answerText: 'Ik kan vragen over Jaap\'s profiel, projecten en skills beantwoorden. Bekijk de menu-opties of probeer een snelvraag!',
          sourceFile: 'README.md'
        });
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value;
      input.value = '';
      processQuery(val);
    });

    chipBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const query = btn.dataset.query;
        if (query) {
          if (!panel.classList.contains('active')) {
            openPanel();
          }
          processQuery(query);
        }
      });
    });

    function escapeHTML(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  });
})();
