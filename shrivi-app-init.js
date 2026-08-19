(() => {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/shrivi-sw.js', { scope: '/' })
      .then(reg => console.log('SHRIVI app ready', reg.scope))
      .catch(err => console.warn('SHRIVI app setup skipped', err));
  });
})();
