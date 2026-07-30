(function () {
  const STORAGE_KEY = "app-theme";
  const DARK = "dark";
  const LIGHT = "light";
  const root = document.documentElement;
  let themeToggle = document.getElementById("themeToggle");
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

  function themeControlMarkup() {
    return `
      <button id="themeToggle" class="site-header-control home-header-control home-theme-toggle" type="button">
        <svg class="home-theme-icon home-theme-icon--sun" aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="5"></circle>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
        </svg>
        <svg class="home-theme-icon home-theme-icon--moon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </button>`;
  }

  function ensureControlHost() {
    const existing = document.querySelector(
      ".home-header-controls, .site-header-controls, .community-topbar__actions"
    );
    if (existing) return existing;
    const header = document.createElement("header");
    const homePath = location.pathname.includes("/pages/") ? "../index.html" : "index.html";
    header.className = "site-topbar";
    header.innerHTML = `
      <div class="site-topbar__inner">
        <a class="home-brand" href="${homePath}" aria-label="ExPassway">
          <span class="home-brand__mark" aria-hidden="true">E</span>
          <span data-i18n="homeBrand">ExPassway</span>
        </a>
        <div class="site-header-controls">${themeControlMarkup()}</div>
      </div>`;
    document.body.prepend(header);
    return header.querySelector(".site-header-controls");
  }

  function moveHomeCommand(controlHost) {
    const homeCommand = document.querySelector(
      "#goHomeFromPickerBtn, #backHome, #communityBackHome"
    );
    if (!homeCommand || !controlHost) return;
    homeCommand.classList.remove("mode-btn-primary", "btn-link", "community-rail-home");
    homeCommand.classList.add("btn-secondary", "site-header-command");
    const label = homeCommand.textContent.trim();
    if (label) homeCommand.title = label;
    controlHost.prepend(homeCommand);
  }

  function initializeControls() {
    const controlHost = ensureControlHost();
    moveHomeCommand(controlHost);
    themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) {
      controlHost.insertAdjacentHTML("beforeend", themeControlMarkup());
      themeToggle = document.getElementById("themeToggle");
    }
    const languageToggle = document.querySelector("[data-language-toggle]");
    if (languageToggle && controlHost) {
      languageToggle.classList.add("site-header-control");
      controlHost.appendChild(languageToggle);
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
    updateThemeLabel();
    setMenu(false, false);
  }

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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.setTimeout(initializeControls, 0));
  } else {
    window.setTimeout(initializeControls, 0);
  }
})();
