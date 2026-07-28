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

console.log("\n🎉 ALL GAMIFICATION UNIT TESTS PASSED SUCCESSFULLY!\n");
