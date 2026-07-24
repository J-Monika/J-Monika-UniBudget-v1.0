// ============================================================
//  UniBudget — Supabase cloud adapter
//  Exposes window.Cloud, which the app's auth layer auto-detects.
//  If config/keys are missing, Cloud.enabled = false and the app
//  transparently falls back to device-account mode.
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

  function friendly(msg) {
    msg = String(msg || "");
    if (/invalid login/i.test(msg)) return "Wrong email or password. Please try again.";
    if (/already registered/i.test(msg)) return "An account with this email already exists. Try logging in.";
    if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a minute and retry.";
    return msg || "Something went wrong. Please try again.";
  }

  async function pullBudget(uid, email) {
    try {
      var r = await sb.from("budgets").select("data").eq("user_id", uid).maybeSingle();
      if (r.data && r.data.data) localStorage.setItem(dataKey(email), JSON.stringify(r.data.data));
    } catch (e) { /* offline — device cache stays authoritative */ }
  }

  var pushTimer = null;
  function push(state) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async function () {
      try {
        var u = (await sb.auth.getUser()).data.user;
        if (!u) return;
        await sb.from("budgets").upsert(
          { user_id: u.id, data: state, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      } catch (e) { /* will retry on next save */ }
    }, 800);
  }

  window.Cloud = {
    enabled: true,
    client: sb,
    async signup(name, email, pass) {
      email = email.toLowerCase().trim();
      var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { name: name } } });
      if (r.error) throw new Error(friendly(r.error.message));
      if (!r.data.session) throw new Error("Account created — check your email to confirm it, then log in.");
      return { email: email, name: name };
    },
    async login(email, pass) {
      email = email.toLowerCase().trim();
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw new Error(friendly(r.error.message));
      var u = r.data.user;
      var name = (u.user_metadata && u.user_metadata.name) || email.split("@")[0];
      await pullBudget(u.id, email);
      return { email: email, name: name };
    },
    async logout() { try { await sb.auth.signOut(); } catch (e) {} },
    push: push
  };
})();
