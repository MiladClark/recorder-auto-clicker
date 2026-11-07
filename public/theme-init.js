// Apply the saved palette before styles paint, including floating windows.
(() => {
  let theme;
  try { theme = localStorage.getItem('framecue.theme.v1'); } catch { /* Optional storage. */ }
  if (theme !== 'dark' && theme !== 'light' && theme !== 'colorful') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const scheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', scheme === 'dark');
  document.documentElement.style.colorScheme = scheme;
})();
