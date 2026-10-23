/**
 * Search page: each query starts a fresh Bonzai conversation. The references
 * become the result list and the answer becomes a summary.
 */
(function () {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const status = document.getElementById("search-status");
  const layout = document.getElementById("search-layout");
  const answerEl = document.getElementById("search-answer");
  const resultsEl = document.getElementById("search-results");

  let currentSearch = 0;

  const SEARCH_CONTEXT = { mode: "search" };

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function cleanTitle(title) {
    let t = (title || "").trim();
    t = t.replace(/\s*[-–—|]\s*Efteruddannelse og kurser fra DTU Learn for Life.*$/i, "");
    t = t.replace(/\s*[-–—|]\s*DTU Learn for Life\s*$/i, "");
    return t || title;
  }

  function renderResults(references) {
    if (!references || !references.length) {
      resultsEl.innerHTML = `<p class="search-empty">No matching pages found.</p>`;
      return;
    }
    const items = references
      .map((r) => {
        const thumb = r.image
          ? `<div class="search-result-img"><img src="${escapeHtml(r.image)}" alt="" loading="lazy" /></div>`
          : `<div class="search-result-img placeholder"></div>`;
        let host = "";
        try { host = new URL(r.url).pathname.replace(/\/$/, ""); } catch (_) {}
        return `
          <a class="search-result" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">
            ${thumb}
            <div class="search-result-body">
              <h3 class="search-result-title">${escapeHtml(cleanTitle(r.title || r.url))}</h3>
              ${r.summary ? `<p class="search-result-summary">${escapeHtml(r.summary)}</p>` : ""}
              <span class="search-result-url">${escapeHtml(host)}</span>
            </div>
          </a>`;
      })
      .join("");
    resultsEl.innerHTML = `<p class="search-section-label">${references.length} relevant ${references.length === 1 ? "page" : "pages"}</p>${items}`;
  }

  function renderAnswer(raw, done) {
    const body = typeof renderMarkdownLite === "function" ? renderMarkdownLite(raw) : escapeHtml(raw);
    answerEl.innerHTML = `
      <p class="search-section-label">AI summary</p>
      <div class="search-answer-body${done ? "" : " is-streaming"}">${body}</div>`;
  }

  async function search(query) {
    query = query.trim();
    if (!query) return;

    const searchId = ++currentSearch;
    const url = new URL(location.href);
    url.searchParams.set("q", query);
    history.replaceState(null, "", url);
    input.value = query;

    const cfg = window.BonzaiConfig ? window.BonzaiConfig.get() : null;
    if (!cfg || !cfg.apiKey || !cfg.agentId) {
      layout.hidden = true;
      status.textContent = "Connect Bonzai in the bar below to search.";
      return;
    }

    layout.hidden = false;
    status.textContent = "";
    answerEl.innerHTML = `<p class="search-section-label">AI summary</p><span class="bonzai-dots"><span></span><span></span><span></span></span>`;
    resultsEl.innerHTML = `<div class="search-skeleton"></div><div class="search-skeleton"></div><div class="search-skeleton"></div>`;

    const client = new BonzaiClient(cfg);
    let answer = "";
    let flushScheduled = false;

    try {
      const finalEvent = await client.sendMessageStreaming(query, SEARCH_CONTEXT, (delta) => {
        if (searchId !== currentSearch) return;
        answer += delta;
        if (!flushScheduled) {
          flushScheduled = true;
          requestAnimationFrame(() => {
            flushScheduled = false;
            if (searchId === currentSearch) renderAnswer(answer, false);
          });
        }
      });
      if (searchId !== currentSearch) return;

      renderAnswer(answer || "No summary available.", true);
      renderResults(finalEvent && finalEvent.references);
    } catch (err) {
      if (searchId !== currentSearch) return;
      layout.hidden = true;
      status.textContent = `Search failed: ${err.message}`;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    search(input.value);
  });

  document.querySelectorAll(".search-examples button").forEach((btn) => {
    btn.addEventListener("click", () => search(btn.dataset.q));
  });

  const initial = new URLSearchParams(location.search).get("q");
  if (initial) search(initial);
  else input.focus();
})();
