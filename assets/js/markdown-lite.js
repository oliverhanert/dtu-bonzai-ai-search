/**
 * Minimal, safe markdown -> HTML renderer for Bonzai AI answers.
 */
function renderMarkdownLite(raw) {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return out;
  }

  const lines = raw.split("\n");
  const blocks = [];
  let currentList = null;
  let currentPara = [];

  function flushPara() {
    if (currentPara.length) {
      blocks.push(`<p>${inline(currentPara.join(" "))}</p>`);
      currentPara = [];
    }
  }
  function flushList() {
    if (currentList) {
      blocks.push(`<ul>${currentList.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      currentList = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    const bulletMatch = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.*)/);

    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }

    if (headingMatch) {
      flushPara();
      flushList();
      const level = headingMatch[1].length;
      const cls = level <= 2 ? "bonzai-answer-heading" : "bonzai-answer-subheading";
      const tag = level <= 2 ? "h3" : "h4";
      blocks.push(`<${tag} class="${cls}">${inline(headingMatch[2])}</${tag}>`);
      continue;
    }

    if (bulletMatch) {
      flushPara();
      if (!currentList) currentList = [];
      currentList.push(bulletMatch[1]);
      continue;
    }

    flushList();
    currentPara.push(trimmed);
  }
  flushPara();
  flushList();

  return blocks.join("");
}
