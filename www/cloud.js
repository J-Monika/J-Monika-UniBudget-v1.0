// ============================================================
//  UniBudget — Supabase cloud adapter (offline-first, per-row sync)
//  Exposes window.Cloud. Transactions sync row-by-row into a
//  `transactions` table (LWW by updated_at, tombstones for deletes,
//  GCash Ref-No. as a deterministic id). Settings (currency/limits)
//  stay in the small `budgets` blob. Falls back to device-mode if
//  no keys are configured.
// ============================================================
(function () {
  "use strict";
  var cfg = window.UNIBUDGET_CONFIG || {};
  var hasKeys =
    window.supabase &&
    cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("YOUR-") === -1 &&
    cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-") === -1;

  if (!hasKeys) { window.Cloud = { enabled: false }; return; }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  function dataKey(email) { return "unibudget:data:" + email.toLowerCase(); }
  function pushWM(email) { return "unibudget:push:" + email.toLowerCase(); }
  function pullWM(email) { return "unibudget:pull:" + email.toLowerCase(); }
  function sessionEmail() { try { return JSON.parse(localStorage.getItem("unibudget:session")).email; } catch (e) { return null; } }
  function readCache(email) { try { return JSON.parse(localStorage.getItem(dataKey(email))); } catch (e) { return null; } }
  function writeCache(email, s) { localStorage.setItem(dataKey(email), JSON.stringify(s)); }
  function markSynced(ok) {
    var d = document.getElementById("syncDot"), l = document.getElementById("syncLabel");
    if (d) d.classList.toggle("dirty", !ok);
    if (l) l.textContent = ok ? "Synced" : "Sync Now";
  }
  async function currentUser() { try { return (await sb.auth.getUser()).data.user; } catch (e) { return null; } }

  function friendly(msg) {
    msg = String(msg || "");
    if (/invalid login/i.test(msg)) return "Wrong email or password. Please try again.";
    if (/already registered/i.test(msg)) return "An account with this email already exists. Try logging in.";
    if (/email.*not.*confirm/i.test(msg)) return "Please confirm your email first (check your inbox).";
    if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a minute and retry.";
    return msg || "Something went wrong. Please try again.";
  }

  // ---- (de)serialization between local txn objects and DB rows ----
  function rowFromTxn(uid, t) {
    return {
      user_id: uid, id: t.id,
      amount: t.amount, type: t.type,
      category: t.cat || null, description: t.desc || null,
      occurred_at: new Date(t.ts).toISOString(),
      updated_at: new Date(t.updated_at || t.ts).toISOString(),
      deleted: !!t.deleted
    };
  }
  function txnFromRow(r) {
    return {
      id: r.id, amount: Number(r.amount), type: r.type,
      cat: r.category || "Other", desc: r.description || "",
      ts: new Date(r.occurred_at).getTime(),
      updated_at: new Date(r.updated_at).getTime(),
      deleted: !!r.deleted,
      source: String(r.id).indexOf("gcash-") === 0 ? "gcash-auto" : undefined
    };
  }

  // ---- PUSH: upsert rows changed since the last successful push ----
  var pushTimer = null, pushing = false;
  function pushState(state) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush(state); }, 700);
  }
  async function flush(stateMaybe) {
    if (pushing || !navigator.onLine) { if (!navigator.onLine) markSynced(false); return; }
    pushing = true;
    try {
      var u = await currentUser(); if (!u) return;
      var email = sessionEmail(); if (!email) return;
      var state = stateMaybe || readCache(email); if (!state) return;

      var wmKey = pushWM(email);
      var lastPush = Number(localStorage.getItem(wmKey) || 0);
      var changed = (state.txns || []).filter(function (t) { return (t.updated_at || t.ts || 0) > lastPush; });

      if (changed.length) {
        var res = await sb.from("transactions")
          .upsert(changed.map(function (t) { return rowFromTxn(u.id, t); }), { onConflict: "user_id,id" });
        if (res.error) throw res.error;
      }
      var res2 = await sb.from("budgets").upsert(
        { user_id: u.id, data: { currency: state.currency, limits: state.limits }, updated_at: new Date().toISOString() },
        { onConflict: "user_id" });
      if (res2.error) throw res2.error;

      var maxU = changed.reduce(function (a, t) { return Math.max(a, t.updated_at || t.ts || 0); }, lastPush);
      localStorage.setItem(wmKey, String(maxU));
      markSynced(true);
    } catch (e) {
      markSynced(false);   // stays dirty → retried on next save, 'online', or interval
    } finally { pushing = false; }
  }

  // ---- PULL: merge rows updated since the last pull (LWW) ----
  var pulling = false;
  async function pull() {
    if (pulling || !navigator.onLine) return false;
    pulling = true;
    var changedLocal = false;
    try {
      var u = await currentUser(); if (!u) return false;
      var email = sessionEmail(); if (!email) return false;

      var wmKey = pullWM(email);
      var lastPull = Number(localStorage.getItem(wmKey) || 0);
      var res = await sb.from("transactions").select("*")
        .eq("user_id", u.id).gt("updated_at", new Date(lastPull).toISOString());
      if (res.error) throw res.error;

      var cache = readCache(email) || { currency: "PHP", limits: {}, txns: [] };
      var byId = {}; (cache.txns || []).forEach(function (t) { byId[t.id] = t; });
      var maxU = lastPull;
      (res.data || []).forEach(function (r) {
        var incoming = txnFromRow(r);
        maxU = Math.max(maxU, incoming.updated_at);
        var cur = byId[incoming.id];
        if (!cur || incoming.updated_at >= (cur.updated_at || cur.ts || 0)) { byId[incoming.id] = incoming; changedLocal = true; }
      });
      var sres = await sb.from("budgets").select("data").eq("user_id", u.id).maybeSingle();
      if (sres.data && sres.data.data) {
        if (sres.data.data.currency) cache.currency = sres.data.data.currency;
        if (sres.data.data.limits && Object.keys(sres.data.data.limits).length) { cache.limits = sres.data.data.limits; changedLocal = true; }
      }
      cache.txns = Object.keys(byId).map(function (k) { return byId[k]; });
      writeCache(email, cache);
      localStorage.setItem(wmKey, String(maxU));
      if (changedLocal && window.UniBudget && window.UniBudget.reload) window.UniBudget.reload();
    } catch (e) { /* offline — cache stays authoritative */ } finally { pulling = false; }
    return changedLocal;
  }

  async function hydrate(email) {
    // Fresh pull of everything into the local cache before the app reads it.
    localStorage.setItem(pullWM(email), "0");
    localStorage.setItem(pushWM(email), "0");
    await pull();
  }

  window.Cloud = {
    enabled: true,
    client: sb,
    async signup(name, email, pass) {
      email = email.toLowerCase().trim();
      var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { name: name } } });
      if (r.error) throw new Error(friendly(r.error.message));
      if (!r.data.session) throw new Error("Account created — check your email to confirm it, then log in.");
      await hydrate(email);
      return { email: email, name: name };
    },
    async login(email, pass) {
      email = email.toLowerCase().trim();
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw new Error(friendly(r.error.message));
      var u = r.data.user;
      var name = (u.user_metadata && u.user_metadata.name) || email.split("@")[0];
      await hydrate(email);
      return { email: email, name: name };
    },
    async logout() { try { await sb.auth.signOut(); } catch (e) {} },
    pushState: pushState,
    pull: pull
  };

  // Background sync triggers (offline outbox retry + live pull)
  window.addEventListener("online", function () { flush(); pull(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { pull(); flush(); } });
  setInterval(function () { if (navigator.onLine && sessionEmail()) { pull(); flush(); } }, 60000);
  // Initial catch-up for an already-signed-in user on cold start.
  if (sessionEmail()) setTimeout(pull, 1500);
})();
