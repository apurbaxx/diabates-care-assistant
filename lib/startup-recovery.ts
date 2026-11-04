/** Runs before Next.js bundles, so recovery also works when React cannot start. */
export const STARTUP_RECOVERY_SCRIPT = `(() => {
  const retryKey = 'cliniq:startup-retry:v1';
  let ready = false;
  let retryScheduled = false;
  let retryTimer;

  function showRecovery() {
    if (ready) return;
    const panel = document.getElementById('cliniq-startup-recovery');
    if (panel) panel.hidden = false;
    else document.addEventListener('DOMContentLoaded', showRecovery, { once: true });
  }

  function scriptFailed(event) {
    const target = event.target;
    if (ready || retryScheduled || !target || target.tagName !== 'SCRIPT') return;
    let url;
    try { url = new URL(target.src, location.href); } catch { return; }
    if (url.origin !== location.origin || !url.pathname.startsWith('/_next/static/')) return;

    // A blocked storage API must never create an unbounded reload loop.
    try {
      const lastRetry = Number(sessionStorage.getItem(retryKey));
      const now = Date.now();
      if (lastRetry && now - lastRetry < 300000) { showRecovery(); return; }
      sessionStorage.setItem(retryKey, String(now));
      retryScheduled = true;
      retryTimer = setTimeout(() => { if (!ready) location.reload(); }, 200);
    } catch { showRecovery(); }
  }

  const watchdog = setTimeout(showRecovery, 20000);
  window.addEventListener('error', scriptFailed, true);
  window.addEventListener('cliniq:startup-ready', () => {
    ready = true;
    clearTimeout(watchdog);
    clearTimeout(retryTimer);
    window.removeEventListener('error', scriptFailed, true);
    const panel = document.getElementById('cliniq-startup-recovery');
    if (panel) panel.hidden = true;
  }, { once: true });
})();`;
