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

    function setAnswerContent(node, raw) {
      if (typeof renderMarkdownLite === "function") {
        node.innerHTML = renderMarkdownLite(raw);
      } else {
        node.textContent = raw;
      }
    }

    function formatResultTitle(title) {
      if (!title) return "";
      let t = title.trim();
      t = t.replace(/\s*[-–—|]\s*Efteruddannelse og kurser fra DTU Learn for Life.*$/i, "");
      t = t.replace(/\s*[-–—]\s*online course\s*$/i, "");
      t = t.replace(/\s*[-–—]\s*Online Programme\s*$/i, "");
      t = t.replace(/\s{2,}/g, " ");
      if (t.length > 72) {
        const cut = t.slice(0, 72).replace(/\s+\S*$/, "");
        t = cut + "…";
      }
      return t || title.trim();
    }

    /**
     * The agent's system prompt ends topic answers with ONE low-pressure
     * suggestion (newsletter signup / book an advisor / find-my-course quiz),
     * always closing with an exact quoted trigger phrase the user can repeat
     * to hand off to the matching playbook, e.g.:
     *   Just say "I want to learn more about wind energy" and I'll get you signed up.
     *
     * We pull that quoted phrase out of the rendered answer and turn it into
     * a real CTA button instead of leaving it as buried trailing text. The
     * button sends the exact quoted phrase, so it reliably triggers the
     * right playbook rather than the agent trying to improvise the next step
     * itself.
     */
    function extractSuggestionCta(container) {
      const paragraphs = container.querySelectorAll("p");
      // Matches: say "..." / sig "..." / siger "..." — any common straight or
      // curly quote style (the agent's answer language affects which it uses).
      const quotePattern = /\b(?:say|sig(?:er)?)\s+["'“”‘’«»]([^"'“”‘’«»]+)["'“”‘’«»]/i;

      const ctaLabels = [
        { test: /learn more about/i, label: "Yes, sign me up for updates" },
        { test: /book a meeting|advisor|rådgiver/i, label: "Yes, book a meeting" },
        { test: /find the right|matcher mig|quiz/i, label: "Yes, help me find a course" },
      ];

      for (const p of paragraphs) {
        const match = p.textContent.match(quotePattern);
        if (!match) continue;

        const triggerPhrase = match[1].trim();
        const ctaLabel = (ctaLabels.find((c) => c.test.test(p.textContent)) || {}).label || "Yes, let's do that";

        const cta = document.createElement("div");
        cta.className = "bonzai-cta";
        cta.innerHTML = `
          <p class="bonzai-cta-text">${p.innerHTML}</p>
          <button type="button" class="bonzai-cta-btn">${escapeHtml(ctaLabel)}</button>
        `;
        p.replaceWith(cta);
        cta.querySelector(".bonzai-cta-btn").addEventListener("click", () => {
          ask(triggerPhrase);
        });
        return;
      }
    }

    function renderReferenceCards(references) {
      if (!references || !references.length) return "";
      const cards = references
        .slice(0, 3)
        .map((r) => {
          const title = formatResultTitle(r.title || r.url);
          const thumb = r.image
            ? `<div class="bonzai-result-img"><img src="${escapeHtml(r.image)}" alt="" loading="lazy" /></div>`
            : "";
          const summary = r.summary
            ? `<p class="bonzai-result-summary">${escapeHtml(r.summary)}</p>`
            : "";
          return `
            <a class="bonzai-result-card" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">
              ${thumb}
              <div class="bonzai-result-body">
                <div class="bonzai-result-title">${escapeHtml(title)}</div>
                ${summary}
              </div>
            </a>
          `;
        })
        .join("");
      return `<div class="bonzai-results"><p class="bonzai-results-label">Related pages</p>${cards}</div>`;
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
        } else {
          setAnswerContent(loadingMsg, answerSoFar);
          extractSuggestionCta(loadingMsg);
        }

        if (finalEvent && finalEvent.references && finalEvent.references.length) {
          // insertAdjacentHTML appends without reparsing (and thereby destroying)
          // the existing DOM — unlike `innerHTML +=`, which would silently drop
          // the CTA button's click listener added by extractSuggestionCta above.
          loadingMsg.insertAdjacentHTML("beforeend", renderReferenceCards(finalEvent.references));
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
