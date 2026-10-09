/**
 * Bonzai AI Search widget — renders into any element with [data-bonzai-widget],
 * reading its own context (topic, suggested questions) from data attributes so
 * the same component can be dropped onto any page (course, topic hub, degree, etc.)
 * and feel tailored to that page's content.
 */
(function () {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function initWidget(el) {
    const topic = el.dataset.bonzaiTopic || "DTU Learn for Life";
    const chips = (el.dataset.bonzaiSuggestions || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const theme = el.dataset.bonzaiTheme || "light";

    el.classList.add("bonzai-widget");
    if (theme === "dark") el.classList.add("on-dark");

    el.innerHTML = `
      <div class="bonzai-heading"><span class="dot"></span> Ask about ${escapeHtml(topic)}</div>
      <div class="bonzai-sub">AI search trained on this page's content, powered by IO Bonzai.</div>
      <div class="bonzai-chips">
        ${chips.map((q) => `<button class="bonzai-chip" type="button">${escapeHtml(q)}</button>`).join("")}
      </div>
      <div class="bonzai-thread" aria-live="polite"></div>
      <div class="bonzai-input-row">
        <input type="text" placeholder="Ask a question..." aria-label="Ask Bonzai AI search" />
        <button type="button" aria-label="Send">&#8594;</button>
      </div>
      <div class="bonzai-footer-note">Answers are generated from indexed content and may be imperfect.</div>
    `;

    const thread = el.querySelector(".bonzai-thread");
    const input = el.querySelector(".bonzai-input-row input");
    const sendBtn = el.querySelector(".bonzai-input-row button");

    function getClient() {
      const cfg = window.BonzaiConfig ? window.BonzaiConfig.get() : null;
      if (!cfg || !cfg.apiKey || !cfg.agentId) return null;
      if (!el._client) {
        el._client = new BonzaiClient(cfg);
      }
      return el._client;
    }

    function addMessage(role, html) {
      const div = document.createElement("div");
      div.className = `bonzai-msg ${role}`;
      div.innerHTML = html;
      thread.appendChild(div);
      thread.scrollTop = thread.scrollHeight;
      return div;
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

      try {
        const data = await client.sendMessage(question, { topic });
        loadingMsg.classList.remove("loading");

        const answer = data.response && data.response.answer ? data.response.answer : "No answer returned.";
        loadingMsg.innerHTML = answer;

        if (data.references && data.references.length) {
          const refsHtml = data.references
            .map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">[${r.index}] ${escapeHtml(r.title || r.url)}</a>`)
            .join("");
          loadingMsg.innerHTML += `<div class="bonzai-refs">${refsHtml}</div>`;
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
    el.querySelectorAll(".bonzai-chip").forEach((chip) => {
      chip.addEventListener("click", () => ask(chip.textContent));
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
