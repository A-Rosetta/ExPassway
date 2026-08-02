(function () {
  var theme = "";
  try {
    theme = localStorage.getItem("app-theme") || "";
  } catch (_error) {
    theme = "";
  }
  if (theme !== "light" && theme !== "dark") {
    theme = "dark";
  }
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  document.documentElement.style.colorScheme = theme;
}());
