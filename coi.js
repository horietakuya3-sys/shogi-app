// Service Worker を登録し、COOP/COEP ヘッダー付きで読み直す
// （GitHub Pages ではヘッダーを設定できないため。エンジンの SharedArrayBuffer に必要）
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (window.crossOriginIsolated) return;
    const reloadOnce = () => {
      if (sessionStorage.getItem('coiReloaded')) return;
      sessionStorage.setItem('coiReloaded', '1');
      location.reload();
    };
    if (navigator.serviceWorker.controller) {
      reloadOnce();
    } else {
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
    }
  }).catch((e) => console.error('SW登録失敗', e));
  if (window.crossOriginIsolated) sessionStorage.removeItem('coiReloaded');
})();
