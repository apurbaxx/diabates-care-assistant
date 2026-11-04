const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('lib/startup-recovery.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported });

function browser(storage = new Map(), blocked = false) {
  const panel = { hidden: true };
  const timers = new Map();
  const handlers = new Map();
  let timerId = 0;
  let reloads = 0;
  const window = {
    addEventListener(name, handler) { handlers.set(name, handler); },
    removeEventListener(name) { handlers.delete(name); },
  };
  const context = {
    URL, Date, window,
    location: { href: 'https://cliniq.test/patient/example', origin: 'https://cliniq.test', reload() { reloads++; } },
    document: { getElementById: () => panel },
    sessionStorage: {
      getItem(key) { if (blocked) throw new Error('Storage unavailable'); return storage.get(key) || null; },
      setItem(key, value) { if (blocked) throw new Error('Storage unavailable'); storage.set(key, value); },
    },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(exported.STARTUP_RECOVERY_SCRIPT, context);
  return {
    panel, storage,
    error(tagName = 'SCRIPT', src = 'https://cliniq.test/_next/static/chunks/missing.js') {
      handlers.get('error')?.({ target: { tagName, src } });
    },
    ready() { handlers.get('cliniq:startup-ready')?.(); },
    run(ms) {
      for (const [id, timer] of [...timers]) if (timer.ms === ms && timers.has(id)) { timers.delete(id); timer.fn(); }
    },
    get reloads() { return reloads; },
  };
}

// Several failed scripts cause just one retry; the next page shares the retry guard.
const first = browser();
first.error(); first.error(); first.run(200);
assert.equal(first.reloads, 1);
const second = browser(first.storage);
second.error(); second.run(200);
assert.equal(second.reloads, 0);
assert.equal(second.panel.hidden, false);

// Successful startup cancels recovery and never reloads an active workspace.
const healthy = browser();
healthy.ready(); healthy.run(20000); healthy.error(); healthy.run(200);
assert.equal(healthy.reloads, 0);
assert.equal(healthy.panel.hidden, true);
const recovered = browser();
recovered.error(); recovered.ready(); recovered.run(200);
assert.equal(recovered.reloads, 0);

// Slow startup offers a manual retry, then removes the message if startup succeeds.
const slow = browser();
slow.run(20000);
assert.equal(slow.panel.hidden, false);
assert.equal(slow.reloads, 0);
slow.ready();
assert.equal(slow.panel.hidden, true);

// Privacy restrictions do not create reload loops or prevent the recovery message.
const restricted = browser(new Map(), true);
restricted.error(); restricted.run(200);
assert.equal(restricted.reloads, 0);
assert.equal(restricted.panel.hidden, false);

// Fonts, images and third-party scripts must not trigger automatic reloads.
const unrelated = browser();
unrelated.error('LINK'); unrelated.error('IMG');
unrelated.error('SCRIPT', 'https://other.test/_next/static/example.js');
unrelated.error('SCRIPT', 'https://cliniq.test/analytics.js');
unrelated.run(200);
assert.equal(unrelated.reloads, 0);
assert.equal(unrelated.storage.size, 0);

// An expired retry guard permits recovery from a later independent failure.
const expired = browser(new Map([['cliniq:startup-retry:v1', String(Date.now() - 300001)]]));
expired.error(); expired.run(200);
assert.equal(expired.reloads, 1);
console.log('PASS: startup retry, reload-loop prevention, delayed startup, storage restrictions and active-session isolation');
