(function (global) {
  "use strict";

  // ---------- Discretionary Category Utility ----------
  var DISCRETIONARY_CATEGORIES = {
    "Fun & Social": true,
    "Other": true
  };

  function isDiscretionaryCategory(category) {
    if (!category) return false;
    return !!DISCRETIONARY_CATEGORIES[category.trim()];
  }

  // ---------- Day Key Helper ----------
  function dayKey(ms) {
    var d = new Date(ms || Date.now());
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  // ---------- Level Calculation Formula ----------
  // Level = floor(1 + sqrt(XP / 50))
  function calculateLevel(xp) {
    if (!xp || xp < 0) return 1;
    return Math.floor(1 + Math.sqrt(xp / 50));
  }

  function xpForLevel(level) {
    var target = Math.max(1, level);
    return 50 * Math.pow(target - 1, 2);
  }

  function xpProgressInLevel(xp) {
    var currentLvl = calculateLevel(xp);
    var currentLvlBaseXp = xpForLevel(currentLvl);
    var nextLvlBaseXp = xpForLevel(currentLvl + 1);
    var xpInLvl = xp - currentLvlBaseXp;
    var xpNeeded = nextLvlBaseXp - currentLvlBaseXp;
    var pct = xpNeeded > 0 ? Math.min(100, Math.floor((xpInLvl / xpNeeded) * 100)) : 0;
    return {
      currentLevel: currentLvl,
      xpInLevel: xpInLvl,
      xpNeededForNext: xpNeeded,
      pct: pct
    };
  }

  function calculateBadgeProgress(currentValue, targetValue) {
    var target = typeof targetValue === "number" && targetValue > 0 ? targetValue : 1;
    var current = typeof currentValue === "number" ? Math.max(0, currentValue) : (currentValue ? 1 : 0);
    var pct = Math.min(100, Math.round((current / target) * 100));
    return {
      current: current,
      target: target,
      pct: pct,
      isUnlocked: pct >= 100
    };
  }

  // ---------- Refactored Tipid Streak Engine ----------
  // Evaluates spending in discretionary categories ("Fun & Social", "Other").
  // Essential categories (Rent, Food & Dining, Books, Transport, Load, Subs) do NOT break the streak.
  function calculateTipidStreak(transactions) {
    if (!Array.isArray(transactions)) return 0;

    var activeTxns = transactions.filter(function (t) {
      return !t.deleted && t.type === "expense";
    });

    var discretionaryByDay = {};
    activeTxns.forEach(function (t) {
      if (isDiscretionaryCategory(t.cat)) {
        var key = dayKey(t.ts);
        discretionaryByDay[key] = (discretionaryByDay[key] || 0) + (t.amount || 0);
      }
    });

    var streak = 0;
    var cursor = new Date();

    for (var i = 0; i < 365; i++) {
      var key = dayKey(cursor.getTime());
      var discTotal = discretionaryByDay[key] || 0;

      if (discTotal > 0) {
        // Discretionary spend occurred -> streak breaks!
        break;
      }

      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  }

  // ---------- State Reset & Migration ----------
  var RESET_KEY = "@gamification_v1_reset";
  var INITIAL_GAMIFICATION_STATE = {
    xp: 0,
    level: 1,
    streak: 0,           // Daily login streak (app open)
    tipidStreak: 0,      // Tipid streak (₱0 discretionary spend)
    lastActiveDate: null, // ISO YYYY-MM-DD
    unlockedAchievements: []
  };

  function runGamificationReset() {
    try {
      if (typeof localStorage !== "undefined" && !localStorage.getItem(RESET_KEY)) {
        localStorage.removeItem("@user_level");
        localStorage.removeItem("@user_xp");
        localStorage.removeItem("@user_rewards");
        localStorage.setItem(RESET_KEY, "true");
      }
    } catch (e) {}
  }

  // ---------- XP Actions & Values ----------
  var XP_REWARDS = {
    "ADD_TRANSACTION": 10,
    "CONNECT_WALLETS": 30,
    "CREATE_BUDGET": 20,
    "DAILY_LOGIN": 15,
    "AUTO_TRANSACTION": 4
  };

  // ---------- Core Engine API ----------
  var GamificationEngine = {
    INITIAL_STATE: INITIAL_GAMIFICATION_STATE,
    isDiscretionaryCategory: isDiscretionaryCategory,
    calculateLevel: calculateLevel,
    xpForLevel: xpForLevel,
    xpProgressInLevel: xpProgressInLevel,
    calculateBadgeProgress: calculateBadgeProgress,
    calculateTipidStreak: calculateTipidStreak,
    runReset: runGamificationReset,

    normalizeGamificationState: function (g) {
      if (!g || typeof g !== "object") return Object.assign({}, INITIAL_GAMIFICATION_STATE);
      return {
        xp: typeof g.xp === "number" ? Math.max(0, g.xp) : 0,
        level: typeof g.level === "number" ? Math.max(1, g.level) : calculateLevel(g.xp || 0),
        streak: typeof g.streak === "number" ? Math.max(0, g.streak) : 0,
        tipidStreak: typeof g.tipidStreak === "number" ? Math.max(0, g.tipidStreak) : 0,
        lastActiveDate: typeof g.lastActiveDate === "string" ? g.lastActiveDate : null,
        unlockedAchievements: Array.isArray(g.unlockedAchievements) ? g.unlockedAchievements : []
      };
    },

    // Daily login evaluation on app boot
    dailyLoginCheck: function (state) {
      if (!state) return false;
      state.gamification = this.normalizeGamificationState(state.gamification);

      var todayStr = new Date().toISOString().split("T")[0];
      var lastStr = state.gamification.lastActiveDate;

      if (lastStr === todayStr) {
        return false; // Already logged in today
      }

      if (lastStr) {
        var lastMs = new Date(lastStr).getTime();
        var nowMs = new Date(todayStr).getTime();
        var diffHours = (nowMs - lastMs) / (1000 * 60 * 60);

        if (diffHours <= 36) {
          state.gamification.streak += 1;
        } else if (diffHours > 48) {
          state.gamification.streak = 1;
        } else {
          state.gamification.streak += 1;
        }
      } else {
        state.gamification.streak = 1;
      }

      state.gamification.lastActiveDate = todayStr;
      this.awardXp(state, "DAILY_LOGIN");
      return true;
    },

    // Award XP dispatcher
    awardXp: function (state, action) {
      if (!state) return 0;
      state.gamification = this.normalizeGamificationState(state.gamification);

      var reward = XP_REWARDS[action] || 0;
      if (reward <= 0) return 0;

      state.gamification.xp += reward;
      var newLvl = calculateLevel(state.gamification.xp);
      state.gamification.level = newLvl;

      return reward;
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { GamificationEngine: GamificationEngine };
  }
  if (global) {
    global.GamificationEngine = GamificationEngine;
  }
})(typeof window !== "undefined" ? window : global);
