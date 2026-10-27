/**
 * Learning-path guide (mode "guide"): one question per step, each ending with
 * an [options] block. The recommendation uses a package card + staged course list.
 */
(function () {
  const K = window.GuideKit;
  /** Bonzai caps the conversation at 5 turns: start + 3 answers + one forced finish. */
  const MAX_ANSWERS = 3;
  const FINISH_MESSAGE = "Please show my recommendation now.";
  const DEFAULT_CONTACT = {
    name: "DTU Learn for Life",
    title: "+45 45 25 45 25",
    email: "learnforlife@dtu.dk",
  };
  function parseAnswer(raw, refs) {
    const routed = K.parseRoutes(raw, refs);
    const path = K.takeBlock(routed.rest, "path");
    const pkg = K.takeBlock(path.rest, "package");
    const contact = K.takeBlock(pkg.rest, "contact");
    const stages = buildStages(path.lines, refs);
    const options = K.guideStepOptions(raw);
    return {
      text: K.guideStepQuestion(raw),
      routeText: K.guideIntro(raw) || routed.text,
      packages: routed.packages,
      options,
      stages,
      pkg: K.fields(pkg.lines),
      contact: K.fields(contact.lines),
      isLastQuestion: K.isLastQuestionStep(raw),
    };
  }

  function buildStages(lines, refs) {
    const stages = [];
    for (const line of lines) {
      const cut = line.indexOf("|");
      if (cut < 0) continue;
      const name = line.slice(0, cut).trim();
      const rest = line.slice(cut + 1);
      if (!rest.trim()) continue;
      let stage = stages.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!stage) {
        stage = { name, entry: false, items: [] };
        stages.push(stage);
      }
      if (/\|\s*entry\s*(\||$)/i.test(rest)) stage.entry = true;
      stage.items.push(K.courseWithMeta(rest, refs));
    }
    const anyCited = stages.some((s) => s.items.some((c) => c.matched));
    if (!anyCited) return stages;
    return stages
      .map((s) => ({ ...s, items: s.items.filter((c) => c.matched) }))
      .filter((s) => s.items.length);
  }

  function initGuide(el) {
    const topic = el.dataset.guideTopic || "DTU Learn for Life";
    const pageType = el.dataset.guidePageType || "topic";
    const title = el.dataset.guideTitle || `Find your way into ${topic}`;
    const lead =
      el.dataset.guideLead ||
      "Answer a few quick questions — we'll map out a learning path that fits your background and goals.";
    const context = { mode: "guide", topic, pageType, language: K.pageLanguage(el) };
    el.classList.add("guide", "guide--guide");
    el.innerHTML = `
      <div class="guide-inner">
        <header class="guide-head">
          <h2 class="guide-title">${K.escapeHtml(title)}</h2>
          <p class="guide-lead">${K.escapeHtml(lead)}</p>
        </header>
        <div class="guide-bar">
          <button type="button" class="guide-back" hidden>${K.BACK}<span>Back</span></button>
          <div class="guide-basis" hidden></div>
          <button type="button" class="guide-restart" hidden>Start over</button>
        </div>
        <div class="guide-stage" aria-live="polite">
          <div class="guide-question"></div>
          <div class="guide-options"></div>
          <div class="guide-result" hidden></div>
        </div>
      </div>
      <div class="guide-share" hidden>
        <div class="car-share-dialog guide-share-dialog" role="dialog" aria-labelledby="guide-share-title">
          <header>
            <h4 id="guide-share-title">Share your recommendation</h4>
            <button type="button" class="car-share-close guide-share-close" aria-label="Close">×</button>
          </header>
          <p class="car-hint">You can edit the draft before copying it or opening it in your email application. It is intended for whoever approves study time or professional development funding.</p>
          <textarea class="car-share-text guide-share-text" rows="14"></textarea>
          <div class="car-share-actions">
            <button type="button" class="btn btn-sm btn-primary guide-share-copy">Copy text</button>
            <button type="button" class="btn btn-sm guide-share-email">Open in email</button>
          </div>
        </div>
      </div>
    `;

    const stage = el.querySelector(".guide-stage");
    const questionEl = el.querySelector(".guide-question");
    const optionsEl = el.querySelector(".guide-options");
    const resultEl = el.querySelector(".guide-result");
    const basisEl = el.querySelector(".guide-basis");
    const backBtn = el.querySelector(".guide-back");
    const restartBtn = el.querySelector(".guide-restart");
    const shareEl = el.querySelector(".guide-share");
    const shareText = el.querySelector(".guide-share-text");

    let client = null;
    let lastResult = null;
    let lastResultRefs = [];
    let allRefs = new Map();
    let busy = false;
    let started = false;
    let answers = [];
    let history = [];
    /** How many messages in the current Bonzai conversation (start = 1). */
    let dialogTurn = 0;
    /** After Back, the next send must replay from "start" through the new path. */
    let mustReplay = false;
    let bootPromise = null;
    let guideReady = false;

    function updateBar() {
      backBtn.hidden = answers.length === 0;
      restartBtn.hidden = answers.length === 0;
    }

    function transition(render) {
      stage.classList.remove("in");
      render();
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("in")));
    }

    function setLoading(finishing) {
      el.classList.remove("is-result");
      el.classList.toggle("is-finishing", Boolean(finishing));
      transition(() => {
        if (finishing) {
          questionEl.innerHTML = `
            <div class="guide-finishing" role="status" aria-live="polite">
              <div class="guide-finishing-spinner" aria-hidden="true"></div>
              <p class="guide-finishing-text">Building your recommendation…</p>
            </div>`;
          optionsEl.innerHTML = "";
        } else {
          questionEl.innerHTML = `<span class="guide-skel guide-skel--line"></span><span class="guide-skel guide-skel--line short"></span>`;
          optionsEl.classList.add("guide-options--cards");
          optionsEl.style.setProperty("--opts", "4");
          optionsEl.innerHTML = '<span class="guide-skel guide-skel--opt"></span>'.repeat(4);
        }
        resultEl.hidden = true;
      });
    }

    function renderBasis() {
      basisEl.innerHTML = `
        <span class="guide-basis-label">Based on your answers</span>
        ${answers.map((a) => `<span class="guide-basis-item">${K.escapeHtml(a)}</span>`).join("")}`;
      basisEl.hidden = answers.length === 0;
    }

    function sharePlanBtn() {
      return `<button type="button" class="btn btn-sm guide-share-open">Share plan</button>`;
    }

    function guideShareBrief(data) {
      const intro = data.routeText || "";
      const best = data.packages.find((p) => p.best) || data.packages[0];
      const pkgName = best ? best.name : "your learning path";
      const lines = [];
      if (best && best.courses) {
        best.courses.forEach((c) => {
          lines.push(`• ${c.title}${c.meta && c.meta.length ? ` (${c.meta.join(", ")})` : ""}${c.url ? `\n  ${c.url}` : ""}`);
        });
      }
      data.stages.forEach((s) => {
        s.items.forEach((c) => {
          lines.push(`• ${c.title}${c.meta && c.meta.length ? ` (${c.meta.join(", ")})` : ""}${c.url ? `\n  ${c.url}` : ""}`);
        });
      });
      const uniq = [...new Set(lines)];
      return (
        `Subject: Learning plan — ${topic}\n\n` +
        `Hi,\n\n` +
        `I'd like to share a draft learning plan from DTU Learn for Life (${topic}).\n\n` +
        (intro ? `${intro}\n\n` : "") +
        `Suggested direction: ${pkgName}\n` +
        (uniq.length ? `\nCourses to consider:\n${uniq.join("\n")}\n` : "") +
        `\nHappy to discuss timing and budget.\n\nBest regards`
      );
    }

    function renderResult(data) {
      lastResult = data;
      const { routeText, packages, stages, pkg } = data;
      const contact = data.contact && (data.contact.name || data.contact.email) ? data.contact : DEFAULT_CONTACT;
      const intro = routeText || "";
      const multi = packages.length >= 2;

      if (packages.length) {
        const cards = packages
          .map((p, i) => {
            const staged = p.best && stages.length;
            const share = p.best ? sharePlanBtn() : "";
            const facts = K.packageFacts(p, pkg, staged ? stages : null, lastResultRefs);
            return `<div class="guide-result-item${p.best ? " guide-result-item--best" : ""}" style="--i:${i}">${share}${K.packageCardHtml({
              best: p.best,
              badge: p.best ? "Best match for you" : "",
              name: p.name,
              fits: p.fits || (p.best && !staged ? intro : ""),
              facts,
              stages: staged ? stages : undefined,
              courses: staged ? undefined : p.courses,
              contact: p.best ? contact : null,
              thumbCls: "pkg-thumb",
            })}</div>`;
          })
          .join("");
        resultEl.innerHTML = `
          <h3 class="guide-result-heading">${multi ? "Your options" : "Here's your recommended path"}</h3>
          ${multi && intro ? `<p class="guide-result-lead">${K.escapeHtml(intro)}</p>` : ""}
          <div class="guide-result-grid" style="--cols:${Math.min(packages.length, 3)}">${cards}</div>`;
        resultEl.hidden = false;
        return;
      }

      if (!stages.length) {
        resultEl.hidden = true;
        return;
      }
      const goal = stages[stages.length - 1];
      resultEl.innerHTML = `
        <h3 class="guide-result-heading">Here's your recommended path</h3>
        <div class="guide-result-grid guide-result-grid--single" style="--cols:1">
          <div class="guide-result-item guide-result-item--best">
            ${sharePlanBtn()}
            ${K.packageCardHtml({
            best: true,
            badge: "Recommended for you",
            name: goal ? goal.name : "Your learning path",
            fits: intro,
            facts: K.packageFacts({ courses: stages.flatMap((s) => s.items) }, pkg, stages, lastResultRefs),
            stages,
            contact,
            thumbCls: "pkg-thumb",
          })}</div>
        </div>`;
      resultEl.hidden = false;
    }

    function showStep(data) {
      const isResult = data.packages.length > 0 || data.stages.length > 0;
      el.classList.remove("is-finishing");
      el.classList.toggle("is-result", isResult);
      el.classList.toggle("guide--asking", !isResult);
      updateBar();
      transition(() => {
        const q = isResult ? "" : data.text || "";
        questionEl.innerHTML = q ? K.renderMarkdown(q) : "";
        if (isResult) {
          optionsEl.innerHTML = "";
          renderBasis();
          renderResult(data);
        } else {
          const n = Math.max(data.options.length, 1);
          optionsEl.classList.add("guide-options--cards");
          optionsEl.style.setProperty("--opts", String(n));
          optionsEl.innerHTML = data.options
            .map(
              (o, i) =>
                `<button type="button" class="guide-option guide-option--card" style="--i:${i}" data-answer="${K.escapeHtml(o).replace(/"/g, "&quot;")}" title="${K.escapeHtml(o).replace(/"/g, "&quot;")}"><span class="guide-option-label">${K.escapeHtml(K.guideOptionLabel(o))}</span>${K.ARROW}</button>`
            )
            .join("");
          resultEl.hidden = true;
          renderBasis();
        }
      });
    }

    async function fetchTurn(msg, isFirst) {
      const { raw, references } = await K.fetchOnce(client, msg, isFirst ? context : undefined);
      window.__guideLastReply = { msg, raw, references };
      if (isFirst) allRefs = new Map();
      (references || []).forEach((r) => r && r.url && allRefs.set(r.url, r));
      lastResultRefs = [...allRefs.values()];
      return parseAnswer(raw, lastResultRefs);
    }

    function isResultStep(data) {
      return data.packages.length > 0 || data.stages.length > 0;
    }

    async function runDialog(msgs) {
      if (!client) client = K.getClient();
      if (mustReplay || dialogTurn > msgs.length) {
        client.reset();
        client = K.getClient();
        dialogTurn = 0;
        mustReplay = false;
      }

      let parsed;
      try {
        for (let i = dialogTurn; i < msgs.length; i++) {
          parsed = await fetchTurn(msgs[i], i === 0);
          dialogTurn = i + 1;
        }
        return parsed;
      } catch (err) {
        if (!/409|has ended/i.test(String(err.message))) throw err;
        client.reset();
        client = K.getClient();
        dialogTurn = 0;
        for (let i = 0; i < msgs.length; i++) {
          parsed = await fetchTurn(msgs[i], i === 0);
          dialogTurn = i + 1;
        }
        return parsed;
      }
    }

    async function send() {
      await loadGuideStart();
      if (!client) {
        questionEl.innerHTML = `<p>Connect Bonzai in the bar below to start.</p>`;
        return;
      }
      busy = true;
      setLoading(answers.length >= MAX_ANSWERS);
      try {
        const msgs = ["start", ...answers];
        let data = await runDialog(msgs);
        if (!isResultStep(data) && (answers.length >= MAX_ANSWERS || !data.options.length)) {
          setLoading(true);
          data = await fetchTurn(FINISH_MESSAGE, false);
          dialogTurn += 1;
          mustReplay = true;
        }
        if (!isResultStep(data) && !data.options.length) {
          questionEl.innerHTML = `<p>We couldn't build a recommendation this time.</p>`;
          optionsEl.innerHTML = "";
          restartBtn.hidden = false;
          return;
        }
        history.push(data);
        showStep(data);
      } catch (err) {
        questionEl.innerHTML = `<p>Something went wrong: ${K.escapeHtml(err.message)}</p>`;
        optionsEl.innerHTML = "";
      } finally {
        busy = false;
      }
    }

    function answer(label) {
      label = label.trim();
      if (busy || !guideReady || !label) return;
      answers.push(label);
      send();
    }

    function back() {
      if (busy || history.length < 2) return;
      history.pop();
      answers.pop();
      mustReplay = true;
      showStep(history[history.length - 1]);
    }

    async function loadGuideStart() {
      if (bootPromise) return bootPromise;
      bootPromise = (async () => {
        client = K.getClient();
        if (!client) {
          questionEl.innerHTML = `<p>Connect Bonzai in the bar below to start.</p>`;
          return;
        }
        if (!started) setLoading();
        try {
          client.reset();
          client = K.getClient();
          const data = await fetchTurn("start", true);
          dialogTurn = 1;
          history = [data];
          started = true;
          showStep(data);
        } catch (err) {
          if (!history.length) {
            questionEl.innerHTML = `<p>Something went wrong: ${K.escapeHtml(err.message)}</p>`;
            optionsEl.innerHTML = "";
          }
        } finally {
          guideReady = true;
        }
      })();
      return bootPromise;
    }

    function restart() {
      if (busy) return;
      if (client) client.reset();
      client = null;
      answers = [];
      history = [];
      dialogTurn = 0;
      mustReplay = false;
      started = false;
      bootPromise = null;
      guideReady = false;
      updateBar();
      loadGuideStart();
    }

    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".guide-option");
      if (btn) {
        const label = btn.dataset.answer || btn.querySelector("span")?.textContent || btn.textContent;
        answer(label);
      }
      if (e.target.closest(".guide-share-open") && lastResult) {
        shareText.value = guideShareBrief(lastResult);
        shareEl.hidden = false;
      }
    });
    shareEl.querySelector(".guide-share-close").addEventListener("click", () => {
      shareEl.hidden = true;
    });
    shareEl.addEventListener("click", (e) => {
      if (e.target === shareEl) shareEl.hidden = true;
    });
    shareEl.querySelector(".guide-share-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareText.value);
      } catch (_) {
        shareText.select();
        document.execCommand("copy");
      }
    });
    shareEl.querySelector(".guide-share-email").addEventListener("click", () => {
      const m = shareText.value.match(/^Subject:\s*(.+)\n\n/i);
      const subj = encodeURIComponent(m ? m[1].trim() : `Learning plan — ${topic}`);
      const body = encodeURIComponent(m ? shareText.value.slice(m[0].length) : shareText.value);
      window.location.href = `mailto:?subject=${subj}&body=${body}`;
    });
    backBtn.addEventListener("click", back);
    restartBtn.addEventListener("click", restart);
    updateBar();
    K.whenVisible(el, loadGuideStart);
    if (K.getClient()) loadGuideStart();
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
