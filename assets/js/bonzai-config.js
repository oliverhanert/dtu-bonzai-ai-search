/**
 * Demo-only credential bar. Stores the Bonzai tenant key + agentId in
 * localStorage (per-browser, never committed to the repo) so the hosted
 * GitHub Pages demo can be pointed at a real Bonzai tenant without
 * exposing the key in source. For production this would live server-side.
 */
window.BonzaiConfig = (function () {
  const STORAGE_KEY = "bonzai-demo-config";

  function get() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function set(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function renderBar() {
    const bar = document.createElement("div");
    bar.className = "bonzai-config-bar";
    const cfg = get() || {};
    bar.innerHTML = `
      <strong>Bonzai AI Search demo config:</strong>
      <label>Tenant key <input type="text" id="bonzai-cfg-key" placeholder="X-API-Key" value="${cfg.apiKey || ""}" /></label>
      <label>Agent ID <input type="text" id="bonzai-cfg-agent" placeholder="agentId (uuid)" value="${cfg.agentId || ""}" /></label>
      <button id="bonzai-cfg-save">Save &amp; connect</button>
      <span class="status" id="bonzai-cfg-status"></span>
    `;
    document.body.appendChild(bar);

    const status = bar.querySelector("#bonzai-cfg-status");
    function updateStatus() {
      const c = get();
      if (c && c.apiKey && c.agentId) {
        status.textContent = "Connected to Bonzai";
        status.className = "status ok";
      } else {
        status.textContent = "Not connected — demo answers are simulated";
        status.className = "status err";
      }
    }
    updateStatus();

    bar.querySelector("#bonzai-cfg-save").addEventListener("click", () => {
      const apiKey = bar.querySelector("#bonzai-cfg-key").value.trim();
      const agentId = bar.querySelector("#bonzai-cfg-agent").value.trim();
      set({ apiKey, agentId });
      document.querySelectorAll("[data-bonzai-widget]").forEach((el) => {
        el._client = null;
      });
      updateStatus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderBar);
  } else {
    renderBar();
  }

  return { get, set, clear };
})();
