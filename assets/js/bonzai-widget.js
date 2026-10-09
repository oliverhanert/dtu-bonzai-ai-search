/**
 * Bonzai AI Search widget — renders into any element with [data-bonzai-widget],
 * reading its own context (topic, suggested questions) from data attributes so
 * the same component can be dropped onto any page (course, topic hub, degree, etc.)
 * and feel tailored to that page's content.
 *
 * Suggested questions: if data-bonzai-suggestions is omitted, the widget asks
 * Bonzai for the agent's configured example questions (Agent config > Example
 * questions), so suggestions can be managed centrally instead of per page.
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

    el.classList.add("bonzai-widget");
    if (theme === "dark") el.classList.add("on-dark");

    el.innerHTML = `
      <div class="bonzai-heading"><span class="dot"></span> Ask about ${escapeHtml(topic)}</div>
      <div class="bonzai-sub">AI search trained on this page's content, powered by IO Bonzai.</div>
      <div class="bonzai-chips"></div>
      <div class="bonzai-thread" aria-live="polite"></div>
      <div class="bonzai-input-row">
        <input type="text" placeholder="Ask a question..." aria-label="Ask Bonzai AI search" />
        <button type="button" aria-label="Send">&#8594;</button>
      </div>
      <div class="bonzai-footer-note">Answers are generated from indexed content and may be imperfect.</div>
    `;

    const chipsContainer = el.querySelector(".bonzai-chips");
    const thread = el.querySelector(".bonzai-thread");
    const input = el.querySelector(".bonzai-input-row input");
    const sendBtn = el.querySelector(".bonzai-input-row button");

    function renderChips(questions) {
      chipsContainer.innerHTML = questions
        .map((q) => `<button class="bonzai-chip" type="button">${escapeHtml(q)}</button>`)
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

    // Suggested questions: prefer explicit per-page overrides, otherwise pull
    // the agent's centrally configured example questions from Bonzai.
    if (staticChips.length) {
      renderChips(staticChips);
    } else {
      const client = getClient();
      if (client) {
        client
          .getExampleQuestions()
          .then((questions) => renderChips(questions.map((q) => q.question).slice(0, 4)))
          .catch(() => renderChips([]));
      }
    }

    function addMessage(role, html) {
      const div = document.createElement("div");
      div.className = `bonzai-msg ${role}`;
      div.innerHTML = html;
      thread.appendChild(div);
      thread.scrollTop = thread.scrollHeight;
      return div;
    }

    function addFeedbackRow(container, client, messageId) {
      const row = document.createElement("div");
      row.className = "bonzai-feedback";
      row.innerHTML = `
        <button type="button" data-score="5" aria-label="Good answer">&#128077;</button>
        <button type="button" data-score="1" aria-label="Bad answer">&#128078;</button>
        <span class="bonzai-feedback-thanks" hidden>Thanks for the feedback!</span>
      `;
      row.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", async () => {
          row.querySelectorAll("button").forEach((b) => (b.disabled = true));
          try {
            await client.sendFeedback(messageId, Number(btn.dataset.score));
            row.querySelector(".bonzai-feedback-thanks").hidden = false;
          } catch (_) {
            /* best-effort; demo should not break on feedback failure */
          }
        });
      });
      container.appendChild(row);
    }

    async function ask(question) {
      if (!question.trim()) return;

      const client = getClient();
      if (!client) {
        addMessage("assistant", "This demo isn't connected yet. Set the Bonzai tenant key and agent ID in the bar below to go live.");
        return;
      }

      addMessage("user", escapeHtml(question));
      input.value = "";
      sendBtn.disabled = true;
      const loadingMsg = addMessage("assistant loading", "Searching…");
      let answerSoFar = "";
      let firstChunk = true;

      try {
        const finalEvent = await client.sendMessageStreaming(question, { topic }, (delta) => {
          if (firstChunk) {
            loadingMsg.classList.remove("loading");
            answerSoFar = "";
            firstChunk = false;
          }
          // Not escaped: the API's answer field is documented as possibly containing
          // HTML (e.g. inline formatting), matching the non-streaming response shape.
          answerSoFar += delta;
          loadingMsg.innerHTML = answerSoFar;
          thread.scrollTop = thread.scrollHeight;
        });

        if (!answerSoFar) {
          loadingMsg.classList.remove("loading");
          loadingMsg.innerHTML = "No answer returned.";
        }

        if (finalEvent && finalEvent.references && finalEvent.references.length) {
          const refsHtml = finalEvent.references
            .map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">[${r.index}] ${escapeHtml(r.title || r.url)}</a>`)
            .join("");
          loadingMsg.innerHTML += `<div class="bonzai-refs">${refsHtml}</div>`;
        }

        if (finalEvent && finalEvent.response && finalEvent.response.messageId) {
          addFeedbackRow(loadingMsg, client, finalEvent.response.messageId);
        }
      } catch (err) {
        loadingMsg.classList.remove("loading");
        loadingMsg.innerHTML = `Something went wrong: ${escapeHtml(err.message)}`;
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
    document.querySelectorAll("[data-bonzai-widget]").forEach(initWidget);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
