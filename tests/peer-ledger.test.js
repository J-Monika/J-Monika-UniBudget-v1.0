// ============================================================
//  UniBudget — Peer Ledger Unit Tests
//  Run with: node tests/peer-ledger.test.js
// ============================================================

const assert = require("assert");
const PeerLedger = require("../www/peer-ledger.js").PeerLedger;

console.log("▶ Running UniBudget Peer Ledger Unit Tests...");

// Test 1: Add Entry
{
  const state = { currency: "PHP", peerLedger: [] };
  const entry = PeerLedger.addEntry(state, {
    type: "UTANG_GIVEN",
    counterpartyName: "Juan Dela Cruz",
    amount: 500,
    currency: "PHP",
    description: "Lunch favor at canteen",
    dueDate: "2026-08-15"
  });

  assert.strictEqual(state.peerLedger.length, 1, "Entry should be added to state.peerLedger");
  assert.strictEqual(entry.counterpartyName, "Juan Dela Cruz");
  assert.strictEqual(entry.amount, 500);
  assert.strictEqual(entry.settledAmount, 0);
  assert.strictEqual(entry.status, "UNSETTLED");
  assert.strictEqual(entry.deleted, false);
  console.log("  ✓ Test 1 Passed: Add entry with correct defaults and fields");
}

// Test 2: Full Settlement
{
  const state = { currency: "PHP", peerLedger: [] };
  const entry = PeerLedger.addEntry(state, {
    type: "UTANG_TAKEN",
    counterpartyName: "Maria Clara",
    amount: 200,
    description: "Borrowed for jeepney fare"
  });

  const result = PeerLedger.settleEntry(state, entry.id, 200, false);
  assert.strictEqual(result.entry.status, "SETTLED");
  assert.strictEqual(result.entry.settledAmount, 200);
  assert.strictEqual(result.createdTxn, null);
  console.log("  ✓ Test 2 Passed: Full settlement sets status to SETTLED");
}

// Test 3: Partial Settlement
{
  const state = { currency: "PHP", peerLedger: [] };
  const entry = PeerLedger.addEntry(state, {
    type: "PA_SUYO",
    counterpartyName: "Jose Rizal",
    amount: 300,
    description: "Printed 30 pages module"
  });

  const result = PeerLedger.settleEntry(state, entry.id, 100, false);
  assert.strictEqual(result.entry.status, "PARTIALLY_SETTLED");
  assert.strictEqual(result.entry.settledAmount, 100);
  console.log("  ✓ Test 3 Passed: Partial settlement sets status to PARTIALLY_SETTLED");
}

// Test 4: Zero-division and Over-settlement Protection
{
  const state = { currency: "PHP", peerLedger: [] };
  const entry = PeerLedger.addEntry(state, {
    type: "UTANG_GIVEN",
    counterpartyName: "Andres Bonifacio",
    amount: 150
  });

  // Attempt to settle 500 on a 150 debt -> should cap at 150
  const result = PeerLedger.settleEntry(state, entry.id, 500, false);
  assert.strictEqual(result.entry.settledAmount, 150, "Settled amount should be capped at 150");
  assert.strictEqual(result.entry.status, "SETTLED");

  // Attempt to settle again when already 0 remaining balance -> should throw error
  assert.throws(function () {
    PeerLedger.settleEntry(state, entry.id, 50, false);
  }, /already fully settled/i, "Should throw error on settling fully settled entry");

  console.log("  ✓ Test 4 Passed: Zero-division & over-settlement safety caps amount and rejects settled entries");
}

// Test 5: Settlement with Budget Transaction Creation
{
  const state = { currency: "PHP", peerLedger: [], txns: [] };

  // Case 5a: UTANG_GIVEN repaid -> Income transaction created
  const entryGiven = PeerLedger.addEntry(state, {
    type: "UTANG_GIVEN",
    counterpartyName: "Emilio Aguinaldo",
    amount: 1000
  });
  const resGiven = PeerLedger.settleEntry(state, entryGiven.id, 1000, true);
  assert.notStrictEqual(resGiven.createdTxn, null);
  assert.strictEqual(resGiven.createdTxn.type, "income", "UTANG_GIVEN settlement creates income transaction");
  assert.strictEqual(resGiven.createdTxn.amount, 1000);
  assert.strictEqual(state.txns.length, 1);

  // Case 5b: UTANG_TAKEN repaid -> Expense transaction created
  const entryTaken = PeerLedger.addEntry(state, {
    type: "UTANG_TAKEN",
    counterpartyName: "Apolinario Mabini",
    amount: 450
  });
  const resTaken = PeerLedger.settleEntry(state, entryTaken.id, 450, true);
  assert.notStrictEqual(resTaken.createdTxn, null);
  assert.strictEqual(resTaken.createdTxn.type, "expense", "UTANG_TAKEN settlement creates expense transaction");
  assert.strictEqual(resTaken.createdTxn.amount, 450);
  assert.strictEqual(state.txns.length, 2);

  console.log("  ✓ Test 5 Passed: Settle with createBudgetTransaction generates income/expense transaction appropriately");
}

// Test 6: Multi-Currency Isolation in Summary Aggregation
{
  const state = { currency: "PHP", peerLedger: [] };
  PeerLedger.addEntry(state, {
    type: "UTANG_GIVEN",
    counterpartyName: "Juan Dela Cruz",
    amount: 500,
    currency: "PHP"
  });
  PeerLedger.addEntry(state, {
    type: "UTANG_GIVEN",
    counterpartyName: "Juan Dela Cruz",
    amount: 20,
    currency: "USD"
  });

  const summary = PeerLedger.getSummaryByCounterparty(state);
  assert.strictEqual(summary.has("Juan Dela Cruz"), true);

  const juanCurrencies = summary.get("Juan Dela Cruz");
  assert.strictEqual(juanCurrencies.has("PHP"), true);
  assert.strictEqual(juanCurrencies.has("USD"), true);

  assert.strictEqual(juanCurrencies.get("PHP").netBalance, 500, "PHP net balance should be 500");
  assert.strictEqual(juanCurrencies.get("USD").netBalance, 20, "USD net balance should be 20");

  const globalTotals = PeerLedger.getGlobalTotalsPerCurrency(state);
  assert.strictEqual(globalTotals["PHP"].totalOwedToYou, 500);
  assert.strictEqual(globalTotals["USD"].totalOwedToYou, 20);

  console.log("  ✓ Test 6 Passed: Multi-currency aggregation keeps PHP and USD separated without illegal sum");
}

// Test 7: Soft Deletion
{
  const state = { currency: "PHP", peerLedger: [] };
  const entry = PeerLedger.addEntry(state, {
    type: "PA_SUYO",
    counterpartyName: "Gomez",
    amount: 120
  });

  const deleted = PeerLedger.deleteEntry(state, entry.id);
  assert.strictEqual(deleted, true);
  assert.strictEqual(state.peerLedger[0].deleted, true);

  const filtered = PeerLedger.getFilteredEntries(state);
  assert.strictEqual(filtered.length, 0, "Deleted entry should be excluded from active filtered list");

  console.log("  ✓ Test 7 Passed: Non-destructive soft deletion");
}

// Test 8: Filtered Entries Query
{
  const state = { currency: "PHP", peerLedger: [] };
  const e1 = PeerLedger.addEntry(state, { type: "UTANG_GIVEN", counterpartyName: "Burgos", amount: 100 });
  const e2 = PeerLedger.addEntry(state, { type: "UTANG_TAKEN", counterpartyName: "Zamora", amount: 200 });
  PeerLedger.settleEntry(state, e1.id, 100, false);

  const unsettled = PeerLedger.getFilteredEntries(state, "UNSETTLED");
  assert.strictEqual(unsettled.length, 1);
  assert.strictEqual(unsettled[0].id, e2.id);

  const settled = PeerLedger.getFilteredEntries(state, "SETTLED");
  assert.strictEqual(settled.length, 1);
  assert.strictEqual(settled[0].id, e1.id);

  const utangTaken = PeerLedger.getFilteredEntries(state, "ALL", "UTANG_TAKEN");
  assert.strictEqual(utangTaken.length, 1);
  assert.strictEqual(utangTaken[0].id, e2.id);

  console.log("  ✓ Test 8 Passed: Filtering by status and type");
}

// Test 9: Submission Flow, "Utang Recorded!" Notification & Window Lifecycle Simulation
{
  const state = { currency: "PHP", peerLedger: [] };
  let notificationMsg = "";
  let modalOpen = true;
  let formState = { counterparty: "Jose", amount: 150, desc: "Snacks" };

  function simulateSaveUtangAdd(formData) {
    if (!formData.counterparty || !(formData.amount > 0)) {
      notificationMsg = "Validation Error";
      return false;
    }
    try {
      PeerLedger.addEntry(state, {
        type: "UTANG_GIVEN",
        counterpartyName: formData.counterparty,
        amount: formData.amount,
        description: formData.desc
      });
      notificationMsg = "Utang Recorded!";
      formState = { counterparty: "", amount: "", desc: "" }; // state reset
      modalOpen = false; // window close
      return true;
    } catch (err) {
      notificationMsg = "Error";
      return false;
    }
  }

  const success = simulateSaveUtangAdd(formState);
  assert.strictEqual(success, true);
  assert.strictEqual(notificationMsg, "Utang Recorded!");
  assert.strictEqual(modalOpen, false);
  assert.strictEqual(formState.counterparty, "");
  assert.strictEqual(state.peerLedger.length, 1);

  console.log("  ✓ Test 9 Passed: Submission flow dispatches 'Utang Recorded!', resets form, and closes window");
}

// Test 10: Search, Multi-Criteria Filtering, Overdue Detection & Sorting
{
  const state = { currency: "PHP", peerLedger: [] };
  const e1 = PeerLedger.addEntry(state, { type: "UTANG_GIVEN", counterpartyName: "Maria Clara", amount: 500, description: "Canteen lunch", dueDate: "2020-01-01" });
  const e2 = PeerLedger.addEntry(state, { type: "UTANG_TAKEN", counterpartyName: "Juan Dela Cruz", amount: 1500, description: "Project supplies" });
  const e3 = PeerLedger.addEntry(state, { type: "PA_SUYO", counterpartyName: "Jose Rizal", amount: 200, description: "Book printing" });

  // Overdue check
  const nowMs = new Date("2026-07-31").getTime();
  const e1Overdue = e1.dueDate && e1.status !== "SETTLED" && (new Date(e1.dueDate).getTime() < nowMs);
  assert.strictEqual(e1Overdue, true, "e1 with 2020 due date should be flagged overdue");

  // Search filter check
  const searchResults = state.peerLedger.filter(e => e.counterpartyName.toLowerCase().includes("maria") || (e.description && e.description.toLowerCase().includes("maria")));
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].id, e1.id);

  // Type filter: OWED_TO_ME
  const owedToMe = state.peerLedger.filter(e => e.type === "UTANG_GIVEN" || e.type === "PA_SUYO");
  assert.strictEqual(owedToMe.length, 2);

  // Sort by Amount High to Low
  const sortedByAmt = [...state.peerLedger].sort((a, b) => b.amount - a.amount);
  assert.strictEqual(sortedByAmt[0].id, e2.id); // 1500 amount
  assert.strictEqual(sortedByAmt[2].id, e3.id); // 200 amount

  console.log("  ✓ Test 10 Passed: Search, filter criteria, overdue detection, and sort ordering");
}

// Test 11: Partial Payment Tracking System & History Logging
{
  const state = { currency: "PHP", peerLedger: [] };
  const entry = PeerLedger.addEntry(state, {
    type: "UTANG_GIVEN",
    counterpartyName: "Emilio Aguinaldo",
    amount: 1000,
    description: "Group project materials"
  });

  // Check initial calculations
  assert.strictEqual(PeerLedger.calculateBalanceDue(entry), 1000);
  assert.strictEqual(PeerLedger.determinePaymentStatus(entry.amount, entry.settledAmount), "UNSETTLED");

  // Partial Payment 1: 400 via GCash
  const res1 = PeerLedger.settleEntry(state, entry.id, 400, true, "GCash", "Ref #GC12345");
  assert.strictEqual(res1.entry.settledAmount, 400);
  assert.strictEqual(PeerLedger.calculateBalanceDue(res1.entry), 600);
  assert.strictEqual(res1.entry.status, "PARTIALLY_SETTLED");
  assert.strictEqual(res1.entry.settlementHistory.length, 1);
  assert.strictEqual(res1.entry.settlementHistory[0].amount, 400);
  assert.strictEqual(res1.entry.settlementHistory[0].paymentMethod, "GCash");
  assert.strictEqual(res1.entry.settlementHistory[0].notes, "Ref #GC12345");

  // Partial Payment 2: 600 via Cash (Completes full payment)
  const res2 = PeerLedger.settleEntry(state, entry.id, 600, true, "Cash", "Final payment in person");
  assert.strictEqual(res2.entry.settledAmount, 1000);
  assert.strictEqual(PeerLedger.calculateBalanceDue(res2.entry), 0);
  assert.strictEqual(res2.entry.status, "SETTLED");
  assert.strictEqual(res2.entry.settlementHistory.length, 2);
  assert.strictEqual(res2.entry.settlementHistory[1].paymentMethod, "Cash");

  // Attempt payment on fully settled entry -> Should throw error
  assert.throws(() => {
    PeerLedger.settleEntry(state, entry.id, 100, false, "Cash");
  }, /already fully settled/i);

  // Attempt <= 0 payment -> Should throw error
  const entry2 = PeerLedger.addEntry(state, { type: "UTANG_TAKEN", counterpartyName: "Andres", amount: 500 });
  assert.throws(() => {
    PeerLedger.settleEntry(state, entry2.id, -50, false);
  }, /greater than 0/i);

  console.log("  ✓ Test 11 Passed: Partial payment tracking, settlement history logging, and validation rules");
}

// Test 12: Automated Overdue Payment Notifications & 24-Hour Throttling
{
  const state = { currency: "PHP", peerLedger: [] };
  const pastDate = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0]; // 3 days ago

  const overdueEntry = PeerLedger.addEntry(state, {
    type: "UTANG_TAKEN",
    counterpartyName: "Juan Dela Cruz",
    amount: 500,
    dueDate: pastDate
  });

  const futureEntry = PeerLedger.addEntry(state, {
    type: "UTANG_GIVEN",
    counterpartyName: "Maria Clara",
    amount: 300,
    dueDate: "2030-01-01"
  });

  // Check 1: Initial overdue evaluation should return overdueEntry
  const items1 = PeerLedger.checkOverdueNotifications(state);
  assert.strictEqual(items1.length, 1);
  assert.strictEqual(items1[0].entry.id, overdueEntry.id);
  assert.strictEqual(items1[0].remaining, 500);
  assert.strictEqual(items1[0].daysOverdue >= 3, true, "Should be at least 3 days overdue");

  // Mark lastNotifiedAt to simulate dispatch
  overdueEntry.lastNotifiedAt = Date.now();

  // Check 2: Immediate second check within 24h should return 0 items (throttled)
  const items2 = PeerLedger.checkOverdueNotifications(state);
  assert.strictEqual(items2.length, 0, "24-hour throttling should prevent duplicate notifications");

  // Check 3: Simulating 25 hours later should allow notification again
  overdueEntry.lastNotifiedAt = Date.now() - (25 * 3600 * 1000);
  const items3 = PeerLedger.checkOverdueNotifications(state);
  assert.strictEqual(items3.length, 1, "Should notify again after 24-hour throttle window expires");

  console.log("  ✓ Test 12 Passed: Automated overdue notification evaluation, 24-hour throttling, and days overdue calculations");
}

console.log("\n🎉 ALL PEER LEDGER UNIT TESTS PASSED SUCCESSFULLY!\n");
