/**
 * AI Studio: turn long course texts (Word) into course pages for the
 * DTU Learn for Life WordPress template, with a Bonzai agent giving feedback.
 *
 * The system prompt is loaded from assets/prompts/studio-prompt.txt at runtime.
 * The agent answers in chat text plus tagged blocks:
 *   [course] Key: value … [/course]   the current draft, all known fields
 *   [missing] - field: question … [/missing]
 *   [ready]                           draft is complete
 */
(function () {
  // Demo-only gate: a static site cannot send mail or keep secrets.
  // Production needs a backend that mails one-time codes.
  const ALLOWED_DOMAINS = ["dtu.dk", "peytz.dk"];
  const CODE_HASH = "d2f319a70942810d213eba21bd5f3e699215129ed3423d5ffad2365dd4996995";
  const AUTH_KEY = "studio-auth";

  const FIELDS = [
    { key: "title", tag: "Title", label: "Titel", required: true },
    { key: "department", tag: "Department", label: "Institut", required: true },
    { key: "type", tag: "Type", label: "Uddannelsestype", required: true },
    { key: "language", tag: "Language", label: "Sprog", required: true },
    { key: "ects", tag: "ECTS", label: "ECTS", required: true },
    { key: "goals", tag: "Goals", label: "Overordnede kursusmål", required: true },
    { key: "objectives", tag: "Learning objectives", label: "Læringsmål", required: true, list: true },
    { key: "content", tag: "Content", label: "Kursusindhold", required: true },
    { key: "prerequisites", tag: "Prerequisites", label: "Anbefalede forudsætninger" },
    { key: "teaching", tag: "Teaching", label: "Undervisningsform", required: true },
    { key: "faculty", tag: "Faculty", label: "Fakultet", list: true },
    { key: "duration", tag: "Duration", label: "Varighed", required: true },
    { key: "location", tag: "Location", label: "Sted", required: true },
    { key: "courseId", tag: "Course ID", label: "Kursus ID" },
    { key: "level", tag: "Level", label: "Kursustype" },
    { key: "schedule", tag: "Days", label: "Dage" },
    { key: "price", tag: "Price", label: "Pris", required: true },
    { key: "contact", tag: "Contact", label: "Faglig kontakt", required: true },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let client = null;
  let course = {};
  let ready = false;
  let busy = false;

  /* ---------- Login ---------- */

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function initLogin() {
    const form = $("studio-login-form");
    const msg = $("studio-login-msg");
    const emailStep = form.querySelector('[data-step="email"]');
    const codeStep = form.querySelector('[data-step="code"]');
    let email = "";

    const saved = JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null");
    if (saved && saved.email) return enter(saved.email);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "";
      if (!codeStep.hidden) {
        const code = $("studio-code").value.trim().toUpperCase();
        if ((await sha256(code)) !== CODE_HASH) {
          msg.textContent = "Koden er forkert.";
          return;
        }
        sessionStorage.setItem(AUTH_KEY, JSON.stringify({ email }));
        return enter(email);
      }
      email = $("studio-email").value.trim().toLowerCase();
      const domain = email.split("@")[1] || "";
      if (!ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) {
        msg.textContent = "Denne mail har ikke adgang til AI Studio.";
        return;
      }
      emailStep.hidden = true;
      codeStep.hidden = false;
      msg.textContent = `Vi har sendt en loginkode til ${email}.`;
      $("studio-code").focus();
    });

    $("studio-login-back").addEventListener("click", () => {
      codeStep.hidden = true;
      emailStep.hidden = false;
      msg.textContent = "";
    });
  }

  function enter(email) {
    $("studio-login").hidden = true;
    $("studio").hidden = false;
    $("studio-user").textContent = email;
    $("studio-user").hidden = false;
    $("studio-logout").hidden = false;
    initStudio();
  }

  $("studio-logout").addEventListener("click", () => {
    sessionStorage.removeItem(AUTH_KEY);
    location.reload();
  });

  /* ---------- Bonzai ---------- */

  // Bonzai project key + OpenAI-compatible chat completions. Stateless, so we keep the history.
  const API_URL = "https://api-v2.bonzai.iodigital.com/v1/chat/completions";
  const PROMPT_URL = "assets/prompts/studio-prompt.txt";
  let systemPrompt = null;
  let messages = [];

  function getClient() {
    const cfg = window.BonzaiConfig && window.BonzaiConfig.get();
    if (!cfg || !cfg.apiKey) return null;
    return { apiKey: cfg.apiKey, model: cfg.agentId || "claude-sonnet-4-5" };
  }

  async function loadPrompt() {
    if (systemPrompt) return systemPrompt;
    const res = await fetch(`${PROMPT_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error("Prompten kunne ikke hentes.");
    systemPrompt = await res.text();
    return systemPrompt;
  }

  async function ask(text) {
    if (!client) client = getClient();
    if (!client) throw new Error("Indsæt projektets API key i baren nederst først.");
    const system = await loadPrompt();
    const next = [...messages, { role: "user", content: text }];
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${client.apiKey}` },
      body: JSON.stringify({ model: client.model, messages: [{ role: "system", content: system }, ...next] }),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = (body.error && (body.error.message || body.error)) || body.message || detail;
      } catch (_) {
        /* ignore */
      }
      throw new Error(`Bonzai svarede ${res.status}: ${detail}`);
    }
    const data = await res.json();
    const answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    messages = [...next, { role: "assistant", content: answer }];
    return { response: { answer } };
  }

  /* ---------- Parsing ---------- */

  function hasValue(v) {
    return Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim());
  }

  function block(raw, name) {
    const m = raw.match(new RegExp(`\\\\?\\[\\s*${name}\\s*\\\\?\\]([\\s\\S]*?)(?:\\\\?\\[\\s*\\/\\s*${name}\\s*\\\\?\\]|$)`, "i"));
    return m ? { body: m[1], rest: raw.replace(m[0], "") } : { body: null, rest: raw };
  }

  function parseCourse(body) {
    const out = {};
    const byTag = new Map(FIELDS.map((f) => [f.tag.toLowerCase(), f]));
    let field = null;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim().replace(/^\*\*(.+?)\*\*/, "$1");
      if (!line) continue;
      const kv = line.match(/^([A-Za-z ]+?)\s*:\s*(.*)$/);
      const hit = kv && byTag.get(kv[1].toLowerCase());
      if (hit) {
        field = hit;
        const val = kv[2].trim();
        out[field.key] = field.list ? (val ? val.split(/\s*;\s*/) : []) : val;
        continue;
      }
      if (!field) continue;
      const item = line.replace(/^(?:[-*•]|\d+\.)\s*/, "");
      if (field.list) out[field.key].push(item);
      else out[field.key] = out[field.key] ? `${out[field.key]}\n\n${line}` : line;
    }
    for (const f of FIELDS) {
      const v = out[f.key];
      if (typeof v === "string" && /^(?:-|n\/a|ukendt|unknown|mangler|missing)$/i.test(v)) delete out[f.key];
    }
    return out;
  }

  function parseReply(raw) {
    let rest = raw || "";
    const c = block(rest, "course");
    rest = c.rest;
    const m = block(rest, "missing");
    rest = m.rest;
    const isReady = /\\?\[\s*ready\s*\\?\]/i.test(rest);
    rest = rest.replace(/\\?\[\s*\/?\s*ready\s*\\?\]/gi, "").trim();
    const missing = m.body
      ? m.body.split("\n").map((l) => l.trim().replace(/^(?:[-*•]|\d+\.)\s*/, "")).filter(Boolean)
      : [];
    return { text: rest, course: c.body ? parseCourse(c.body) : null, missing, ready: isReady };
  }

  /* ---------- Chat ---------- */

  function addMessage(role, html) {
    const el = document.createElement("div");
    el.className = `studio-msg studio-msg--${role}`;
    el.innerHTML = html;
    $("studio-thread").appendChild(el);
    el.scrollIntoView({ block: "end", behavior: "smooth" });
    return el;
  }

  function md(text) {
    return typeof renderMarkdownLite === "function" ? renderMarkdownLite(text) : `<p>${esc(text)}</p>`;
  }

  async function send(text, shown) {
    if (busy || !text.trim()) return;
    busy = true;
    $("studio-send").disabled = true;
    addMessage("user", shown || md(text));
    const pending = addMessage("agent", `<span class="studio-typing"><i></i><i></i><i></i></span>`);
    try {
      const data = await ask(text);
      const reply = parseReply((data.response && data.response.answer) || "");
      if (reply.course) course = { ...course, ...reply.course };
      ready = reply.ready;
      let html = md(reply.text || (reply.course ? "Jeg har opdateret kladden." : "…"));
      if (reply.missing.length) {
        html += `<div class="studio-missing"><strong>Mangler</strong><ul>${reply.missing
          .map((m) => `<li>${esc(m)}</li>`)
          .join("")}</ul></div>`;
      }
      pending.innerHTML = html;
      renderPreview();
    } catch (err) {
      pending.innerHTML = `<p class="studio-error">Noget gik galt: ${esc(err.message)}</p>`;
    } finally {
      busy = false;
      $("studio-send").disabled = false;
    }
  }

  async function readFile(file) {
    if (/\.docx$/i.test(file.name)) {
      if (!window.mammoth) throw new Error("Word-læseren kunne ikke indlæses.");
      const res = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return res.value;
    }
    return file.text();
  }

  async function handleFile(file) {
    if (!file || busy) return;
    try {
      const text = (await readFile(file)).replace(/\n{3,}/g, "\n\n").trim();
      if (!text) throw new Error("Filen er tom.");
      course = {};
      ready = false;
      messages = [];
      renderPreview();
      const words = text.split(/\s+/).length;
      send(
        `Kursustekst fra filen "${file.name}":\n\n${text}`,
        `<p class="studio-file">📄 <strong>${esc(file.name)}</strong><br><small>${words.toLocaleString("da-DK")} ord</small></p>`
      );
    } catch (err) {
      addMessage("agent", `<p class="studio-error">${esc(err.message)}</p>`);
    }
  }

  /* ---------- Preview ---------- */

  function missingBox(label) {
    return `<span class="cp-missing">Mangler: ${esc(label)}</span>`;
  }

  function val(key) {
    const f = FIELDS.find((x) => x.key === key);
    const v = course[key];
    if (!hasValue(v)) return missingBox(f.label);
    return Array.isArray(v) ? v.map(esc).join(", ") : esc(v);
  }

  function paras(key) {
    const f = FIELDS.find((x) => x.key === key);
    const v = course[key];
    if (!hasValue(v)) return `<p>${missingBox(f.label)}</p>`;
    return String(v).split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("");
  }

  function renderPreview() {
    const box = $("studio-preview");
    const status = $("studio-status");
    const publish = $("studio-publish");
    const filled = FIELDS.filter((f) => f.required && hasValue(course[f.key])).length;
    const total = FIELDS.filter((f) => f.required).length;

    if (!Object.keys(course).length) {
      box.innerHTML = `<div class="studio-empty"><p>Upload en kursustekst i Word, så bygger AI'en kursussiden her.</p></div>`;
      status.textContent = "Ingen kursustekst endnu";
      status.className = "studio-status";
      publish.disabled = true;
      return;
    }

    const complete = ready || filled === total;
    status.textContent = complete ? "Klar til WordPress" : `${filled} af ${total} påkrævede felter`;
    status.className = `studio-status ${complete ? "is-ready" : "is-draft"}`;
    publish.disabled = !hasValue(course.title);

    const objectives = hasValue(course.objectives)
      ? `<ul>${course.objectives.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
      : `<p>${missingBox("Læringsmål")}</p>`;
    const faculty = hasValue(course.faculty)
      ? course.faculty.map((n) => `<div class="cp-person"><span class="cp-avatar">${esc(n.trim()[0] || "")}</span>${esc(n)}</div>`).join("")
      : missingBox("Fakultet");
    const row = (label, key) => `<tr><th>${label}</th><td>${val(key)}</td></tr>`;

    box.innerHTML = `
      <article class="cp">
        <div class="cp-tags">
          <span>${val("type")}</span><span>${val("language")}</span><span>${hasValue(course.ects) ? `${esc(String(course.ects).replace(/\s*ECTS/i, ""))} ECTS` : missingBox("ECTS")}</span>
        </div>
        <h1 class="cp-title">${hasValue(course.title) ? esc(course.title) : missingBox("Titel")}</h1>
        <p class="cp-dept">${val("department")}</p>

        <h2>Overordnede kursusmål</h2>
        ${paras("goals")}
        <h3>Læringsmål</h3>
        ${objectives}
        <h3>Kursusindhold</h3>
        ${paras("content")}
        <h3>Anbefalede forudsætninger</h3>
        ${paras("prerequisites")}
        <h3>Undervisningsform</h3>
        ${paras("teaching")}

        <h3>Fakultet</h3>
        <div class="cp-faculty">${faculty}</div>

        <h2>Tilmelding</h2>
        <table class="cp-table">
          ${row("Sprog", "language")}${row("Varighed", "duration")}${row("Institut", "department")}
          ${row("Sted", "location")}${row("Kursus ID", "courseId")}${row("Kursustype", "level")}${row("Dage", "schedule")}
        </table>
        <table class="cp-table cp-price"><tr><th>Pris</th><td>${val("price")}</td></tr></table>

        <div class="cp-contact">
          <div><h4>Spørgsmål om kursets indhold?</h4><p>${val("contact")}</p></div>
          <div><h4>Praktiske spørgsmål (fx tilmelding)?</h4><p>DTU Learn for Life<br>Telefon: (+45) 45 25 45 25<br>E-mail: learnforlife@dtu.dk</p></div>
        </div>
      </article>`;
  }

  /* ---------- Publish (simulated) ---------- */

  function publish() {
    const missing = FIELDS.filter((f) => f.required && !hasValue(course[f.key])).map((f) => f.label);
    if (missing.length && !confirm(`Der mangler stadig: ${missing.join(", ")}.\n\nSend alligevel som kladde?`)) return;
    $("studio-modal-text").innerHTML = `
      <strong>${esc(course.title)}</strong> er oprettet som kladde i WordPress
      ${hasValue(course.department) ? `under ${esc(course.department)}` : ""}.<br><br>
      Fie er adviseret og kan lægge sidste hånd på siden, før den udgives.
      <br><br><small>Demo: Der er ikke sendt noget til WordPress endnu.</small>`;
    $("studio-modal").hidden = false;
    addMessage("agent", `<p>Kladden er sendt til WordPress, og Fie er adviseret.</p>`);
  }

  /* ---------- Init ---------- */

  let initialised = false;
  function initStudio() {
    if (initialised) return;
    initialised = true;

    addMessage(
      "agent",
      `<p>Hej! Upload en kursustekst i Word, så laver jeg den om til en kursusside og fortæller dig, hvad der mangler i forhold til skabelonen.</p>`
    );
    renderPreview();

    const fileInput = $("studio-file");
    $("studio-upload").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      handleFile(fileInput.files[0]);
      fileInput.value = "";
    });

    const drop = $("studio-drop");
    const chat = document.querySelector(".studio-chat");
    ["dragenter", "dragover"].forEach((t) =>
      chat.addEventListener(t, (e) => {
        e.preventDefault();
        drop.classList.add("is-over");
      })
    );
    ["dragleave", "drop"].forEach((t) => chat.addEventListener(t, () => drop.classList.remove("is-over")));
    chat.addEventListener("drop", (e) => {
      e.preventDefault();
      handleFile(e.dataTransfer.files[0]);
    });

    const textarea = $("studio-text");
    $("studio-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = textarea.value;
      textarea.value = "";
      send(text);
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("studio-form").requestSubmit();
      }
    });

    $("studio-publish").addEventListener("click", publish);
    $("studio-modal-close").addEventListener("click", () => ($("studio-modal").hidden = true));
    document.addEventListener("bonzai-config-change", () => (client = null));
  }

  initLogin();
})();
