/**
 * Bonzai AI Search widget — DTU LfL card pattern (sidebar-style box + chat).
 */
(function () {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function initWidget(el) {
    const topic = el.dataset.bonzaiTopic || "DTU Learn for Life";
    const staticChips = (el.dataset.bonzaiSuggestions || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const theme = el.dataset.bonzaiTheme || "light";
    const inputId = `bonzai-input-${el.dataset.bonzaiInstance || "0"}`;

    el.classList.add("bonzai-widget");
    if (theme === "dark") el.classList.add("on-dark");

    el.innerHTML = `
      <div class="bonzai-box">
        <h4 class="bonzai-title">${escapeHtml(topic)}</h4>
        <p class="bonzai-lead">Ask about this topic in your own words.</p>
        <div class="bonzai-chips-wrap">
          <div class="bonzai-chips"></div>
        </div>
        <div class="bonzai-thread" aria-live="polite"></div>
        <div class="bonzai-input-row">
          <input id="${inputId}" type="text" placeholder="Ask a question…" aria-label="Ask a question" />
          <button type="button" class="bonzai-send">Send</button>
        </div>
      </div>
    `;

    const chipsContainer = el.querySelector(".bonzai-chips");
    const chipsWrap = el.querySelector(".bonzai-chips-wrap");
    const thread = el.querySelector(".bonzai-thread");
    const input = el.querySelector(".bonzai-input-row input");
    const sendBtn = el.querySelector(".bonzai-send");

    function renderChips(questions) {
      if (!questions.length) {
        chipsWrap.hidden = true;
        return;
      }
      chipsWrap.hidden = false;
      chipsContainer.innerHTML = questions
        .map((q) => `<button type="button" class="bonzai-chip">${escapeHtml(q)}</button>`)
        .join("");
      chipsContainer.querySelectorAll(".bonzai-chip").forEach((chip) => {
        chip.addEventListener("click", () => ask(chip.textContent));
      });
    }

    function getClient() {
      const cfg = window.BonzaiConfig ? window.BonzaiConfig.get() : null;
      if (!cfg || !cfg.apiKey || !cfg.agentId) return null;
      if (!el._client) {
        el._client = new BonzaiClient(cfg);
      }
      return el._client;
    }

    if (staticChips.length) {
      renderChips(staticChips);
    } else {
      const client = getClient();
      if (client) {
        client
          .getExampleQuestions()
          .then((questions) => renderChips(questions.map((q) => q.question).slice(0, 4)))
          .catch(() => renderChips([]));
      } else {
        renderChips([]);
      }
    }

    function scrollThread() {
      thread.scrollTop = thread.scrollHeight;
    }

    function addMessage(role, html, { animate = true } = {}) {
      const div = document.createElement("div");
      div.className = `bonzai-msg ${role}`;
      div.innerHTML = html;
      thread.appendChild(div);
      el.classList.add("has-thread");
      if (animate) {
        requestAnimationFrame(() => div.classList.add("in"));
      } else {
        div.classList.add("in");
      }
      scrollThread();
      return div;
    }

    function setAnswerContent(node, html) {
      if (html.includes("<")) {
        node.innerHTML = html;
      } else {
        node.textContent = html;
      }
    }

    async function ask(question) {
      if (!question.trim()) return;

      const client = getClient();
      if (!client) {
        addMessage("assistant", "Connect Bonzai in the bar below to enable live answers.");
        return;
      }

      addMessage("user", escapeHtml(question));
      input.value = "";
      sendBtn.disabled = true;

      const loadingMsg = addMessage(
        "assistant loading",
        '<span class="bonzai-dots"><span></span><span></span><span></span></span>',
        { animate: false }
      );

      let answerSoFar = "";
      let firstChunk = true;
      let flushScheduled = false;

      function flushAnswer() {
        flushScheduled = false;
        setAnswerContent(loadingMsg, answerSoFar);
        scrollThread();
      }

      function scheduleFlush() {
        if (flushScheduled) return;
        flushScheduled = true;
        requestAnimationFrame(flushAnswer);
      }

      try {
        const finalEvent = await client.sendMessageStreaming(question, { topic }, (delta) => {
          if (firstChunk) {
            loadingMsg.classList.remove("loading");
            answerSoFar = "";
            firstChunk = false;
          }
          answerSoFar += delta;
          scheduleFlush();
        });

        if (flushScheduled) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        if (!answerSoFar) {
          loadingMsg.classList.remove("loading");
          loadingMsg.textContent = "No answer returned.";
        }

        if (finalEvent && finalEvent.references && finalEvent.references.length) {
          const refsHtml = finalEvent.references
            .map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title || r.url)}</a>`)
            .join("");
          const bodyHtml = answerSoFar.includes("<") ? answerSoFar : escapeHtml(answerSoFar);
          loadingMsg.innerHTML = bodyHtml + `<div class="bonzai-refs">${refsHtml}</div>`;
          scrollThread();
        }
      } catch (err) {
        loadingMsg.classList.remove("loading");
        loadingMsg.textContent = `Something went wrong: ${err.message}`;
      } finally {
        sendBtn.disabled = false;
      }
    }

    sendBtn.addEventListener("click", () => ask(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ask(input.value);
    });
  }

  function init() {
    document.querySelectorAll("[data-bonzai-widget]").forEach((el, i) => {
      el.dataset.bonzaiInstance = String(i);
      initWidget(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
