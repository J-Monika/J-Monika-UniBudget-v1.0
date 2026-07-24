// ============================================================
//  UniBudget — native GCash bridge + setup UI
//  Connects the Android NotificationListener + SMS receiver to
//  the app's window.UniBudget.ingestGcash() parser, and injects a
//  "Connect GCash" setup panel. Runs only inside the native app.
// ============================================================
(function () {
  "use strict";
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;

  var GcashWatcher = Cap.registerPlugin("GcashWatcher");
  window.GcashWatcher = GcashWatcher;

  function feed(text) {
    if (window.UniBudget && window.UniBudget.isReady && window.UniBudget.isReady()) {
      window.UniBudget.ingestGcash(text);
    }
  }

  async function drainQueue() {
    try {
      var res = await GcashWatcher.getQueue();
      var msgs = (res && res.messages) || [];
      if (!msgs.length) return;
      msgs.forEach(feed);
      await GcashWatcher.clearQueue();
    } catch (e) {}
  }

  GcashWatcher.addListener("gcashMessage", function (ev) {
    if (ev && ev.text) feed(ev.text);
  });

  function whenReady(fn) {
    if (window.UniBudget && window.UniBudget.isReady && window.UniBudget.isReady()) fn();
    else setTimeout(function () { whenReady(fn); }, 500);
  }

  var App = Cap.Plugins && Cap.Plugins.App;
  if (App) App.addListener("appStateChange", function (s) { if (s.isActive) { whenReady(drainQueue); refreshStatus(); } });

  // ---------- Setup UI (injected) ----------
  var STYLE = '\
  #gc-scrim{position:fixed;inset:0;background:rgba(15,20,35,.5);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;padding:20px;z-index:70}\
  #gc-scrim.show{display:flex}\
  #gc-modal{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);width:100%;max-width:460px;max-height:88vh;overflow:auto}\
  #gc-modal h3{margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em}\
  .gc-head{padding:22px 24px 6px;display:flex;justify-content:space-between;align-items:center}\
  .gc-head p{margin:4px 0 0;font-size:13px;color:var(--muted)}\
  .gc-body{padding:8px 24px 20px;display:flex;flex-direction:column;gap:12px}\
  .gc-step{border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}\
  .gc-step .gc-t{font-weight:700;font-size:14.5px}\
  .gc-step .gc-d{font-size:12.5px;color:var(--muted);margin-top:2px}\
  .gc-dot{width:10px;height:10px;border-radius:50%;background:var(--track);margin-top:5px;flex-shrink:0}\
  .gc-dot.ok{background:var(--income)}\
  .gc-step .gc-btn{margin-top:10px;border:0;background:var(--accent);color:#fff;font-weight:700;font-size:13px;padding:9px 14px;border-radius:10px;cursor:pointer;font-family:inherit}\
  .gc-step.done .gc-btn{background:var(--income-soft);color:var(--income)}\
  .gc-x{border:0;background:var(--page);width:34px;height:34px;border-radius:10px;font-size:18px;color:var(--muted);cursor:pointer}';

  var HTML = '\
  <div id="gc-modal" role="dialog" aria-modal="true" aria-labelledby="gc-title">\
    <div class="gc-head"><div><h3 id="gc-title">🔗 Connect GCash</h3>\
      <p>Auto-log transactions the moment GCash notifies you.</p></div>\
      <button class="gc-x" id="gc-close" aria-label="Close">✕</button></div>\
    <div class="gc-body">\
      <div class="gc-step" id="gc-s1"><span class="gc-dot"></span><div style="flex:1">\
        <div class="gc-t">Notification access</div>\
        <div class="gc-d">Lets UniBudget read GCash notifications. Find "UniBudget GCash detector" in the list and turn it on.</div>\
        <button class="gc-btn" id="gc-b1">Open settings</button></div></div>\
      <div class="gc-step" id="gc-s2"><span class="gc-dot"></span><div style="flex:1">\
        <div class="gc-t">SMS access</div>\
        <div class="gc-d">Backup for GCash text alerts.</div>\
        <button class="gc-btn" id="gc-b2">Allow SMS</button></div></div>\
      <div class="gc-step" id="gc-s3"><span class="gc-dot"></span><div style="flex:1">\
        <div class="gc-t">Show notifications</div>\
        <div class="gc-d">So we can alert you when money moves.</div>\
        <button class="gc-btn" id="gc-b3">Allow notifications</button></div></div>\
      <div class="gc-step" id="gc-s4"><span class="gc-dot"></span><div style="flex:1">\
        <div class="gc-t">Keep it running</div>\
        <div class="gc-d">Stops your phone from putting UniBudget to sleep, so it never misses a GCash alert. On Samsung, also add it to "Never sleeping apps".</div>\
        <button class="gc-btn" id="gc-b4">Allow always-on</button>\
        <button class="gc-btn" id="gc-b4b" style="background:transparent;color:var(--accent-strong);border:1.5px solid var(--line);margin-top:6px">Open battery settings</button></div></div>\
    </div>\
  </div>';

  function injectUI() {
    var st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
    var scrim = document.createElement("div"); scrim.id = "gc-scrim"; scrim.innerHTML = HTML;
    document.body.appendChild(scrim);

    scrim.addEventListener("click", function (e) { if (e.target === scrim) close(); });
    document.getElementById("gc-close").addEventListener("click", close);
    document.getElementById("gc-b1").addEventListener("click", async function () { await GcashWatcher.openNotificationAccessSettings(); });
    document.getElementById("gc-b2").addEventListener("click", async function () { await GcashWatcher.requestSmsPermission(); refreshStatus(); });
    document.getElementById("gc-b3").addEventListener("click", async function () { await GcashWatcher.requestPostNotifications(); refreshStatus(); });
    document.getElementById("gc-b4").addEventListener("click", async function () { try { await GcashWatcher.requestIgnoreBatteryOptimization(); } catch (e) {} refreshStatus(); });
    document.getElementById("gc-b4b").addEventListener("click", async function () { try { await GcashWatcher.openBatterySettings(); } catch (e) {} });

  }

  function open() { document.getElementById("gc-scrim").classList.add("show"); refreshStatus(); }
  function close() { document.getElementById("gc-scrim").classList.remove("show"); }

  async function refreshStatus() {
    if (!document.getElementById("gc-scrim")) return;
    try {
      var s = await GcashWatcher.checkPermissions();
      mark("gc-s1", s.notificationAccess);
      mark("gc-s2", s.sms);
      mark("gc-s3", s.postNotifications);
      mark("gc-s4", s.battery);
    } catch (e) {}
  }
  function mark(id, ok) {
    var el = document.getElementById(id); if (!el) return;
    el.classList.toggle("done", !!ok);
    el.querySelector(".gc-dot").classList.toggle("ok", !!ok);
    var btn = el.querySelector(".gc-btn"); if (btn && ok) btn.textContent = "✓ Enabled";
  }

  function boot() {
    injectUI();
    whenReady(function () { drainQueue(); refreshStatus(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Exposed to the app so the Account button + bottom bar can open setup.
  window.GcashSetup = { open: open };
  window.GcashPermissions = {
    check: function () { return GcashWatcher.checkPermissions(); },
    open: open
  };
})();
