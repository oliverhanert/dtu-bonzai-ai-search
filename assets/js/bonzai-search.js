/**
 * Site search on top of Bonzai. One call per query; the answer contains
 *   one summary sentence
 *   [intent]  Mode / Topic
 *   [results] one line per relevant page with its citation marker
 * The cited references are the result list, ordered as listed in [results].
 */
(function () {
  const K = window.GuideKit;
  const $ = (id) => document.getElementById(id);
  const esc = K.escapeHtml;

  const hero = $("ps-hero");
  const main = $("ps-main");
  const input = $("ps-input");
  const clearBtn = $("ps-clear");
  const headingEl = $("ps-heading");
  const summaryEl = $("ps-summary");
  const countEl = $("ps-count");
  const facetsEl = $("ps-facets");
  const listEl = $("ps-list");

  const GUIDE_URL = "guide.html";
  const GUIDE_AFTER = 3;

  const ARROW = `<svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M0 6h14M9 1l5 5-5 5"/></svg>`;
  const AI_ICON = `<svg class="ps-ai-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="AI-generated summary"><title>AI-generated summary</title><path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8z"/><path d="M18.5 13l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg>`;
  const TYPES = [
    { id: "programme", label: "Programmes", tag: "Programme", test: /\/(diplom|diploma|master|master-en|executive[^/]*|mba[^/]*)\// },
    { id: "course", label: "Single courses", tag: "Single course", test: /\/(enkeltfag|single-course|kurser|courses?)\// },
    { id: "event", label: "Events", tag: "Event", test: /\/(events?|arrangementer|webinars?)\// },
    { id: "article", label: "Articles", tag: "Article", test: /\/(nyheder|news|artikler|articles|blog)\// },
    { id: "page", label: "Other", tag: "Page", test: /$^/ },
  ];

  /** Many programmes exist only in Danish, so thin same-language hits are topped up with the other language. */
  const MIN_SAME_LANG = 5;

  let searchId = 0;
  let query = "";
  let mode = "browse";
  let results = [];
  let facet = "all";

  /* ---------- Parsing ---------- */

  function fieldsOf(lines) {
    const out = {};
    for (const line of lines) {
      const m = line.match(/^([A-Za-z ]+?)\s*:\s*(.+)$/);
      if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
    }
    return out;
  }

  function cleanText(text) {
    return text
      .replace(/<sup>.*?<\/sup>/gi, "")
      .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)?/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/(\*\*|__|\*|`)(.+?)\1/g, "$2")
      .replace(/^#+\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function firstSentences(text, n) {
    const parts = text.match(/[^.!?]+[.!?]+(?=\s|$)/g);
    return parts && parts.length > n ? parts.slice(0, n).join("").trim() : text;
  }

  function parse(raw) {
    let rest = raw || "";
    const intent = K.takeBlock(rest, "intent");
    rest = intent.rest;
    const list = K.takeBlock(rest, "results");
    rest = list.rest.replace(/\[\s*\/?\s*(?:intent|results)\s*\]/gi, "");
    const fields = fieldsOf(intent.lines);
    return {
      summary: firstSentences(cleanText(rest.split(/\n{2,}/)[0] || ""), 3),
      mode: (fields.mode || "").toLowerCase(),
      order: (list.lines.join(" ").match(/\[(\d+)\]/g) || []).map((m) => Number(m.slice(1, -1))),
    };
  }

  function linksIn(raw) {
    const out = [];
    const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]*dtu\.dk[^)\s]*)\)/gi;
    let m;
    while ((m = re.exec(raw || ""))) out.push({ title: m[1], url: m[2] });
    return out;
  }

  const decoder = document.createElement("textarea");
  function decode(text) {
    decoder.innerHTML = text || "";
    return decoder.value;
  }

  function classify(ref) {
    const url = (ref.url || "").toLowerCase();
    for (const t of TYPES) if (t.test.test(url)) return t.id;
    return "page";
  }

  function metaOf(ref) {
    const text = `${ref.title || ""} ${ref.summary || ""}`;
    const meta = [];
    const ects = text.match(/(\d+(?:[.,]\d+)?)\s*ECTS/i);
    if (ects) meta.push(`${ects[1]} ECTS`);
    if (/\bonline\b|fjernundervisning/i.test(text)) meta.push("Online");
    const price = text.match(/(\d{1,3}(?:\.\d{3})+)(?:,\d{2})?\s*(?:kr|dkk)/i);
    if (price) meta.push(`${price[1]} DKK`);
    return meta;
  }

  /** Pages under /en/ (or *-en/) are English; everything else on the site is Danish. */
  function pageLang(url) {
    return /\/en(\/|$)|-en(\/|$)/i.test(url) ? "en" : "da";
  }

  const STOPWORDS = new Set(
    ("jeg vil gerne godt vide mere om hvad hvordan hvor hvilke hvilken kan man der er har i jer en et at og eller til for med på af " +
      "noget nogle nogen mig min mit mine skal lære læse finde søge søger leder efter tak hej " +
      "i want would like to know more about what how where which can do does is are have has a an the and or for with on of in " +
      "me my some any find learn study looking search please hi")
      .split(" ")
  );

  /** Retrieval in Bonzai is keyword-heavy, so long sentences are reduced to their content words. */
  function searchTerms(q) {
    const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
    if (words.length < 4) return q;
    const kept = words.filter((w) => !STOPWORDS.has(w));
    return kept.length ? kept.join(" ") : q;
  }

  /** People describing themselves get the bridge to the study guide. */
  const PERSONAL = /\b(jeg vil|jeg er|jeg har|jeg arbejder|vide mere|hvad skal jeg|hvad kan jeg|skifte|karriere|blive leder|i want|i'd like|i am|i'm|i work|what should i|what can i|career|become a)\b/i;

  function queryLang(q) {
    return /[æøå]|\b(jeg|og|hvad|hvordan|hvor|kursus|kurser|uddannelse|efteruddannelse|ledelse|vil|kan|til|med)\b/i.test(q) ? "da" : "en";
  }

  function toResults(res, order) {
    const seen = new Set();
    const refs = (res.references || []).filter((r) => r.url && !seen.has(r.url) && seen.add(r.url));
    const rank = (r) => {
      const i = order.indexOf(Number(r.index));
      return i < 0 ? order.length : i;
    };
    const lang = queryLang(query);
    const byRank = (list) =>
      list
        .map((r, i) => [r, i])
        .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
        .map(([r]) => r);
    const sameLang = byRank(refs.filter((r) => pageLang(r.url) === lang));
    return (sameLang.length >= MIN_SAME_LANG ? sameLang : byRank(refs))
      .map((r) => ({ ...r, title: decode(r.title), summary: decode(r.summary) }))
      .map((r) => ({ ...r, type: classify(r), meta: metaOf(r) }));
  }

  /* ---------- Rendering ---------- */

  function renderFacets() {
    const counts = { all: results.length };
    results.forEach((r) => (counts[r.type] = (counts[r.type] || 0) + 1));
    countEl.textContent = results.length ? `${results.length} ${results.length === 1 ? "result" : "results"}` : "";
    const order = ["all", ...TYPES.map((t) => t.id)].filter((id) => counts[id]);
    const label = (id) => (id === "all" ? "All" : TYPES.find((t) => t.id === id).label);
    facetsEl.innerHTML =
      order.length > 2
        ? order.map((id) => `<button type="button" class="${id === facet ? "is-active" : ""}" data-facet="${id}">${label(id)} <span>${counts[id]}</span></button>`).join("")
        : "";
    facetsEl.querySelectorAll("[data-facet]").forEach((b) =>
      b.addEventListener("click", () => {
        facet = b.dataset.facet;
        renderFacets();
        renderList();
      })
    );
  }

  function resultHtml(r, i) {
    const tag = TYPES.find((t) => t.id === r.type).tag;
    return `
      <a class="ps-result" href="${esc(r.url)}" target="_blank" rel="noopener" style="--i:${i}">
        <h3>${esc(K.cleanTitle(r.title || r.url))}</h3>
        ${r.summary ? `<p>${esc(K.briefText(r.summary, 180))}</p>` : ""}
        <div class="ps-result-foot"><span class="ps-tag">${tag}</span>${r.meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
        <span class="ps-result-arrow">${ARROW}</span>
      </a>`;
  }

  function guideHtml() {
    return `
      <a class="ps-bridge" href="${GUIDE_URL}?q=${encodeURIComponent(query)}">
        <span>
          <strong>Not sure what fits you?</strong>
          Get personal guidance on the Diploma in Leadership in our study guide.
        </span>
        <span class="ps-bridge-cta">Open study guide ${ARROW}</span>
      </a>`;
  }

  function renderList() {
    if (!results.length) {
      const popular = [...document.querySelectorAll("#ps-examples [data-q]")].map((b) => b.dataset.q).slice(0, 4);
      listEl.innerHTML = `
        <div class="ps-empty">
          <h3>We couldn’t find pages for “${esc(query)}”.</h3>
          <p>Try fewer or broader words, or one of these popular searches:</p>
          <div class="ps-empty-chips">${popular.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
          <div class="ps-empty-help">
            <a href="index.html">Browse all degrees &amp; courses</a>
            <a href="mailto:learnforlife@dtu.dk">Ask a study adviser</a>
          </div>
        </div>`;
      listEl.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => search(b.dataset.q)));
      return;
    }
    const shown = facet === "all" ? results : results.filter((r) => r.type === facet);
    const items = shown.map(resultHtml);
    if (facet === "all" && (mode === "path" || PERSONAL.test(query))) items.splice(Math.min(GUIDE_AFTER, items.length), 0, guideHtml());
    listEl.innerHTML = items.join("");
  }

  function show(res) {
    const p = parse(res.raw);
    mode = p.mode || "browse";
    results = toResults(res, p.order);
    facet = "all";
    summaryEl.innerHTML = results.length && p.summary ? `${AI_ICON}${esc(p.summary)}` : "";
    renderFacets();
    renderList();
  }

  function setLoading() {
    summaryEl.innerHTML = "";
    countEl.textContent = "";
    facetsEl.innerHTML = "";
    listEl.innerHTML = `<div class="ps-skel"></div><div class="ps-skel"></div><div class="ps-skel"></div>`;
  }

  function showError(err) {
    listEl.innerHTML = `<p class="ps-error">${esc(err.message)}</p>`;
  }

  /* ---------- Flow ---------- */

  const inflight = new Map();

  /** One request per query at a time; repeated submits reuse the running request. */
  function fetchResults(q) {
    const key = q.toLowerCase().trim();
    if (inflight.has(key)) return inflight.get(key);
    const client = K.getClient();
    if (!client) return Promise.reject(new Error("Connect Bonzai in the bar below to search."));
    const ctx = { mode: "search", language: queryLang(q) };
    const run = (async () => {
      const terms = searchTerms(q);
      const started = performance.now();
      /* The agent allows one answer per conversation, so every request must start a new one. */
      const ask = () => (client.reset(), K.fetchOnce(client, terms, ctx));
      let res = await ask();
      /* Bonzai occasionally drops all references even though the answer cites sources; one retry recovers it. */
      if (!res.references.length && /\[\d+\]/.test(res.raw)) res = await ask();
      window.__searchDebug = { query: q, sent: terms, ms: Math.round(performance.now() - started), raw: res.raw, references: res.references, event: res.event };
      if (!res.references.length) res = { ...res, references: linksIn(res.raw) };
      return res;
    })().finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
  }

  async function search(q) {
    q = (q || "").trim();
    if (!q) return;
    const id = ++searchId;
    query = q;
    input.value = q;
    clearBtn.hidden = false;
    headingEl.innerHTML = `Results for <em>“${esc(q)}”</em>`;
    const url = new URL(location.href);
    url.searchParams.set("q", q);
    history.replaceState(null, "", url);
    hero.classList.add("is-compact");
    main.hidden = false;

    setLoading();
    try {
      const res = await fetchResults(q);
      if (id !== searchId) return;
      show(res);
    } catch (err) {
      if (id === searchId) showError(err);
    }
  }

  function reset() {
    searchId++;
    query = "";
    results = [];
    input.value = "";
    clearBtn.hidden = true;
    hero.classList.remove("is-compact");
    main.hidden = true;
    history.replaceState(null, "", location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
    input.focus();
  }

  /* ---------- Events ---------- */

  $("ps-form").addEventListener("submit", (e) => {
    e.preventDefault();
    search(input.value);
  });
  $("ps-reset").addEventListener("click", reset);
  clearBtn.addEventListener("click", reset);
  input.addEventListener("input", () => (clearBtn.hidden = !input.value));
  document.querySelectorAll("#ps-examples [data-q]").forEach((b) => {
    b.addEventListener("click", () => search(b.dataset.q));
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  const initial = new URLSearchParams(location.search).get("q");
  if (initial) search(initial);
  else input.focus();
})();
