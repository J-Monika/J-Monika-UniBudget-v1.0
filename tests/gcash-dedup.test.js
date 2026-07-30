// ============================================================
//  UniBudget — GCash Auto-Logging Deduplication Unit Tests
//  Run with: node tests/gcash-dedup.test.js
// ============================================================

const assert = require("assert");

function createGcashEngine() {
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
    return { desc: desc, amount: Math.round(amount * 100) / 100, type: type, cat: cat, ref: ref };
  }

  function ingestGcash(state, text, currentTime) {
    var now = currentTime || Date.now();
    var parsed = parseGcash(text);
    if (!parsed) return { ok: false, reason: "unparsed" };

    if (!state.txns) state.txns = [];

    // Case 1: Transaction HAS an explicit Ref No. (e.g., from SMS)
    if (parsed.ref) {
      var stableId = "gcash-" + parsed.ref;
      var existingWithRef = state.txns.find(function (x) { return x.id === stableId && !x.deleted; });
      if (existingWithRef) return { ok: false, reason: "duplicate" };

      // Check if an un-referenced gcash-auto transaction matching amount, type & counterparty exists within 24h (86400000 ms)
      var unrefMatch = state.txns.find(function (x) {
        return x.source === "gcash-auto" &&
          !x.deleted &&
          !x.ref &&
          x.amount === parsed.amount &&
          x.type === parsed.type &&
          Math.abs(now - x.ts) <= 86400000;
      });

      if (unrefMatch) {
        // Upgrade un-referenced transaction in-place!
        unrefMatch.id = stableId;
        unrefMatch.ref = parsed.ref;
        unrefMatch.updated_at = now;
        if (parsed.desc) unrefMatch.desc = parsed.desc;
        return { ok: true, upgraded: true, txn: unrefMatch };
      }

      parsed.id = stableId;
      parsed.ts = now;
      parsed.updated_at = now;
      parsed.deleted = false;
      parsed.source = "gcash-auto";
      state.txns.push(parsed);
      return { ok: true, upgraded: false, txn: parsed };
    }

    // Case 2: Transaction DOES NOT have a Ref No. (e.g. Push Notification)
    // Check if any matching gcash-auto transaction (with or without ref) exists within 3 minutes (180,000 ms)
    var recentDup = state.txns.some(function (x) {
      return x.source === "gcash-auto" &&
        !x.deleted &&
        x.amount === parsed.amount &&
        x.type === parsed.type &&
        Math.abs(now - x.ts) <= 180000;
    });
    if (recentDup) return { ok: false, reason: "duplicate" };

    // Generate a deterministic temporary ID for ref-less transactions based on amount, type & timestamp bucket (10 min bucket)
    var bucket = Math.floor(now / 600000);
    parsed.id = "gcash-draft-" + parsed.type + "-" + Math.round(parsed.amount * 100) + "-" + bucket;
    
    // Ensure uniqueness if multiple ref-less distinct payments happen in same bucket
    var collisionCount = state.txns.filter(function (x) { return x.id && x.id.indexOf(parsed.id) === 0; }).length;
    if (collisionCount > 0) parsed.id += "-" + collisionCount;

    parsed.ts = now;
    parsed.updated_at = now;
    parsed.deleted = false;
    parsed.source = "gcash-auto";
    parsed.ref = null;
    state.txns.push(parsed);
    return { ok: true, upgraded: false, txn: parsed };
  }

  return { parseGcash, ingestGcash };
}

// ============================================================
//  Test Suite Execution
// ============================================================

console.log("▶ Running GCash Auto-Logging Deduplication Unit Tests...");

const engine = createGcashEngine();

// Test 1: Ref-less push notification creates draft transaction
{
  const state = { txns: [] };
  const pushText = "You have received PHP 213.00 from GA***...";
  const res = engine.ingestGcash(state, pushText, 1000000);

  assert.strictEqual(res.ok, true, "Ref-less push notification should ingest successfully");
  assert.strictEqual(state.txns.length, 1, "Should have 1 transaction");
  assert.strictEqual(state.txns[0].amount, 213.00);
  assert.strictEqual(state.txns[0].type, "income");
  assert.strictEqual(state.txns[0].ref, null);
  assert(state.txns[0].id.includes("gcash-draft"), "ID should be a gcash-draft ID");
  console.log("  ✓ Test 1 Passed: Ref-less push notification creates draft transaction");
}

// Test 2: Immediate duplicate push notification within 3 minutes is rejected
{
  const state = { txns: [] };
  const pushText = "You have received PHP 213.00 from GA***...";
  
  engine.ingestGcash(state, pushText, 1000000);
  const dupRes = engine.ingestGcash(state, pushText, 1000000 + 30000); // 30 seconds later

  assert.strictEqual(dupRes.ok, false, "Duplicate push notification within 3 mins should be rejected");
  assert.strictEqual(dupRes.reason, "duplicate");
  assert.strictEqual(state.txns.length, 1, "Should remain 1 transaction");
  console.log("  ✓ Test 2 Passed: Immediate duplicate push notification rejected");
}

// Test 3: SMS with Ref No arriving 5 seconds after push notification UPGRADES the draft
{
  const state = { txns: [] };
  const pushText = "You have received PHP 213.00 from GA***...";
  const smsText = "You have received 213.00 PHP of GCash from GA***... on 07/31/26 13:00. Ref No. 901238471.";

  engine.ingestGcash(state, pushText, 1000000);
  const smsRes = engine.ingestGcash(state, smsText, 1000000 + 5000); // 5 seconds later

  assert.strictEqual(smsRes.ok, true, "SMS should ingest successfully");
  assert.strictEqual(smsRes.upgraded, true, "SMS should upgrade existing draft transaction");
  assert.strictEqual(state.txns.length, 1, "Should still be only 1 transaction (no duplicate!)");
  assert.strictEqual(state.txns[0].id, "gcash-901238471", "Transaction ID should be upgraded to gcash-901238471");
  assert.strictEqual(state.txns[0].ref, "901238471", "Ref should be set to 901238471");
  console.log("  ✓ Test 3 Passed: Immediate SMS upgrades push draft in-place");
}

// Test 4: SMS with Ref No arriving 2 hours later UPGRADES the draft
{
  const state = { txns: [] };
  const pushText = "You have received PHP 213.00 from GA***...";
  const smsText = "You have received 213.00 PHP of GCash from GA***... Ref No. 901238471.";

  engine.ingestGcash(state, pushText, 1000000);
  const delayedSmsRes = engine.ingestGcash(state, smsText, 1000000 + (2 * 3600 * 1000)); // 2 hours later

  assert.strictEqual(delayedSmsRes.ok, true, "Delayed SMS should ingest successfully");
  assert.strictEqual(delayedSmsRes.upgraded, true, "Delayed SMS should upgrade existing draft transaction");
  assert.strictEqual(state.txns.length, 1, "Should still be only 1 transaction after 2-hour delay");
  assert.strictEqual(state.txns[0].id, "gcash-901238471");
  console.log("  ✓ Test 4 Passed: Delayed SMS (2 hours later) upgrades push draft in-place");
}

// Test 5: Duplicate SMS with same Ref No is rejected
{
  const state = { txns: [] };
  const smsText = "You have received 213.00 PHP of GCash from GA***... Ref No. 901238471.";

  engine.ingestGcash(state, smsText, 1000000);
  const dupSmsRes = engine.ingestGcash(state, smsText, 1000000 + 60000);

  assert.strictEqual(dupSmsRes.ok, false, "Duplicate SMS with same Ref No should be rejected");
  assert.strictEqual(dupSmsRes.reason, "duplicate");
  assert.strictEqual(state.txns.length, 1);
  console.log("  ✓ Test 5 Passed: Duplicate SMS with same Ref No rejected");
}

// Test 6: Two distinct payments with different Ref Nos on the same day are both saved
{
  const state = { txns: [] };
  const sms1 = "You have received 213.00 PHP of GCash from GA***... Ref No. 901238471.";
  const sms2 = "You have received 213.00 PHP of GCash from GA***... Ref No. 901238472.";

  engine.ingestGcash(state, sms1, 1000000);
  const sms2Res = engine.ingestGcash(state, sms2, 1000000 + 300000); // 5 mins later

  assert.strictEqual(sms2Res.ok, true, "Second distinct payment should ingest successfully");
  assert.strictEqual(state.txns.length, 2, "Should have 2 distinct transactions");
  assert.strictEqual(state.txns[0].id, "gcash-901238471");
  assert.strictEqual(state.txns[1].id, "gcash-901238472");
  console.log("  ✓ Test 6 Passed: Two distinct payments with different Ref Nos saved independently");
}

console.log("\n🎉 ALL GCASH DEDUPLICATION UNIT TESTS PASSED SUCCESSFULLY!\n");
