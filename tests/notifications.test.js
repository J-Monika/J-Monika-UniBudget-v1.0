// ============================================================
//  UniBudget — Flexible Notification System Unit Tests
//  Run with: node tests/notifications.test.js or npm test
// ============================================================

const assert = require("assert");

// Helper function to build notification engine logic pure for test runner
function createNotificationEngine() {
  const DEFAULT_THRESHOLDS = [
    { id: "t-75-total", category: "Total", type: "percentage", value: 75, is_active: true },
    { id: "t-100-total", category: "Total", type: "percentage", value: 100, is_active: true }
  ];

  function normalizeNotifications(notif) {
    if (!notif || typeof notif !== "object") {
      notif = {};
    }
    if (typeof notif.enabled !== "boolean") notif.enabled = true;
    if (!Array.isArray(notif.thresholds) || notif.thresholds.length === 0) {
      notif.thresholds = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
    }
    if (!notif.triggered_alerts || typeof notif.triggered_alerts !== "object") {
      notif.triggered_alerts = {};
    }
    return notif;
  }

  function calculateTotals(txns, limits) {
    const active = (txns || []).filter(t => !t.deleted);
    let totalSpent = 0;
    const perCatSpent = {};

    active.forEach(t => {
      if (t.type === "expense") {
        totalSpent += t.amount;
        perCatSpent[t.cat] = (perCatSpent[t.cat] || 0) + t.amount;
      }
    });

    let totalBudget = 0;
    if (limits && Object.keys(limits).length) {
      totalBudget = Object.values(limits).reduce((acc, val) => acc + (val || 0), 0);
    }

    return { totalSpent, totalBudget, perCatSpent };
  }

  function evaluateThreshold(t, spent, budget) {
    if (!t.is_active) return { met: false };
    if (!(budget > 0) && t.type === "percentage") return { met: false };

    if (t.type === "percentage") {
      const currentPct = (spent / budget) * 100;
      if (currentPct >= t.value) {
        return {
          met: true,
          percentage: Math.round(currentPct),
          spent,
          budget,
          message: currentPct >= 100
            ? `Alert: You have reached/exceeded your budget of ₱${budget.toFixed(2)} for ${t.category}.`
            : `You've used ${Math.round(currentPct)}% (₱${spent.toFixed(2)}) of your ₱${budget.toFixed(2)} budget for ${t.category}.`
        };
      }
    } else if (t.type === "amount_spent") {
      if (spent >= t.value) {
        return {
          met: true,
          spent,
          budget,
          message: `Spending alert: Total spending for ${t.category} reached ₱${spent.toFixed(2)} (Threshold: ₱${t.value.toFixed(2)}).`
        };
      }
    } else if (t.type === "amount_remaining") {
      const remaining = budget - spent;
      if (remaining <= t.value) {
        return {
          met: true,
          spent,
          budget,
          remaining,
          message: `Remaining budget alert: Only ₱${Math.max(0, remaining).toFixed(2)} remaining for ${t.category} (Threshold: ₱${t.value.toFixed(2)}).`
        };
      }
    }
    return { met: false };
  }

  function checkNotifications(state) {
    state.notifications = normalizeNotifications(state.notifications);
    const notif = state.notifications;
    const firedAlerts = [];

    // Master toggle check
    if (!notif.enabled) {
      return { firedAlerts, notificationsState: notif };
    }

    const { totalSpent, totalBudget, perCatSpent } = calculateTotals(state.txns, state.limits);

    // Evaluate each threshold
    notif.thresholds.forEach(t => {
      const cat = t.category || "Total";
      let spent = 0;
      let budget = 0;

      if (cat === "Total") {
        spent = totalSpent;
        budget = totalBudget;
      } else {
        spent = perCatSpent[cat] || 0;
        budget = (state.limits && state.limits[cat]) || 0;
      }

      const res = evaluateThreshold(t, spent, budget);

      if (res.met) {
        // Only trigger if not already triggered in current state
        if (!notif.triggered_alerts[t.id]) {
          notif.triggered_alerts[t.id] = Date.now();
          firedAlerts.push({
            thresholdId: t.id,
            category: cat,
            type: t.type,
            value: t.value,
            message: res.message
          });
        }
      } else {
        // RESET HANDLING: If spending dropped back below threshold, clear triggered state
        if (notif.triggered_alerts[t.id]) {
          delete notif.triggered_alerts[t.id];
        }
      }
    });

    return { firedAlerts, notificationsState: notif };
  }

  return { normalizeNotifications, checkNotifications, DEFAULT_THRESHOLDS };
}

// ============================================================
//  Test Suite Execution
// ============================================================

console.log("▶ Running UniBudget Notification System Unit Tests...");

const engine = createNotificationEngine();

// Test 1: Default threshold trigger at 75% and 100%
{
  const state = {
    limits: { "Food & Dining": 1000 },
    txns: [
      { id: "1", type: "expense", cat: "Food & Dining", amount: 750, deleted: false }
    ],
    notifications: null
  };

  const res1 = engine.checkNotifications(state);
  assert.strictEqual(res1.firedAlerts.length, 1, "Should fire 75% total warning");
  assert.strictEqual(res1.firedAlerts[0].thresholdId, "t-75-total");
  assert(res1.firedAlerts[0].message.includes("75%"), "Message should contain 75%");

  // Repeat check with same state -> should prevent duplicate alert
  const res2 = engine.checkNotifications(state);
  assert.strictEqual(res2.firedAlerts.length, 0, "Duplicate check should not fire alert twice");
  console.log("  ✓ Test 1 Passed: 75% warning trigger and duplicate prevention");
}

// Test 2: Crossing 100% threshold
{
  const state = {
    limits: { "Food & Dining": 1000 },
    txns: [
      { id: "1", type: "expense", cat: "Food & Dining", amount: 750, deleted: false }
    ],
    notifications: null
  };

  engine.checkNotifications(state); // Fire 75% alert first
  state.txns.push({ id: "2", type: "expense", cat: "Food & Dining", amount: 300, deleted: false }); // total spent 1050

  const res = engine.checkNotifications(state);
  assert.strictEqual(res.firedAlerts.length, 1, "Should fire 100% threshold alert");
  assert.strictEqual(res.firedAlerts[0].thresholdId, "t-100-total");
  assert(res.firedAlerts[0].message.includes("exceeded your budget"), "Message should cite limit exceeded");
  console.log("  ✓ Test 2 Passed: 100% threshold trigger");
}

// Test 3: Single transaction jump from <75% to >100%
{
  const state = {
    limits: { "Rent & Utilities": 1000 },
    txns: [
      { id: "1", type: "expense", cat: "Rent & Utilities", amount: 1200, deleted: false }
    ],
    notifications: null
  };

  const res = engine.checkNotifications(state);
  assert.strictEqual(res.firedAlerts.length, 2, "Single large transaction crossing multiple thresholds should trigger both applicable warnings");
  const thresholdIds = res.firedAlerts.map(a => a.thresholdId);
  assert(thresholdIds.includes("t-75-total") && thresholdIds.includes("t-100-total"), "Both 75% and 100% alerts fired");
  console.log("  ✓ Test 3 Passed: Multi-threshold single-transaction jump handling");
}

// Test 4: Custom threshold types (Percentage, Amount Spent, Amount Remaining)
{
  const state = {
    limits: { "Load & Data": 500 },
    txns: [],
    notifications: {
      enabled: true,
      thresholds: [
        { id: "c-custom-cat", category: "Load & Data", type: "percentage", value: 80, is_active: true },
        { id: "c-fixed-spent", category: "Total", type: "amount_spent", value: 400, is_active: true },
        { id: "c-rem-budget", category: "Load & Data", type: "amount_remaining", value: 100, is_active: true }
      ],
      triggered_alerts: {}
    }
  };

  state.txns.push({ id: "1", type: "expense", cat: "Load & Data", amount: 420, deleted: false });
  const res = engine.checkNotifications(state);
  assert.strictEqual(res.firedAlerts.length, 3, "All 3 custom threshold types should fire when criteria met");
  console.log("  ✓ Test 4 Passed: Custom threshold types (percentage, amount_spent, amount_remaining)");
}

// Test 5: Expense deletion resets triggered threshold state
{
  const state = {
    limits: { "Food & Dining": 1000 },
    txns: [
      { id: "1", type: "expense", cat: "Food & Dining", amount: 800, deleted: false }
    ],
    notifications: null
  };

  const res1 = engine.checkNotifications(state);
  assert.strictEqual(res1.firedAlerts.length, 1, "Fires 75% alert initially");
  assert(state.notifications.triggered_alerts["t-75-total"], "Alert marked triggered");

  // Soft-delete transaction
  state.txns[0].deleted = true;
  const res2 = engine.checkNotifications(state);
  assert.strictEqual(res2.firedAlerts.length, 0, "No new alert fired on deletion");
  assert.strictEqual(state.notifications.triggered_alerts["t-75-total"], undefined, "Triggered alert state reset after spend drops below threshold");

  // Re-add transaction -> alert fires again
  state.txns.push({ id: "2", type: "expense", cat: "Food & Dining", amount: 850, deleted: false });
  const res3 = engine.checkNotifications(state);
  assert.strictEqual(res3.firedAlerts.length, 1, "Alert fires again when spending re-crosses threshold");
  console.log("  ✓ Test 5 Passed: Expense deletion threshold state reset and re-trigger");
}

// Test 6: Master and granular threshold toggles
{
  const state = {
    limits: { "Food & Dining": 1000 },
    txns: [
      { id: "1", type: "expense", cat: "Food & Dining", amount: 800, deleted: false }
    ],
    notifications: {
      enabled: false, // Master disabled
      thresholds: [
        { id: "t-75-total", category: "Total", type: "percentage", value: 75, is_active: true }
      ],
      triggered_alerts: {}
    }
  };

  const res1 = engine.checkNotifications(state);
  assert.strictEqual(res1.firedAlerts.length, 0, "Master toggle disabled prevents all alerts");

  state.notifications.enabled = true;
  state.notifications.thresholds[0].is_active = false; // Granular disabled
  const res2 = engine.checkNotifications(state);
  assert.strictEqual(res2.firedAlerts.length, 0, "Inactive individual threshold does not fire");

  console.log("  ✓ Test 6 Passed: Master and granular threshold toggles enforced");
}

console.log("\n🎉 ALL NOTIFICATION UNIT TESTS PASSED SUCCESSFULLY!\n");
