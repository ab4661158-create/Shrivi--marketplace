(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      await registration.update().catch(() => {});
      console.log('[SHRIVI] PWA service worker ready');
    } catch (error) {
      console.warn('[SHRIVI] PWA registration failed', error);
    }
  });
})();
