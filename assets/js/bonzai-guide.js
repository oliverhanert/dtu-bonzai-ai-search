/**
 * Page guide: a step-by-step Bonzai conversation embedded as a page section.
 * The agent (mode "guide") asks one question per step, ending it with an
 * [options]...[/options] block (one answer per line). The recommendation ends
 * with a [path]...[/path] block of "Stage | [Course](url)" lines, rendered as a
 * learning path. Images and descriptions come from the cited references.
 */
(function () {
  const ARROW = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  const BACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>`;

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

  function normalizeUrl(url) {
    return (url || "").replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }

  // Tolerates markdown-escaped or doubled brackets, e.g. "\[options\]" or "[[options]]".
  function takeBlock(raw, name) {
    const open = `[\\\\\\[\\s]*\\[\\s*${name}\\s*\\\\?\\]+`;
    const close = `[\\\\\\[\\s]*\\[\\s*\\/\\s*${name}\\s*\\\\?\\]+`;
    const re = new RegExp(`${open}([\\s\\S]*?)(?:${close}|$)`, "i");
    const match = raw.match(re);
    if (!match) return { rest: raw, lines: [] };
    const lines = match[1]
      .split(/\n|\s*;\s*/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim())
      .filter(Boolean);
    return { rest: raw.slice(0, match.index) + raw.slice(match.index + match[0].length), lines };
  }

  function parseAnswer(raw) {
    const path = takeBlock(raw, "path");
    const options = takeBlock(path.rest, "options");
    const text = options.rest.replace(/[\s\\[]+$/, "").trim();
    return { text, options: options.lines, path: path.lines };
  }

  function visibleWhileStreaming(raw) {
    const idx = raw.search(/[\\[\s]*\[\s*\/?\s*(?:opt|pat)/i);
    return idx >= 0 ? raw.slice(0, idx) : raw;
  }

  function renderMarkdown(raw) {
    return typeof renderMarkdownLite === "function" ? renderMarkdownLite(raw) : `<p>${escapeHtml(raw)}</p>`;
  }

  function buildStages(pathLines, references) {
    const refs = references || [];
    const stages = [];

    for (const line of pathLines) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length < 2 || !parts[1]) continue;
      const stageName = parts[0];
      const isEntry = parts.slice(2).some((p) => /^entry$/i.test(p));
      const link = parts[1].match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      const label = link ? link[1] : parts[1];
      const url = link ? link[2] : "";
      const lower = label.toLowerCase();
      const ref =
        refs.find((r) => url && normalizeUrl(r.url) === normalizeUrl(url)) ||
        refs.find((r) => cleanTitle(r.title).toLowerCase() === lower) ||
        refs.find((r) => cleanTitle(r.title).toLowerCase().startsWith(lower));

      let stage = stages.find((s) => s.name.toLowerCase() === stageName.toLowerCase());
      if (!stage) {
        stage = { name: stageName, entry: false, items: [] };
        stages.push(stage);
      }
      if (isEntry) stage.entry = true;
      stage.items.push({
        title: ref ? cleanTitle(ref.title) : label,
        url: ref ? ref.url : url,
        image: ref && ref.image,
        summary: ref && ref.summary,
      });
    }

    if (!stages.length && refs.length) {
      stages.push({
        name: "Recommended",
        items: refs.map((r) => ({ title: cleanTitle(r.title || r.url), url: r.url, image: r.image, summary: r.summary })),
      });
    }
    return stages;
  }

  function initGuide(el) {
    const topic = el.dataset.guideTopic || "DTU Learn for Life";
    const pageType = el.dataset.guidePageType || "topic";
    const title = el.dataset.guideTitle || `Find your way into ${topic}`;
    const lead = el.dataset.guideLead || "Answer a few quick questions and we'll map out a learning path that fits your background and goals.";
    const language = (el.closest("[lang]") || document.documentElement).lang || "en";
    const context = { mode: "guide", topic, pageType, language };

    el.classList.add("guide");
    el.innerHTML = `
      <div class="guide-inner">
        <header class="guide-head">
          <h2 class="guide-title">${escapeHtml(title)}</h2>
          <p class="guide-lead">${escapeHtml(lead)}</p>
        </header>
        <div class="guide-bar">
          <button type="button" class="guide-back" hidden>${BACK}<span>Back</span></button>
          <ol class="guide-progress"></ol>
          <button type="button" class="guide-restart" hidden>Start over</button>
        </div>
        <div class="guide-stage" aria-live="polite">
          <div class="guide-basis" hidden></div>
          <div class="guide-question"></div>
          <div class="guide-options"></div>
          <div class="guide-path" hidden></div>
        </div>
        <form class="guide-free" hidden>
          <input type="text" placeholder="Or describe your situation in your own words" aria-label="Describe your situation" />
          <button type="submit" aria-label="Send">${ARROW}</button>
        </form>
      </div>
    `;

    const stage = el.querySelector(".guide-stage");
    const questionEl = el.querySelector(".guide-question");
    const optionsEl = el.querySelector(".guide-options");
    const pathEl = el.querySelector(".guide-path");
    const basisEl = el.querySelector(".guide-basis");
    const progress = el.querySelector(".guide-progress");
    const backBtn = el.querySelector(".guide-back");
    const restartBtn = el.querySelector(".guide-restart");
    const freeForm = el.querySelector(".guide-free");
    const freeInput = freeForm.querySelector("input");

    let client = null;
    let busy = false;
    let started = false;
    let answers = [];
    let history = [];
    let needsReplay = false;

    function getClient() {
      const cfg = window.BonzaiConfig ? window.BonzaiConfig.get() : null;
      if (!cfg || !cfg.apiKey || !cfg.agentId) return null;
      if (!client) client = new BonzaiClient(cfg);
      return client;
    }

    function updateBar(isResult) {
      const dots = answers.map(() => `<li class="done"></li>`);
      if (!isResult) dots.push(`<li class="current"></li>`);
      progress.innerHTML = dots.join("");
      backBtn.hidden = answers.length === 0;
      restartBtn.hidden = answers.length === 0;
    }

    function transition(render) {
      stage.classList.remove("in");
      render();
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("in")));
    }

    function setLoading() {
      el.classList.remove("is-result");
      transition(() => {
        questionEl.innerHTML = `<span class="guide-skel guide-skel--line"></span><span class="guide-skel guide-skel--line short"></span>`;
        optionsEl.innerHTML = `<span class="guide-skel guide-skel--opt"></span><span class="guide-skel guide-skel--opt"></span><span class="guide-skel guide-skel--opt"></span>`;
        pathEl.hidden = true;
        basisEl.hidden = true;
      });
    }

    function optionButtons(options, cls) {
      return options
        .map((o, i) => `<button type="button" class="${cls}" style="--i:${i}"><span>${escapeHtml(o)}</span>${cls === "guide-option" ? ARROW : ""}</button>`)
        .join("");
    }

    function renderBasis() {
      basisEl.innerHTML = `
        <span class="guide-basis-label">Based on your answers</span>
        ${answers.map((a) => `<span class="guide-basis-item">${escapeHtml(a)}</span>`).join("")}`;
      basisEl.hidden = answers.length === 0;
    }

    function renderPath(stages) {
      const entryIndex = Math.max(0, stages.findIndex((s) => s.entry));
      const n = stages.length;
      pathEl.innerHTML = stages
        .map((s, si) => {
          const [main, ...more] = s.items;
          const state = si < entryIndex ? "is-before" : si === entryIndex ? "is-entry" : "is-after";
          const flag = si < entryIndex
            ? `<span class="guide-path-flag">Optional if you already know this</span>`
            : si === entryIndex
              ? `<span class="guide-path-flag">You start here</span>`
              : `<span class="guide-path-flag" aria-hidden="true">&nbsp;</span>`;
          return `
          <section class="guide-path-step ${state}" style="--i:${si}">
            <p class="guide-path-label"><span>${si + 1}</span>Step ${si + 1} · ${escapeHtml(s.name)}</p>
            ${flag}
            <a class="guide-course" href="${escapeHtml(main.url || "#")}" target="_blank" rel="noopener">
              <div class="guide-course-img${main.image ? "" : " placeholder"}">${main.image ? `<img src="${escapeHtml(main.image)}" alt="" loading="lazy" />` : ""}</div>
              <h4>${escapeHtml(main.title)}</h4>
              ${main.summary ? `<p>${escapeHtml(main.summary)}</p>` : ""}
              <span class="guide-course-more">See course ${ARROW}</span>
            </a>
            ${more.length ? `
              <div class="guide-also">
                <p>Also consider</p>
                ${more.map((c) => `<a href="${escapeHtml(c.url || "#")}" target="_blank" rel="noopener"><span>${escapeHtml(c.title)}</span>${ARROW}</a>`).join("")}
              </div>` : ""}
          </section>`;
        })
        .join("");
      pathEl.style.setProperty("--cols", String(Math.min(n, 4)));
      pathEl.hidden = false;
    }

    function showStep(data) {
      const isResult = data.stages.length > 0;
      el.classList.toggle("is-result", isResult);
      updateBar(isResult);
      transition(() => {
        questionEl.innerHTML = data.text ? renderMarkdown(data.text) : "";
        if (isResult) {
          optionsEl.innerHTML = "";
          renderBasis();
          renderPath(data.stages);
        } else {
          optionsEl.innerHTML = optionButtons(data.options, "guide-option");
          pathEl.hidden = true;
          basisEl.hidden = true;
        }
      });
      freeForm.hidden = isResult;
    }

    async function ask(c, message, onDelta) {
      let raw = "";
      const finalEvent = await c.sendMessageStreaming(message, context, (delta) => {
        raw += delta;
        if (onDelta) onDelta(raw);
      });
      const parsed = parseAnswer(raw);
      return { text: parsed.text, options: parsed.options, stages: buildStages(parsed.path, finalEvent && finalEvent.references) };
    }

    async function send(message) {
      let c = getClient();
      if (!c) {
        questionEl.innerHTML = `<p>Connect Bonzai in the bar below to start.</p>`;
        return;
      }
      busy = true;
      setLoading();
      let latest = "";
      let frame = 0;

      try {
        if (needsReplay) {
          client = null;
          c = getClient();
          await ask(c, "start");
          for (const a of answers.slice(0, -1)) await ask(c, a);
          needsReplay = false;
        }
        const data = await ask(c, message, (raw) => {
          latest = raw;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            const visible = visibleWhileStreaming(latest).trim();
            if (visible) questionEl.innerHTML = renderMarkdown(visible);
          });
        });
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        history.push(data);
        showStep(data);
      } catch (err) {
        if (frame) cancelAnimationFrame(frame);
        questionEl.innerHTML = `<p>Something went wrong: ${escapeHtml(err.message)}</p>`;
        optionsEl.innerHTML = "";
      } finally {
        busy = false;
      }
    }

    function answer(label) {
      label = label.trim();
      if (busy || !label) return;
      answers.push(label);
      send(label);
    }

    function back() {
      if (busy || history.length < 2) return;
      history.pop();
      answers.pop();
      needsReplay = true;
      showStep(history[history.length - 1]);
    }

    function start() {
      if (started) return;
      started = true;
      send("start");
    }

    function restart() {
      if (busy) return;
      client = null;
      answers = [];
      history = [];
      needsReplay = false;
      started = false;
      updateBar(false);
      start();
    }

    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".guide-option");
      if (btn) answer(btn.textContent);
    });
    backBtn.addEventListener("click", back);
    restartBtn.addEventListener("click", restart);
    freeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      answer(freeInput.value);
      freeInput.value = "";
    });

    updateBar(false);

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          start();
        }
      }, { rootMargin: "200px" });
      observer.observe(el);
    } else {
      start();
    }
  }

  function init() {
    document.querySelectorAll("[data-bonzai-guide]").forEach(initGuide);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
