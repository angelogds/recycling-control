(function () {
  const KEY = "ui_theme";

  function applyTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", value);
    try { localStorage.setItem(KEY, value); } catch (e) {}
    const label = value === "light" ? "☀️ Claro" : "🌙 Escuro";
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.textContent = label;
      btn.setAttribute("aria-label", `Tema atual: ${label}`);
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
