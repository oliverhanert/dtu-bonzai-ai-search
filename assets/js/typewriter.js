/**
 * Typewriter placeholder: cycles example queries in an empty search field.
 * Usage: <input data-typewriter="first example|second example|…">
 * Stops while the field is focused or has a value, and is skipped for reduced motion.
 */
(function () {
  const TYPE_MS = 55;
  const ERASE_MS = 25;
  const HOLD_MS = 1800;

  function run(input) {
    const examples = input.dataset.typewriter.split("|").map((s) => s.trim()).filter(Boolean);
    if (!examples.length) return;
    const fallback = input.placeholder;
    let i = 0;
    let pos = 0;
    let erasing = false;
    let timer = null;

    const idle = () => document.activeElement !== input && !input.value;

    function tick() {
      if (!idle()) {
        input.placeholder = fallback;
        timer = null;
        return;
      }
      const text = examples[i];
      pos += erasing ? -1 : 1;
      input.placeholder = text.slice(0, pos);
      let delay = erasing ? ERASE_MS : TYPE_MS;
      if (!erasing && pos >= text.length) {
        erasing = true;
        delay = HOLD_MS;
      } else if (erasing && pos <= 0) {
        erasing = false;
        i = (i + 1) % examples.length;
        delay = 400;
      }
      timer = setTimeout(tick, delay);
    }

    const start = () => {
      if (timer || !idle()) return;
      pos = 0;
      erasing = false;
      timer = setTimeout(tick, 600);
    };

    input.addEventListener("blur", start);
    input.addEventListener("input", () => {
      if (!input.value) start();
    });
    start();
  }

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll("input[data-typewriter]").forEach(run);
})();
