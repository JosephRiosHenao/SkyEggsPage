// Tema claro / oscuro del panel (y del panel de métricas incrustado).
// Se carga en <head> sin defer para que no parpadee. Sin elección guardada sigue al sistema.
(() => {
  const KEY = "se-theme";
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const saved = () => { try { const v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : null; } catch { return null; } };
  const apply = () => {
    const t = saved() || (media && media.matches ? "dark" : "light");
    root.dataset.theme = t;
    root.style.colorScheme = t;
    document.dispatchEvent(new CustomEvent("se-theme", { detail: t }));
  };
  apply();
  if (media && media.addEventListener) media.addEventListener("change", () => { if (!saved()) apply(); });
  // Otra pestaña (o el panel que contiene este iframe) cambió el tema.
  window.addEventListener("storage", (e) => { if (e.key === KEY) apply(); });
  window.seTheme = {
    get: () => root.dataset.theme,
    set(t) { try { localStorage.setItem(KEY, t); } catch { /* sin almacenamiento: solo esta visita */ } root.dataset.theme = t; root.style.colorScheme = t; document.dispatchEvent(new CustomEvent("se-theme", { detail: t })); },
    toggle() { this.set(root.dataset.theme === "dark" ? "light" : "dark"); },
  };
})();
