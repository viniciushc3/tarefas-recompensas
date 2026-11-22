// Service worker mínimo: guarda a casca do app para abrir sem internet.
//
// A página já funciona offline por conta própria (ela desenha do localStorage e
// enfileira as marcações). O que falta sem isto é o próprio HTML carregar quando
// o celular está sem rede — que é exatamente o caso de abrir o atalho da tela
// inicial no carro.
const CACHE = 'tarefas-v1';
const CASCA = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ns => Promise.all(ns.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Nunca interceptar a conversa com a planilha: isso tem de ir à rede sempre.
  if (req.method !== 'GET' || req.url.indexOf('script.google.com') >= 0) return;

  // Rede primeiro para o HTML, para pegar versão nova; cache como rede de segurança.
  e.respondWith(
    fetch(req)
      .then(r => {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))),
  );
});
