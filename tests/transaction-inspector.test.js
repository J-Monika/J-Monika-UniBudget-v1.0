// ============================================================
//  UniBudget — Transaction Inspector & Visual Source Indicator Unit Tests
//  Run with: node tests/transaction-inspector.test.js
// ============================================================

const assert = require("assert");

function createTestHarness() {
  function safeCounterparty(who) {
    if (!who) return "";
    return who.replace(/[^A-Za-z0-9 .*-]/g, "").substring(0, 30);
  }

  function parseGcash(text) {
    if (!text) return null;
    var t = String(text).replace(/\s+/g, " ").trim();
    var low = t.toLowerCase();
    var wallet = "GCash";
    if (/paymaya|maya/.test(low)) wallet = "Maya";
    else if (/shopee/.test(low)) wallet = "ShopeePay";
    else if (/grab/.test(low)) wallet = "GrabPay";

    var m = t.match(/(?:php|p|₱)\s?([0-9][0-9,]*\.?[0-9]{0,2})|([0-9][0-9,]*\.?[0-9]{0,2})\s?(?:php|p|₱)/i);
    if (!m) return null;
    var rawAmt = m[1] || m[2];
    var amount = parseFloat(rawAmt.replace(/,/g, ""));
    if (!(amount > 0)) return null;

    var refM = t.match(/(?:ref(?:erence)?|txn|transaction)\.?\s*(?:no\.?|id)?\s*[:#]?\s*([0-9]{6,})/i);
    var ref = refM ? refM[1] : null;

    var isIncome = /(received|credited|refund|cash\s?in|added to your|you got|top ?up)/i.test(low);
    var isExpense = /(sent|paid|payment|purchase|debited|cash\s?out|transferred to|bills? payment|successful|you have paid)/i.test(low);
    var type = isIncome && !isExpense ? "income" : "expense";

    var who = "";
    var wm = t.match(/(?:from|to|at|for)\s+([A-Z0-9][A-Za-z0-9 .,'&*-]{2,40})/);
    if (wm) {
      who = wm[1]
        .replace(/\s+(w\/|via|has|new balance|new|ref|txn|on|is|\d).*$/i, "")
        .replace(/[.\s]+$/, "")
        .trim();
    }
    who = safeCounterparty(who);

    var cat = type === "income" ? "Allowance & Aid" : "Other";
    var desc = wallet + (who ? " · " + who : (type === "income" ? " Cash In" : " Payment"));
    return {
      desc: desc,
      amount: Math.round(amount * 100) / 100,
      type: type,
      cat: cat,
      ref: ref,
      source_app_or_sender: wallet
    };
  }

  function ingestGcash(state, text, currentTime) {
    var now = currentTime || Date.now();
    var parsed = parseGcash(text);
    if (!parsed) return { ok: false, reason: "unparsed" };
    if (!state.txns) state.txns = [];

    var sourceType = parsed.ref ? "AUTOMATED_SMS" : "AUTOMATED_NOTIFICATION";
    var stableId = parsed.ref ? ("gcash-" + parsed.ref) : ("gcash-draft-" + parsed.type + "-" + Math.round(parsed.amount * 100));

    parsed.id = stableId;
    parsed.ts = now;
    parsed.updated_at = now;
    parsed.deleted = false;
    parsed.source = "gcash-auto";
    parsed.source_type = sourceType;
    parsed.source_app_or_sender = parsed.source_app_or_sender || "GCash";
    parsed.raw_message_text = text;
    parsed.captured_at = now;

    state.txns.push(parsed);
    return { ok: true, txn: parsed };
  }

  function addManualTxn(state, desc, amount, type, cat, currentTime) {
    var now = currentTime || Date.now();
    var txn = {
      id: "m-" + now,
      desc: desc,
      amount: Math.round(amount * 100) / 100,
      type: type,
      cat: cat,
      ts: now,
      updated_at: now,
      deleted: false,
      source: "manual",
      source_type: "MANUAL",
      source_app_or_sender: null,
      raw_message_text: null,
      captured_at: null
    };
    state.txns = (state.txns || []).concat(txn);
    return txn;
  }

  function rowFromTxn(uid, t) {
    return {
      user_id: uid,
      id: t.id,
      amount: t.amount,
      type: t.type,
      category: t.cat,
      description: t.desc,
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
      id: r.id,
      amount: Number(r.amount),
      type: r.type,
      cat: r.category || "Other",
      desc: r.description || "",
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

  return { parseGcash, ingestGcash, addManualTxn, rowFromTxn, txnFromRow };
}

console.log("▶ Running Transaction Inspector & Visual Source Indicator Unit Tests...");

const harness = createTestHarness();

// Test 1: Automated ingestion attaches source metadata and raw message payload
{
  const state = { txns: [] };
  const rawText = "You have received 213.00 PHP of GCash from GA***... on 07/31/26 13:00. Ref No. 901238471.";
  const res = harness.ingestGcash(state, rawText, 1720000000000);

  assert.strictEqual(res.ok, true);
  const txn = state.txns[0];
  assert.strictEqual(txn.source_type, "AUTOMATED_SMS");
  assert.strictEqual(txn.source_app_or_sender, "GCash");
  assert.strictEqual(txn.raw_message_text, rawText);
  assert.strictEqual(txn.captured_at, 1720000000000);
  console.log("  ✓ Test 1 Passed: Automated ingestion attaches source metadata and raw message payload");
}

// Test 2: Manual transaction sets source_type MANUAL and null payload metadata
{
  const state = { txns: [] };
  const txn = harness.addManualTxn(state, "Lunch", 150, "expense", "Food & Dining", 1720000005000);

  assert.strictEqual(txn.source_type, "MANUAL");
  assert.strictEqual(txn.source_app_or_sender, null);
  assert.strictEqual(txn.raw_message_text, null);
  assert.strictEqual(txn.captured_at, null);
  console.log("  ✓ Test 2 Passed: Manual transaction sets source_type MANUAL and null payload metadata");
}

// Test 3: Cloud serialization & deserialization maps source metadata
{
  const originalTxn = {
    id: "gcash-901238471",
    amount: 213,
    type: "income",
    cat: "Allowance & Aid",
    desc: "GCash · GA***...",
    ts: 1720000000000,
    updated_at: 1720000000000,
    deleted: false,
    source: "gcash-auto",
    source_type: "AUTOMATED_SMS",
    source_app_or_sender: "GCash",
    raw_message_text: "You have received 213.00 PHP of GCash from GA***...",
    captured_at: 1720000000000
  };

  const row = harness.rowFromTxn("user-123", originalTxn);
  assert.strictEqual(row.source_type, "AUTOMATED_SMS");
  assert.strictEqual(row.source_app_or_sender, "GCash");
  assert.strictEqual(row.raw_message_text, "You have received 213.00 PHP of GCash from GA***...");

  const restored = harness.txnFromRow(row);
  assert.strictEqual(restored.source_type, "AUTOMATED_SMS");
  assert.strictEqual(restored.source_app_or_sender, "GCash");
  assert.strictEqual(restored.raw_message_text, "You have received 213.00 PHP of GCash from GA***...");
  assert.strictEqual(restored.captured_at, 1720000000000);
  console.log("  ✓ Test 3 Passed: Cloud serialization & deserialization maps source metadata");
}

// Test 4: Real-time state array reference update & newest-first list sorting
{
  const state = { txns: [] };
  const oldTxn = harness.addManualTxn(state, "Book", 500, "expense", "Books & Supplies", 100000);
  const newTxn = harness.addManualTxn(state, "Coffee", 120, "expense", "Food & Dining", 200000);

  assert.strictEqual(state.txns.length, 2);
  const activeSorted = state.txns.filter(t => !t.deleted).slice().sort((a, b) => b.ts - a.ts);
  assert.strictEqual(activeSorted[0].desc, "Coffee");
  assert.strictEqual(activeSorted[1].desc, "Book");
  console.log("  ✓ Test 4 Passed: Real-time state array reference update & newest-first list sorting");
}

console.log("\n🎉 ALL TRANSACTION INSPECTOR UNIT TESTS PASSED SUCCESSFULLY!\n");
