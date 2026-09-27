if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/my-dream/sw.js', { scope: '/my-dream/' }).catch(function () {});
  });
}
