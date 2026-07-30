(function () {
  const STORAGE_KEY = "app-theme";
  const DARK = "dark";
  const LIGHT = "light";
  const root = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");
  const menuToggle = document.getElementById("homeMenuToggle");
  const navigation = document.getElementById("homeNav");
  const desktopQuery = window.matchMedia("(min-width: 768px)");
  const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function readStoredTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === DARK || stored === LIGHT ? stored : "";
    } catch (_error) {
      return "";
    }
  }

  function translate(key, fallback) {
    return window.ALevelI18n?.t?.(key) || fallback;
  }

  function currentTheme() {
    return root.getAttribute("data-theme") === DARK ? DARK : LIGHT;
  }

  function updateThemeLabel() {
    if (!themeToggle) return;
    const dark = currentTheme() === DARK;
    const label = dark
      ? translate("homeThemeToLight", "Switch to light mode")
      : translate("homeThemeToDark", "Switch to dark mode");
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  }

  function applyTheme(theme) {
    if (theme === DARK) root.setAttribute("data-theme", DARK);
    else root.removeAttribute("data-theme");
    root.style.colorScheme = theme;
    updateThemeLabel();
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_error) {
      // Theme switching remains available when storage is restricted.
    }
  }

  function menuIsOpen() {
    return menuToggle?.getAttribute("aria-expanded") === "true";
  }

  function setMenu(open, restoreFocus) {
    if (!menuToggle || !navigation) return;
    const expanded = Boolean(open && !desktopQuery.matches);
    navigation.classList.toggle("is-open", expanded);
    menuToggle.classList.toggle("is-open", expanded);
    menuToggle.setAttribute("aria-expanded", String(expanded));
    const label = expanded
      ? translate("homeMenuClose", "Close home menu")
      : translate("homeMenuOpen", "Open home menu");
    menuToggle.setAttribute("aria-label", label);
    menuToggle.title = label;
    if (!expanded && restoreFocus) menuToggle.focus();
  }

  themeToggle?.addEventListener("click", () => {
    const next = currentTheme() === DARK ? LIGHT : DARK;
    storeTheme(next);
    applyTheme(next);
  });

  menuToggle?.addEventListener("click", () => setMenu(!menuIsOpen(), false));
  navigation?.addEventListener("click", (event) => {
    if (event.target.closest("button, a")) setMenu(false, false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuIsOpen()) setMenu(false, true);
  });

  desktopQuery.addEventListener("change", () => setMenu(false, false));
  systemThemeQuery.addEventListener("change", (event) => {
    if (!readStoredTheme()) applyTheme(event.matches ? DARK : LIGHT);
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      const next = event.newValue === DARK || event.newValue === LIGHT
        ? event.newValue
        : (systemThemeQuery.matches ? DARK : LIGHT);
      applyTheme(next);
    }
  });
  window.addEventListener("alevel:languagechange", () => {
    updateThemeLabel();
    setMenu(menuIsOpen(), false);
  });

  applyTheme(readStoredTheme() || (systemThemeQuery.matches ? DARK : LIGHT));
  setMenu(false, false);
})();
