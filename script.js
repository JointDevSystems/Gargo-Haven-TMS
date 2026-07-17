
  if (isIOSDevice()) {
    openModal('Install Gargo', `
      <div style="font-size:13px;line-height:1.7;color:var(--text-2)">
        <p style="margin-bottom:10px">Add Gargo to your Home Screen for one-tap, full-screen access:</p>
        <ol style="padding-left:18px;margin:0">
          <li>Tap the <strong>Share</strong> icon in Safari's toolbar.</li>
          <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong> in the top-right corner.</li>
        </ol>
      </div>
    `);
    return;
  }

  openModal('Install Gargo', `
    <div style="font-size:13px;line-height:1.7;color:var(--text-2)">
      Your browser didn't offer an install prompt yet — this can happen if the app is already installed,
      or if your browser doesn't support installing web apps. Look for an install icon in the address bar,
      or check your browser's menu for an "Install app" / "Add to Home Screen" option.
    </div>
  `);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

initInstallApp();

// ============================================================
//  HARD REFRESH
// ============================================================

async function hardRefreshSystem() {
  const btn = document.getElementById('refreshAppBtn');
  const icon = document.getElementById('refreshIcon');
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('spinning');
  toast('Refreshing system…', 'info', 4000);

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.warn('Could not clear cache/service worker during refresh:', e);
  }

  const url = new URL(window.location.href);
  url.searchParams.set('_refresh', Date.now());
  window.location.replace(url.toString());
}

// ============================================================
//  INITIALIZATION
// ============================================================

(function init() {
  try {
    runLoader();
  } catch(e) {
    console.error('Initialization error:', e);
    toast('System initialization error. Please refresh.', 'error');
  }
})();
