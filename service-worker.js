const CACHE_NAME = "shrivi-v6";

const APP_FILES = [
  "/shop",
  "/app",
  "/manifest.json?v=6",
  "/resources/icon.png?v=6",
  "/shrivi-logo.svg?v=3"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then(async response => {
        if (!response || !response.ok) return response;

        if (url.origin === self.location.origin && url.pathname === "/shop") {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("text/html")) {
            let html = await response.text();
            html = html.replace(/<button[^>]*onclick=["']location\.href=['"]\/seller['"][^>]*>[\s\S]*?<\/button>/i, "");
            html = html.replace(/<button[^>]*onclick=["'][^"']*\/seller[^"']*["'][^>]*>[\s\S]*?<\/button>/i, "");
            return new Response(html, {status: response.status, statusText: response.statusText, headers: response.headers});
          }
        }

        if (url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
