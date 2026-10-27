/**
 * Career explorer (mode "career"): roles → course plan with checkboxes and contact.
 */
(function () {
  const K = window.GuideKit;
  const CACHE_MS = 30 * 60 * 1000;

  function parseRoleDetail(raw, refs) {
    const introCut = raw.search(/[\\[\s]*\[\s*skills\s*\\?\]/i);
    const intro = introCut >= 0 ? K.cleanText(raw.slice(0, introCut)) : "";
    const skillsBlock = K.takeBlock(raw, "skills");
    const contact = K.takeBlock(skillsBlock.rest, "contact");
    const pitch = K.takeBlock(contact.rest, "pitch");
    let skills = skillsBlock.lines
      .map((line) => {
        const cut = line.indexOf("|");
        if (cut < 0) return null;
        return { skill: line.slice(0, cut).trim(), course: K.courseWithMeta(line.slice(cut + 1), refs) };
      })
      .filter((s) => s && s.skill);
    if (!skills.length) skills = K.inferSkills(raw, refs);
    return {
      text: K.briefText(intro || K.cleanText(pitch.rest), 280),
      skills,
      contact: K.fields(contact.lines),
      pitch: pitch.lines.filter(Boolean),
    };
  }

  function coursesFromSkills(skills) {
    const map = new Map();
    skills.forEach((s) => {
      const key = s.course.url || s.course.title;
      if (!map.has(key)) map.set(key, { key, course: s.course, skills: [] });
      map.get(key).skills.push(s.skill);
    });
    return [...map.values()];
  }

  function rolesCacheKey(context) {
    const cfg = window.BonzaiConfig ? window.BonzaiConfig.get() : null;
    return `lfl-career-roles:${cfg && cfg.agentId}:${context.topic}:${context.language}`;
  }

  function readRolesCache(key) {
    try {
      const hit = JSON.parse(sessionStorage.getItem(key));
      if (hit && Date.now() - hit.t < CACHE_MS && Array.isArray(hit.roles)) return hit.roles;
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function writeRolesCache(key, roles) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), roles }));
    } catch (_) {
      /* ignore */
    }
  }

  function roleDetailCacheKey(context, roleName) {
    const cfg = window.BonzaiConfig ? BonzaiConfig.get() : null;
    return `lfl-career-detail:${cfg && cfg.agentId}:${context.topic}:${context.language}:${roleName}`;
  }

  function readRoleDetailCache(key) {
    try {
      const hit = JSON.parse(sessionStorage.getItem(key));
      if (hit && Date.now() - hit.t < CACHE_MS && hit.raw) return hit;
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function writeRoleDetailCache(key, payload) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ ...payload, t: Date.now() }));
    } catch (_) {
      /* ignore */
    }
  }

  function planStats(courses, knownKeys) {
    const todo = courses.filter((c) => !knownKeys.has(c.key));
    const ects =
      todo.length && todo.every((e) => e.course.ects != null) ? todo.reduce((s, e) => s + e.course.ects, 0) : null;
    return { todo, done: courses.filter((c) => knownKeys.has(c.key)), ects };
  }

  function managerBrief(role, topic, data, courses, knownKeys) {
    const { todo, ects } = planStats(courses, knownKeys);
    const bullets =
      data.pitch && data.pitch.length
        ? data.pitch
        : [
            `Supports development toward a ${role.name} profile within ${topic}.`,
            todo.length
              ? `Proposed next step: ${todo.length} DTU Learn for Life course${todo.length === 1 ? "" : "s"}${ects != null ? ` (${ects} ECTS)` : ""}.`
              : "Core course requirements for this role appear to be met.",
            "Part-time and online formats are available on many courses — suitable alongside current work.",
          ];
    const lines = todo.map((c) => {
      const meta = c.course.meta.length ? ` (${c.course.meta.join(", ")})` : "";
      return `• ${c.course.title}${meta}${c.course.url ? `\n  ${c.course.url}` : ""}`;
    });
    return (
      `Subject: Professional development — ${role.name}\n\n` +
      `Hi,\n\n` +
      `I would like to discuss a short professional development plan related to ${topic}. ` +
      `Below is a draft based on DTU Learn for Life courses.\n\n` +
      `Role target: ${role.name}\n` +
      `${data.text ? `\n${data.text}\n` : ""}` +
      `\nWhy this makes sense:\n${bullets.map((b) => `• ${b.replace(/^[-*•]\s*/, "")}`).join("\n")}\n` +
      (lines.length ? `\nSuggested courses:\n${lines.join("\n")}\n` : "") +
      `\nHappy to align on timing and budget.\n\nBest regards`
    );
  }

  function initCareer(el) {
    const topic = el.dataset.guideTopic || "DTU Learn for Life";
    const title = el.dataset.guideTitle || "Where do you want to go?";
    const lead = el.dataset.guideLead || "";
    const context = { mode: "career", topic, pageType: "topic", language: K.pageLanguage(el) };
    const cacheKey = rolesCacheKey(context);

    el.classList.add("car");
    el.innerHTML = `
      <div class="car-inner">
        <header class="car-head">
          <h2 class="car-title">${K.escapeHtml(title)}</h2>
          ${lead ? `<p class="car-lead">${K.escapeHtml(lead)}</p>` : ""}
        </header>
        <div class="car-view" aria-live="polite"></div>
      </div>
      <div class="car-share" hidden>
        <div class="car-share-dialog" role="dialog" aria-labelledby="car-share-title">
          <header>
            <h4 id="car-share-title">Share your plan</h4>
            <button type="button" class="car-share-close" aria-label="Close">×</button>
          </header>
          <p class="car-hint">A formal draft for whoever approves your professional development. Edit as needed, then copy or open in your email client.</p>
          <textarea class="car-share-text" rows="14"></textarea>
          <div class="car-share-actions">
            <button type="button" class="btn btn-sm btn-primary car-share-copy">Copy text</button>
            <button type="button" class="btn btn-sm car-share-email">Open in email</button>
          </div>
        </div>
      </div>
    `;
    const view = el.querySelector(".car-view");
    const shareEl = el.querySelector(".car-share");
    const shareText = el.querySelector(".car-share-text");

    let roles = [];
    let busy = false;
    let knownKeys = new Set();
    let current = null;
    let rolePrefetching = false;

    async function prefetchRoleDetails() {
      if (rolePrefetching || !roles.length) return;
      const cfgClient = K.getClient();
      if (!cfgClient) return;
      rolePrefetching = true;
      for (const role of roles) {
        const detailKey = roleDetailCacheKey(context, role.name);
        if (readRoleDetailCache(detailKey)) continue;
        try {
          const c = K.getClient();
          if (!c) break;
          c.reset();
          const res = await K.fetchOnce(c, role.name, context);
          writeRoleDetailCache(detailKey, { raw: res.raw, references: res.references });
        } catch (_) {
          /* skip failed prefetch */
        }
      }
      rolePrefetching = false;
    }

    function showRoles() {
      el.classList.remove("has-role");
      current = null;
      knownKeys = new Set();
      const few = roles.length < 3;
      view.innerHTML = `
        <p class="car-step"><span>1</span>Choose the role you're aiming for</p>
        ${few ? `<p class="car-hint car-hint--warn">Only ${roles.length} role${roles.length === 1 ? "" : "s"} returned — ask Bonzai for 4–6 separate [role] blocks on "start".</p>` : ""}
        <div class="car-roles">
          ${roles
            .map((r, i) => `
              <button type="button" class="car-role" data-role="${i}" style="--i:${i}">
                <span class="car-role-name">${K.escapeHtml(r.name)}</span>
                ${r.about ? `<span class="car-role-about">${K.escapeHtml(r.about)}</span>` : ""}
                <span class="car-role-go">Build your plan ${K.ARROW}</span>
              </button>`)
            .join("")}
        </div>`;
    }

    function showLoadingRoles() {
      view.innerHTML = `
        <p class="car-step"><span>1</span>Choose the role you're aiming for</p>
        <div class="car-roles car-roles--loading">${'<span class="guide-skel car-skel"></span>'.repeat(6)}</div>`;
    }

    function renderPlan(planEl, courses) {
      const { todo, done, ects } = planStats(courses, knownKeys);
      const row = (e, i, isDone) => `
        <li class="car-plan-item${isDone ? " is-done" : ""}" style="--i:${i}">
          <button type="button" class="car-plan-check${knownKeys.has(e.key) ? " is-on" : ""}" data-key="${K.escapeHtml(e.key)}" aria-pressed="${knownKeys.has(e.key)}" aria-label="Already completed"></button>
          <a class="car-plan-link" href="${K.escapeHtml(e.course.url || "#")}" target="_blank" rel="noopener">
            ${K.thumb(e.course, "car-thumb")}
            <span class="car-plan-body">
              <strong>${K.escapeHtml(e.course.title)}</strong>
              <small>Builds: ${K.escapeHtml(e.skills.join(", "))}</small>
              ${K.metaChips(e.course.meta)}
            </span>
            ${K.ARROW}
          </a>
        </li>`;

      planEl.innerHTML = `
        <div class="car-plan-card">
          <div class="car-total">
            <strong>${todo.length}</strong> ${todo.length === 1 ? "course" : "courses"}${ects != null && todo.length ? ` · <strong>${ects}</strong> ECTS` : ""}
            <span>${todo.length ? "left for this role" : "— you're covered for this role"}</span>
          </div>
          <p class="car-hint car-hint--inline">Tick courses you've already taken.</p>
          <ol class="car-plan">${todo.map((e, i) => row(e, i, false)).join("")}</ol>
          ${done.length ? `<p class="car-done-label">Already completed</p><ol class="car-plan car-plan--done">${done.map((e, i) => row(e, i, true)).join("")}</ol>` : ""}
        </div>`;
    }

    function renderShareAside(courses) {
      const { todo } = planStats(courses, knownKeys);
      return `
        <aside class="car-aside car-aside--actions">
          <p class="car-aside-label">Share your plan</p>
          <p class="car-aside-intro">If study time or funding must be approved internally, prepare a concise email for your approver.</p>
          <button type="button" class="btn btn-sm btn-primary car-share-open" ${todo.length ? "" : "disabled"}>Email for approver</button>
          <button type="button" class="btn btn-sm car-print-btn">Print plan</button>
          <p class="car-aside-note">For line managers, HR, or others who allocate professional development budget.</p>
        </aside>`;
    }

    function bindPlan(planEl, courses) {
      planEl.onclick = (e) => {
        const check = e.target.closest(".car-plan-check");
        if (!check) return;
        e.preventDefault();
        const key = check.dataset.key;
        if (knownKeys.has(key)) knownKeys.delete(key);
        else knownKeys.add(key);
        renderPlan(planEl, courses);
        const aside = view.querySelector(".car-aside--actions");
        if (aside && current) aside.outerHTML = renderShareAside(courses);
      };
    }

    function openShare() {
      if (!current) return;
      shareText.value = managerBrief(current.role, topic, current.data, current.courses, knownKeys);
      shareEl.hidden = false;
    }

    function showRole(role, data) {
      el.classList.add("has-role");
      const courses = data ? coursesFromSkills(data.skills) : [];
      current = data ? { role, data, courses } : null;
      view.innerHTML = `
        <button type="button" class="car-backlink">${K.BACK}<span>All roles</span></button>
        <div class="car-detail">
          <div class="car-detail-main">
            <div class="car-role-head">
              <h3>${K.escapeHtml(role.name)}</h3>
              <div class="car-role-text">${data ? `<p>${K.escapeHtml(data.text)}</p>` : '<span class="guide-skel guide-skel--line"></span>'}</div>
              ${data ? K.contactBlock(data.contact) : ""}
            </div>
            <section class="car-plan-section">
              <p class="car-step"><span>2</span>Your course plan</p>
              <div class="car-planwrap">${data ? "" : '<span class="guide-skel car-skel"></span>'.repeat(3)}</div>
            </section>
          </div>
          ${data && courses.length ? renderShareAside(courses) : ""}
        </div>`;
      if (!data) return;
      const planEl = view.querySelector(".car-planwrap");
      if (!courses.length) {
        planEl.innerHTML = `<p class="car-hint">No courses were linked to this role.</p>`;
        return;
      }
      renderPlan(planEl, courses);
      bindPlan(planEl, courses);
    }

    async function openRole(role) {
      const client = K.getClient();
      if (!client || busy) return;
      busy = true;
      knownKeys = new Set();
      showRole(role, null);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      try {
        const detailKey = roleDetailCacheKey(context, role.name);
        const cached = readRoleDetailCache(detailKey);
        let raw;
        let references;
        if (cached) {
          raw = cached.raw;
          references = cached.references || [];
        } else {
          client.reset();
          const res = await K.fetchOnce(client, role.name, context);
          raw = res.raw;
          references = res.references;
          writeRoleDetailCache(detailKey, { raw, references });
        }
        showRole(role, parseRoleDetail(raw, references));
      } catch (err) {
        view.querySelector(".car-role-text").innerHTML = `<p>Something went wrong: ${K.escapeHtml(err.message)}</p>`;
      } finally {
        busy = false;
      }
    }

    let rolesBoot = null;

    async function loadRoles() {
      if (rolesBoot) return rolesBoot;
      rolesBoot = loadRolesOnce();
      return rolesBoot;
    }

    async function loadRolesOnce() {
      const client = K.getClient();
      if (!client) {
        view.innerHTML = `<p class="car-hint">Connect Bonzai in the bar below to start.</p>`;
        rolesBoot = null;
        return;
      }
      const cached = readRolesCache(cacheKey);
      if (cached) {
        roles = cached;
        showRoles();
        prefetchRoleDetails();
        return;
      }
      showLoadingRoles();
      try {
        client.reset();
        const { raw } = await K.fetchOnce(client, "start", context);
        roles = K.parseRoles(raw);
        writeRolesCache(cacheKey, roles);
        showRoles();
        prefetchRoleDetails();
      } catch (err) {
        view.innerHTML = `<p class="car-hint">Something went wrong: ${K.escapeHtml(err.message)}</p>`;
        rolesBoot = null;
      }
    }

    view.addEventListener("click", (e) => {
      const tile = e.target.closest(".car-role");
      if (tile) return openRole(roles[Number(tile.dataset.role)]);
      if (e.target.closest(".car-backlink") && !busy) showRoles();
      if (e.target.closest(".car-share-open")) openShare();
      if (e.target.closest(".car-print-btn")) {
        e.preventDefault();
        document.body.classList.add("print-career-plan");
        window.print();
      }
    });
    window.addEventListener("afterprint", () => document.body.classList.remove("print-career-plan"));

    shareEl.querySelector(".car-share-close").addEventListener("click", () => {
      shareEl.hidden = true;
    });
    shareEl.addEventListener("click", (e) => {
      if (e.target === shareEl) shareEl.hidden = true;
    });
    shareEl.querySelector(".car-share-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareText.value);
      } catch (_) {
        shareText.select();
        document.execCommand("copy");
      }
    });
    shareEl.querySelector(".car-share-email").addEventListener("click", () => {
      const m = shareText.value.match(/^Subject:\s*(.+)\n\n/i);
      const subj = encodeURIComponent(m ? m[1].trim() : `Professional development — ${current ? current.role.name : topic}`);
      const body = encodeURIComponent(m ? shareText.value.slice(m[0].length) : shareText.value);
      window.location.href = `mailto:?subject=${subj}&body=${body}`;
    });

    K.whenVisible(el, loadRoles);
    if (K.getClient()) loadRoles();
  }

  function init() {
    document.querySelectorAll("[data-bonzai-career]").forEach(initCareer);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
