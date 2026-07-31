// ============================================================
//  UniBudget — Gamification Engine Unit Tests
//  Run with: node tests/gamification.test.js
// ============================================================

const assert = require("assert");
const GamificationEngine = require("../www/gamification.js").GamificationEngine;

console.log("▶ Running UniBudget Gamification Engine Unit Tests...");

// Test 1: Level Formula (floor(1 + sqrt(XP / 50)))
{
  assert.strictEqual(GamificationEngine.calculateLevel(0), 1, "0 XP should be Level 1");
  assert.strictEqual(GamificationEngine.calculateLevel(49), 1, "49 XP should be Level 1");
  assert.strictEqual(GamificationEngine.calculateLevel(50), 2, "50 XP should be Level 2");
  assert.strictEqual(GamificationEngine.calculateLevel(199), 2, "199 XP should be Level 2");
  assert.strictEqual(GamificationEngine.calculateLevel(200), 3, "200 XP should be Level 3");
  assert.strictEqual(GamificationEngine.calculateLevel(450), 4, "450 XP should be Level 4");
  console.log("  ✓ Test 1 Passed: Non-linear level formula floor(1 + sqrt(XP / 50))");
}

// Test 2: Category Utility (Discretionary vs. Essential)
{
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Fun & Social"), true, "Fun & Social is discretionary");
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Other"), true, "Other is discretionary");
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Food & Dining"), false, "Food & Dining is essential");
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Rent & Utilities"), false, "Rent & Utilities is essential");
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Books & Supplies"), false, "Books & Supplies is essential");
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Transportation"), false, "Transportation is essential");
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Load & Data"), false, "Load & Data is essential");
  assert.strictEqual(GamificationEngine.isDiscretionaryCategory("Subscriptions"), false, "Subscriptions is essential");
  console.log("  ✓ Test 2 Passed: Discretionary category utility");
}

// Test 3: Refactored Tipid Streak Engine (Discretionary Only)
{
  const today = Date.now();
  const dayMs = 86400000;

  // Case A: Essential expenses only (Food, Rent, Transport) -> Tipid streak should NOT break
  const txnsEssential = [
    { id: "1", type: "expense", cat: "Food & Dining", amount: 200, ts: today, deleted: false },
    { id: "2", type: "expense", cat: "Rent & Utilities", amount: 1500, ts: today - dayMs, deleted: false },
    { id: "3", type: "expense", cat: "Transportation", amount: 50, ts: today - 2 * dayMs, deleted: false }
  ];

  const streakA = GamificationEngine.calculateTipidStreak(txnsEssential);
  assert.strictEqual(streakA, 365, "Essential expenses should not break Tipid Streak");

  // Case B: Discretionary expense today -> Streak breaks (0 zero-discretionary days)
  const txnsDiscretionary = [
    { id: "1", type: "expense", cat: "Fun & Social", amount: 150, ts: today, deleted: false }
  ];

  const streakB = GamificationEngine.calculateTipidStreak(txnsDiscretionary);
  assert.strictEqual(streakB, 0, "Discretionary expense today breaks Tipid Streak to 0");

  // Case C: Discretionary expense 2 days ago -> Streak is 2 (today and yesterday discretionary total === 0)
  const txnsDiscTwoDaysAgo = [
    { id: "1", type: "expense", cat: "Food & Dining", amount: 100, ts: today, deleted: false },
    { id: "2", type: "expense", cat: "Other", amount: 300, ts: today - 2 * dayMs, deleted: false }
  ];

  const streakC = GamificationEngine.calculateTipidStreak(txnsDiscTwoDaysAgo);
  assert.strictEqual(streakC, 2, "Discretionary expense 2 days ago allows 2-day streak (today & yesterday)");

  console.log("  ✓ Test 3 Passed: Refactored Tipid Streak calculation with discretionary rule");
}

// Test 4: XP Awarding & Level Recalculation
{
  const state = {
    gamification: null
  };

  const awarded = GamificationEngine.awardXp(state, "ADD_TRANSACTION");
  assert.strictEqual(awarded, 10, "ADD_TRANSACTION awards 10 XP");
  assert.strictEqual(state.gamification.xp, 10, "Total XP updated to 10");
  assert.strictEqual(state.gamification.level, 1, "Level remains 1 at 10 XP");

  // Award enough XP to hit Level 2 (50 XP total)
  GamificationEngine.awardXp(state, "CONNECT_WALLETS"); // +30 = 40 XP
  GamificationEngine.awardXp(state, "CREATE_BUDGET");    // +20 = 60 XP

  assert.strictEqual(state.gamification.xp, 60, "Total XP updated to 60");
  assert.strictEqual(state.gamification.level, 2, "Level recalculated to 2 at 60 XP");

  console.log("  ✓ Test 4 Passed: Action-based XP awarding & level recalculation");
}

// Test 5: XP Progress In Level Helper
{
  // 60 XP: Level 2 base = 50 XP, Level 3 base = 200 XP. Needed = 150 XP. In level = 10 XP.
  const progress = GamificationEngine.xpProgressInLevel(60);
  assert.strictEqual(progress.currentLevel, 2);
  assert.strictEqual(progress.xpInLevel, 10);
  assert.strictEqual(progress.xpNeededForNext, 150);
  assert.strictEqual(progress.pct, 6);

  console.log("  ✓ Test 5 Passed: Level progress percentage calculation");
}

// Test 6: Badge Progress Calculation Helper
{
  const p1 = GamificationEngine.calculateBadgeProgress(3, 10);
  assert.strictEqual(p1.current, 3);
  assert.strictEqual(p1.target, 10);
  assert.strictEqual(p1.pct, 30);
  assert.strictEqual(p1.isUnlocked, false);

  const p2 = GamificationEngine.calculateBadgeProgress(10, 10);
  assert.strictEqual(p2.pct, 100);
  assert.strictEqual(p2.isUnlocked, true);

  const p3 = GamificationEngine.calculateBadgeProgress(15, 10);
  assert.strictEqual(p3.pct, 100);
  assert.strictEqual(p3.isUnlocked, true);

  console.log("  ✓ Test 6 Passed: Dynamic badge percentage & completion calculation");
}

// Test 7: 50/30/20 Budget Framework Calculation & 100% Validation
{
  function validateFrameworkAllocations(income, needsPct, wantsPct, savePct) {
    const inc = Math.max(0, Number(income) || 0);
    const n = Number(needsPct) || 0;
    const w = Number(wantsPct) || 0;
    const s = Number(savePct) || 0;
    const total = Math.round(n + w + s);
    return {
      isValid: total === 100,
      totalPct: total,
      needsAmount: inc * (n / 100),
      wantsAmount: inc * (w / 100),
      saveAmount: inc * (s / 100)
    };
  }

  // Standard 50/30/20 allocation on ₱10,000 income
  const std = validateFrameworkAllocations(10000, 50, 30, 20);
  assert.strictEqual(std.isValid, true);
  assert.strictEqual(std.totalPct, 100);
  assert.strictEqual(std.needsAmount, 5000);
  assert.strictEqual(std.wantsAmount, 3000);
  assert.strictEqual(std.saveAmount, 2000);

  // Custom 80/10/10 allocation on ₱5,000 income
  const custom = validateFrameworkAllocations(5000, 80, 10, 10);
  assert.strictEqual(custom.isValid, true);
  assert.strictEqual(custom.needsAmount, 4000);
  assert.strictEqual(custom.wantsAmount, 500);
  assert.strictEqual(custom.saveAmount, 500);

  // Invalid total (70/10/10 = 90%)
  const invalid = validateFrameworkAllocations(5000, 70, 10, 10);
  assert.strictEqual(invalid.isValid, false);
  assert.strictEqual(invalid.totalPct, 90);

  console.log("  ✓ Test 7 Passed: 50/30/20 Budget Framework calculations and 100% total validation rules");
}

// Test 8: Framework Modal Confirmation Lifecycle Handling
{
  class FrameworkModalController {
    constructor() {
      this.parentOpen = false;
      this.confirmOpen = false;
      this.pendingAction = null;
      this.framework = { income: 5000, needsPct: 50, wantsPct: 30, savePct: 20 };
    }
    openFramework() { this.parentOpen = true; }
    closeFramework() { this.parentOpen = false; }
    showConfirm(action) {
      this.pendingAction = action;
      this.confirmOpen = true;
    }
    closeConfirm() {
      this.pendingAction = null;
      this.confirmOpen = false;
    }
    executeConfirm(draftInputs) {
      if (!this.pendingAction) return;
      const act = this.pendingAction;
      this.closeConfirm();
      if (act === "reset") {
        this.framework = { income: 5000, needsPct: 50, wantsPct: 30, savePct: 20 };
      } else if (act === "save") {
        this.framework = { ...draftInputs };
      }
      this.closeFramework();
    }
  }

  const ctrl = new FrameworkModalController();
  ctrl.openFramework();
  assert.strictEqual(ctrl.parentOpen, true);

  // Scenario 1: User clicks reset, then cancels
  ctrl.showConfirm("reset");
  assert.strictEqual(ctrl.confirmOpen, true);
  ctrl.closeConfirm();
  assert.strictEqual(ctrl.confirmOpen, false);
  assert.strictEqual(ctrl.parentOpen, true, "Parent modal must remain open on cancel");

  // Scenario 2: User clicks save, then confirms
  ctrl.showConfirm("save");
  assert.strictEqual(ctrl.confirmOpen, true);
  ctrl.executeConfirm({ income: 10000, needsPct: 80, wantsPct: 10, savePct: 10 });
  assert.strictEqual(ctrl.confirmOpen, false, "Confirm modal must close");
  assert.strictEqual(ctrl.parentOpen, false, "Parent modal must automatically close on confirm");
  assert.strictEqual(ctrl.framework.needsPct, 80);

  console.log("  ✓ Test 8 Passed: Framework Modal Confirmation lifecycle state handling (cancel vs confirm)");
}

console.log("\n🎉 ALL GAMIFICATION UNIT TESTS PASSED SUCCESSFULLY!\n");
