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

  // ---- (de)serialization between local transaction objects and DB rows ----
  function rowFromTxn(uid, t) {
    return {
      user_id: uid, id: t.id,
      amount: t.amount, type: t.type,
      category: t.cat || null, description: t.desc || null,
      occurred_at: new Date(t.ts || Date.now()).toISOString(),
      updated_at: new Date(t.updated_at || Date.now()).toISOString(),
      deleted: !!t.deleted,
      source_type: t.source_type || (t.source === "gcash-auto" ? "AUTOMATED_NOTIFICATION" : "MANUAL"),
      source_app_or_sender: t.source_app_or_sender || (t.source === "gcash-auto" ? "GCash" : null),
      raw_message_text: t.raw_message_text || null,
      captured_at: t.captured_at ? new Date(t.captured_at).toISOString() : null
    };
  }
  function txnFromRow(r) {
    return {
      id: r.id, amount: Number(r.amount), type: r.type,
      cat: r.category || "Other", desc: r.description || "",
      ts: new Date(r.occurred_at).getTime(),
      updated_at: new Date(r.updated_at).getTime(),
      deleted: !!r.deleted,
      source: r.source_type && r.source_type.indexOf("AUTOMATED") === 0 ? "gcash-auto" : "manual",
      source_type: r.source_type || "MANUAL",
      source_app_or_sender: r.source_app_or_sender || null,
      raw_message_text: r.raw_message_text || null,
      captured_at: r.captured_at ? new Date(r.captured_at).getTime() : null
    };
  }

  // ---- (de)serialization between local peer ledger objects and DB rows ----
  function rowFromPeerLedger(uid, e) {
    return {
      user_id: uid, id: e.id,
      type: e.type, counterparty_name: e.counterpartyName,
      amount: e.amount, currency: e.currency || "PHP",
      description: e.description || null, status: e.status || "UNSETTLED",
      settled_amount: e.settledAmount || 0,
      due_date: e.dueDate ? new Date(e.dueDate).toISOString() : null,
      created_at: new Date(e.createdAt || Date.now()).toISOString(),
      updated_at: new Date(e.updatedAt || Date.now()).toISOString(),
      deleted: !!e.deleted
    };
  }
  function peerLedgerFromRow(r) {
    return {
      id: r.id, type: r.type, counterpartyName: r.counterparty_name,
      amount: Number(r.amount), currency: r.currency || "PHP",
      description: r.description || "", status: r.status,
      settledAmount: Number(r.settled_amount),
      dueDate: r.due_date ? new Date(r.due_date).getTime() : null,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
      deleted: !!r.deleted
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
      var changedTxns = (state.txns || []).filter(function (t) { return (t.updated_at || t.ts || 0) > lastPush; });
      var changedPeer = (state.peerLedger || []).filter(function (p) { return (p.updatedAt || p.createdAt || 0) > lastPush; });

      if (changedTxns.length) {
        var res = await sb.from("transactions")
          .upsert(changedTxns.map(function (t) { return rowFromTxn(u.id, t); }), { onConflict: "user_id,id" });
        if (res.error) throw res.error;
      }
      if (changedPeer.length) {
        var resPeer = await sb.from("peer_ledger")
          .upsert(changedPeer.map(function (p) { return rowFromPeerLedger(u.id, p); }), { onConflict: "user_id,id" });
        if (resPeer.error) throw resPeer.error;
      }
      var res2 = await sb.from("budgets").upsert(
        { user_id: u.id, data: { currency: state.currency, limits: state.limits, notifications: state.notifications }, updated_at: new Date().toISOString() },
        { onConflict: "user_id" });
      if (res2.error) throw res2.error;

      var maxTxn = changedTxns.reduce(function (a, t) { return Math.max(a, t.updated_at || t.ts || 0); }, lastPush);
      var maxPeer = changedPeer.reduce(function (a, p) { return Math.max(a, p.updatedAt || p.createdAt || 0); }, lastPush);
      var maxU = Math.max(maxTxn, maxPeer);
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

      var resPeer = await sb.from("peer_ledger").select("*")
        .eq("user_id", u.id).gt("updated_at", new Date(lastPull).toISOString());
      if (resPeer.error) throw resPeer.error;

      var cache = readCache(email) || { currency: "PHP", limits: {}, txns: [], peerLedger: [] };
      var byId = {}; (cache.txns || []).forEach(function (t) { byId[t.id] = t; });
      var maxU = lastPull;
      (res.data || []).forEach(function (r) {
        var incoming = txnFromRow(r);
        maxU = Math.max(maxU, incoming.updated_at);
        var cur = byId[incoming.id];
        if (!cur || incoming.updated_at >= (cur.updated_at || cur.ts || 0)) { byId[incoming.id] = incoming; changedLocal = true; }
      });

      var byIdPeer = {}; (cache.peerLedger || []).forEach(function (p) { byIdPeer[p.id] = p; });
      (resPeer.data || []).forEach(function (r) {
        var incoming = peerLedgerFromRow(r);
        maxU = Math.max(maxU, incoming.updatedAt);
        var cur = byIdPeer[incoming.id];
        if (!cur || incoming.updatedAt >= (cur.updatedAt || cur.createdAt || 0)) { byIdPeer[incoming.id] = incoming; changedLocal = true; }
      });

      var sres = await sb.from("budgets").select("data").eq("user_id", u.id).maybeSingle();
      if (sres.data && sres.data.data) {
        if (sres.data.data.currency) cache.currency = sres.data.data.currency;
        if (sres.data.data.limits && Object.keys(sres.data.data.limits).length) { cache.limits = sres.data.data.limits; changedLocal = true; }
        if (sres.data.data.notifications) { cache.notifications = sres.data.data.notifications; changedLocal = true; }
      }
      cache.txns = Object.keys(byId).map(function (k) { return byId[k]; });
      cache.peerLedger = Object.keys(byIdPeer).map(function (k) { return byIdPeer[k]; });
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
