/**
 * Shared helpers for the Bonzai guide variants: parsing the tagged blocks the
 * agent appends to its answers ([options], [path], [route], ...) and
 * resolving course links against the cited references.
 */
window.GuideKit = (function () {
  const ARROW = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  const BACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>`;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
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
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim())
      .filter(Boolean);
    return { rest: raw.slice(0, match.index) + raw.slice(match.index + match[0].length), lines };
  }

  function takeAll(raw, name) {
    const blocks = [];
    let rest = raw;
    for (;;) {
      const block = takeBlock(rest, name);
      if (block.rest === rest) break;
      rest = block.rest;
      if (block.lines.length) blocks.push(block.lines);
    }
    return { rest, blocks };
  }

  function cleanText(rest) {
    return rest.replace(/[\s\\[]+$/, "").trim();
  }

  /** Drop messy agent qualifiers; prefer computed fallback. */
  function cleanStat(value, fallback) {
    const v = String(value || "").trim();
    const fb = fallback == null ? "" : String(fallback).trim();
    if (!v) return fb;
    if (/[()]|\bor\b|±|;\s*/i.test(v) || (v.length > 28 && fb)) return fb || v.replace(/\s*\(.*/, "").trim();
    return v;
  }

  function pathFacts(stages, pkg) {
    const courses = stages.flatMap((s) => s.items);
    const n = courses.length;
    const ectsSum =
      courses.length && courses.every((c) => c.ects != null) ? courses.reduce((s, c) => s + c.ects, 0) : null;
    return [
      ["Courses", cleanStat(pkg.courses, String(n))],
      ["ECTS", cleanStat(pkg.ects, ectsSum != null ? String(ectsSum) : "")],
      ["Duration", cleanStat(pkg.duration, "")],
      ["Format", cleanStat(pkg.format, "")],
    ].filter(([, val]) => val);
  }

  function courseRowsHtml(courses, thumbCls) {
    thumbCls = thumbCls || "pkg-thumb";
    return courses
      .map(
        (c) => `
        <li>
          <a class="pkg-course" href="${escapeHtml(c.url || "#")}" target="_blank" rel="noopener">
            ${thumb(c, thumbCls)}
            <span><strong>${escapeHtml(c.title)}</strong>${c.meta.length ? `<small>${escapeHtml(c.meta.join(" · "))}</small>` : ""}</span>
            ${ARROW}
          </a>
        </li>`
      )
      .join("");
  }

  function packageCardHtml(opts) {
    const facts = (opts.facts || [])
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join("");
    const stages = opts.stages || [];
    let list = "";
    if (stages.length) {
      list = stages
        .map((s, si) => {
          const entry =
            s.entry && !/start\s*here/i.test(s.name)
              ? `<span class="pkg-stage-flag">You start here</span>`
              : "";
          const rows = courseRowsHtml(s.items, opts.thumbCls);
          return `
            <div class="pkg-stage">
              <p class="pkg-stage-title"><span class="pkg-stage-num">${si + 1}</span>${escapeHtml(s.name)}${entry}</p>
              <ol class="pkg-courses">${rows}</ol>
            </div>`;
        })
        .join("");
      list = `<div class="pkg-stages">${list}</div>`;
    } else {
      list = `<ol class="pkg-courses">${courseRowsHtml(opts.courses || [], opts.thumbCls)}</ol>`;
    }
    const contactHtml = contactBlock(opts.contact);
    return `
      <article class="pkg-card${opts.best ? " is-best" : ""}">
        ${opts.best ? `<p class="pkg-badge">${escapeHtml(opts.badge || "Recommended for you")}</p>` : ""}
        <h4 class="pkg-name">${escapeHtml(opts.name || "")}</h4>
        ${opts.fits ? `<p class="pkg-fits">${escapeHtml(opts.fits)}</p>` : ""}
        ${facts ? `<dl class="pkg-facts">${facts}</dl>` : ""}
        <p class="pkg-list-label">What's included</p>
        ${list}
        ${contactHtml}
      </article>`;
  }

  function contactBlock(contact, label) {
    label = label || "Questions?";
    if (!contact || (!contact.name && !contact.email)) return "";
    return `<footer class="pkg-contact">
            <p class="pkg-contact-label">${escapeHtml(label)}</p>
            <p><strong>${escapeHtml(contact.name || "")}</strong>${contact.title ? ` · ${escapeHtml(contact.title)}` : ""}</p>
            <a href="${escapeHtml(contact.link || (contact.email ? `mailto:${contact.email}` : "#"))}">${escapeHtml(contact.email || "Contact DTU Learn for Life")}</a>
          </footer>`;
  }

  /** Prose before [route]/[path]/… — never show tagged pipeline text in the UI. */
  function guideIntro(raw) {
    const cut = raw.search(/[\\[\s]*\[\s*(?:route|path|package|contact|options)\s*\\?\]/i);
    const head = cut >= 0 ? raw.slice(0, cut) : raw;
    const intro = briefText(cleanText(head), 300);
    if (!intro) return "";
    if (/^\[/.test(intro) || /\[\s*path\s*\]/i.test(intro)) return "";
    if (intro.includes("|") && (/\bECTS\b/i.test(intro) || /\bentry\b/i.test(intro))) return "";
    return intro;
  }

  /** First 1–2 sentences, capped — for intros the agent over-writes. */
  function briefText(text, maxLen) {
    maxLen = maxLen || 220;
    const plain = (text || "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) return "";
    const parts = plain.match(/[^.!?]+[.!?]+/g);
    let out = parts && parts.length ? parts.slice(0, 2).join(" ").trim() : plain;
    if (out.length > maxLen) out = out.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
    return out;
  }

  function rolesFromLines(lines) {
    const roles = [];
    let cur = null;
    for (const line of lines) {
      const nm = line.match(/^Name:\s*(.+)/i);
      const ab = line.match(/^About:\s*(.+)/i);
      if (nm) {
        if (cur && cur.name) roles.push(cur);
        cur = { name: nm[1].trim(), about: "" };
      } else if (ab && cur) cur.about = ab[1].trim();
    }
    if (cur && cur.name) roles.push(cur);
    if (roles.length) return roles;
    const f = fields(lines);
    return f.name ? [{ name: f.name, about: f.about || "" }] : [];
  }

  function parseRoles(raw) {
    const all = takeAll(raw, "role");
    let roles = all.blocks.flatMap(rolesFromLines);
    if (roles.length < 2) {
      for (const line of raw.split("\n")) {
        const nm = line.match(/^Name:\s*(.+)/i);
        if (!nm) continue;
        const name = nm[1].trim();
        if (!roles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
          roles.push({ name, about: "" });
        }
      }
    }
    return roles.filter((r) => r.name);
  }

  function parseRoutes(raw, refs) {
    const all = takeAll(raw, "route");
    const packages = all.blocks
      .map((lines) => {
        const f = fields(lines);
        const courses = f.items.filter((l) => /\]\(/.test(l)).map((l) => courseWithMeta(l, refs));
        const ects =
          courses.length && courses.every((c) => c.ects != null) ? courses.reduce((s, c) => s + c.ects, 0) : null;
        return {
          name: f.name || "",
          fits: f.for || f.fits || "",
          best: /best|recommend/i.test(String(f.match || f.recommended || "")),
          facts: [
            ["Courses", cleanStat(f.courses, String(courses.length))],
            ["ECTS", cleanStat(f.ects, ects != null ? String(ects) : "")],
            ["Duration", cleanStat(f.duration, "")],
            ["Format", cleanStat(f.format, "")],
          ].filter(([, v]) => v),
          courses,
        };
      })
      .filter((p) => p.name && p.courses.length);
    markBestPackage(packages);
    return { text: guideIntro(raw), packages, rest: all.rest };
  }

  /** When the agent skips [skills], infer rows from prose + references. */
  function inferSkills(raw, refs) {
    const skills = [];
    const seen = new Set();
    for (const line of raw.split("\n")) {
      const trimmed = line.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim();
      if (!/\]\(/.test(trimmed)) continue;
      const pipe = trimmed.indexOf("|");
      if (pipe > 0) {
        const skill = trimmed.slice(0, pipe).replace(/\*\*/g, "").trim();
        const course = courseWithMeta(trimmed.slice(pipe + 1), refs);
        const key = course.url || course.title;
        if (skill && key && !seen.has(key)) {
          seen.add(key);
          skills.push({ skill, course });
        }
        continue;
      }
      const md = trimmed.match(/^(.{2,70}?)\s*(?:[:\-–—]\s*)?(\[[^\]]+\]\([^)]+\).*)/);
      if (md) {
        const skill = md[1].replace(/\*\*/g, "").trim();
        const course = courseWithMeta(md[2], refs);
        const key = course.url || course.title;
        if (skill && key && !seen.has(key)) {
          seen.add(key);
          skills.push({ skill, course });
        }
      }
    }
    if (skills.length) return skills;
    for (const ref of refs || []) {
      const url = ref.url || "";
      if (!url || seen.has(url)) continue;
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`([^\\n]{3,80}?)\\s*\\[[^\\]]*\\]\\(${esc}\\)`, "i");
      const m = raw.match(re);
      let skill = m
        ? m[1].replace(/^[-*•\d.)\s]+/, "").replace(/\*\*/g, "").replace(/[:\-–—]\s*$/, "").trim()
        : cleanTitle(ref.title);
      if (skill.length > 55) skill = skill.slice(0, 52) + "…";
      seen.add(url);
      skills.push({
        skill,
        course: {
          title: cleanTitle(ref.title),
          url,
          image: ref.image,
          summary: ref.summary,
          meta: [],
          ects: null,
        },
      });
    }
    return skills;
  }

  function visibleWhileStreaming(raw) {
    const idx = raw.search(/[\\[\s]*\[\s*\/?\s*(?:options|path|package|route|question|role|skills)/i);
    return idx >= 0 ? raw.slice(0, idx) : raw;
  }

  function lastOptionsIndex(raw) {
    const re = /[\\[\s]*\[\s*options\s*\\?\]/gi;
    let last = -1;
    let m;
    while ((m = re.exec(raw)) !== null) last = m.index;
    return last;
  }

  /** Visible question for the active step (last [options] block in the reply). */
  function guideStepQuestion(raw) {
    const cut = lastOptionsIndex(raw);
    let head = cut >= 0 ? raw.slice(0, cut) : visibleWhileStreaming(raw);
    head = head.replace(/\[\s*\/?\s*options[^\]]*\]/gi, "").trim();
    const paras = head.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const withQ = paras.filter((p) => p.includes("?"));
    if (withQ.length) return cleanText(withQ[withQ.length - 1]);
    if (paras.length) return cleanText(paras[paras.length - 1]);
    return cleanText(head);
  }

  function guideStepOptions(raw) {
    const { blocks } = takeAll(raw, "options");
    return blocks.length ? blocks[blocks.length - 1] : [];
  }

  /** Agent can put [last] immediately before the final [options] block. */
  function isLastQuestionStep(raw) {
    const idx = lastOptionsIndex(raw);
    if (idx < 0) return false;
    const before = raw.slice(Math.max(0, idx - 160), idx);
    if (/\[\s*last\s*\]/i.test(before)) return true;
    const open = raw.slice(idx, idx + 48);
    return /\[\s*options[^\]]*\blast\b/i.test(open);
  }

  function markBestPackage(packages) {
    if (!packages.length) return packages;
    if (packages.some((p) => p.best)) return packages;
    if (packages.length === 1) {
      packages[0].best = true;
      return packages;
    }
    const hinted = packages.find((p) => /core|recommend|best\s*match/i.test(`${p.name} ${p.fits}`));
    (hinted || packages[Math.min(1, packages.length - 1)]).best = true;
    return packages;
  }

  function isBrokenGuideStep(data, raw) {
    raw = raw || "";
    if (!data || !data.options || !data.options.length) return false;
    if (/\[\s*\/?\s*options/i.test(data.text || "")) return true;
    if ((raw.match(/\[\\?\s*\/\s*options\s*\\?\]/gi) || []).length > 1) return true;
    if ((data.text.match(/\?/g) || []).length > 1) return true;
    return false;
  }

  // "Key: value" lines -> { key: value }; other lines are returned in `items`.
  function fields(lines) {
    const out = { items: [] };
    for (const line of lines) {
      const m = line.match(/^([A-Za-zÆØÅæøå ]{1,20})\s*:\s*(.+)$/);
      if (m && !/\]\(/.test(m[1])) out[m[1].trim().toLowerCase()] = m[2].trim();
      else out.items.push(line);
    }
    return out;
  }

  function resolveCourse(cell, refs) {
    refs = refs || [];
    const link = cell.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
    const label = link ? link[1] : cell.trim();
    const url = link ? link[2] : "";
    const lower = label.toLowerCase();
    const ref =
      refs.find((r) => url && normalizeUrl(r.url) === normalizeUrl(url)) ||
      refs.find((r) => cleanTitle(r.title).toLowerCase() === lower) ||
      refs.find((r) => cleanTitle(r.title).toLowerCase().startsWith(lower));
    return {
      title: ref ? cleanTitle(ref.title) : label,
      url: ref ? ref.url : url,
      image: ref && ref.image,
      summary: ref && ref.summary,
    };
  }

  // "[Course](url) | 5 ECTS | 13 weeks | Online" -> course with meta chips.
  function courseWithMeta(line, refs) {
    const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
    const course = resolveCourse(parts[0] || "", refs);
    course.meta = parts.slice(1).filter((p) => !/^entry$/i.test(p));
    course.ects = ectsOf(course.meta);
    return course;
  }

  function ectsOf(meta) {
    for (const m of meta || []) {
      const hit = m.match(/(\d+(?:[.,]\d+)?)\s*ECTS/i);
      if (hit) return parseFloat(hit[1].replace(",", "."));
    }
    return null;
  }

  function renderMarkdown(raw) {
    return typeof renderMarkdownLite === "function" ? renderMarkdownLite(raw) : `<p>${escapeHtml(raw)}</p>`;
  }

  function thumb(c, cls) {
    return `<div class="${cls || "guide-course-img"}${c.image ? "" : " placeholder"}">${c.image ? `<img src="${escapeHtml(c.image)}" alt="" loading="lazy" />` : ""}</div>`;
  }

  function metaChips(meta) {
    return meta && meta.length
      ? `<ul class="guide-meta">${meta.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`
      : "";
  }

  function getClient() {
    const cfg = window.BonzaiConfig ? window.BonzaiConfig.get() : null;
    if (!cfg || !cfg.apiKey || !cfg.agentId) return null;
    return new BonzaiClient(cfg);
  }

  function pageLanguage(el) {
    return (el.closest("[lang]") || document.documentElement).lang || "en";
  }

  function whenVisible(el, fn) {
    if (!("IntersectionObserver" in window)) return fn();
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        fn();
      }
    }, { rootMargin: "480px" });
    observer.observe(el);
  }

  // Streams one message; `onText` receives the visible (block-free) text so far.
  /** One-shot request (no streaming) — faster for short structured replies. */
  async function fetchOnce(client, message, context) {
    const event = await client.sendMessage(message, context);
    const raw = (event.response && event.response.answer) || "";
    return {
      raw,
      references: event.references || [],
      conversationId: event.conversationId || client.conversationId,
    };
  }

  /** Single request/response (no streaming) — lower overhead than NDJSON streaming. */
  async function stream(client, message, context, onText) {
    const { raw, references } = await fetchOnce(client, message, context);
    const visible = visibleWhileStreaming(raw).trim();
    if (onText && visible) onText(visible);
    return { raw, references };
  }

  return {
    ARROW, BACK, escapeHtml, cleanTitle, takeBlock, takeAll, cleanText, briefText,
    cleanStat, pathFacts, guideIntro, guideStepQuestion, guideStepOptions, isLastQuestionStep,
    isBrokenGuideStep, markBestPackage,
    contactBlock, packageCardHtml, parseRoutes, parseRoles, inferSkills,
    fields, resolveCourse,
    courseWithMeta, renderMarkdown, thumb, metaChips, getClient, pageLanguage,
    whenVisible, fetchOnce, stream,
  };
})();
