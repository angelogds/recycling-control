(function () {
  const KEY = "ui_theme";

  function iconMarkup(value) {
    if (value === "light") {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  function applyTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", value);
    try { localStorage.setItem(KEY, value); } catch (e) {}

    const label = value === "light" ? "🌙 Escuro" : "☀️ Claro";
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      if (btn.hasAttribute("data-theme-icon")) {
        btn.innerHTML = iconMarkup(value);
      } else {
        btn.textContent = label;
      }
      btn.setAttribute("aria-label", `Alternar tema (${label})`);
    });
  }

  function currentTheme() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) {}
    return "dark";
  }

  function setupToggle() {
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        applyTheme(next);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(currentTheme());
    setupToggle();
  });
})();
