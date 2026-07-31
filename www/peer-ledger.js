// ============================================================
//  UniBudget — Peer Ledger (Utang / Pa-Suyo Tracker Engine)
//  Exposes window.PeerLedger. Manages micro-loans, peer debts,
//  and shared bills between classmates/friends.
// ============================================================
(function (global) {
  "use strict";

  /**
   * @typedef {'UTANG_GIVEN' | 'UTANG_TAKEN' | 'PA_SUYO'} PeerLedgerType
   * @typedef {'UNSETTLED' | 'PARTIALLY_SETTLED' | 'SETTLED'} PeerLedgerStatus
   *
   * @typedef {Object} PeerLedgerEntry
   * @property {string} id
   * @property {PeerLedgerType} type
   * @property {string} counterpartyName
   * @property {number} amount
   * @property {string} currency
   * @property {string} description
   * @property {PeerLedgerStatus} status
   * @property {number} settledAmount
   * @property {number|null} dueDate
   * @property {number} createdAt
   * @property {number} updatedAt
   * @property {boolean} deleted
   */

  function generateId() {
    return "pl-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  var PeerLedger = {
    /**
     * Calculates the remaining balance due for an entry.
     * @param {Object} entry
     * @returns {number}
     */
    calculateBalanceDue: function (entry) {
      if (!entry) return 0;
      var total = typeof entry.amount === "number" ? entry.amount : Number(entry.amount) || 0;
      var paid = typeof entry.settledAmount === "number" ? entry.settledAmount : Number(entry.settledAmount) || 0;
      return Math.max(0, Math.round((total - paid) * 100) / 100);
    },

    /**
     * Determines payment status dynamically based on total and paid amounts.
     * @param {number} total
     * @param {number} paid
     * @returns {PeerLedgerStatus}
     */
    determinePaymentStatus: function (total, paid) {
      if (!paid || paid <= 0) return "UNSETTLED";
      if (paid >= total) return "SETTLED";
      return "PARTIALLY_SETTLED";
    },

    /**
     * Ensures state has a valid peerLedger array.
     * @param {Object} state
     */
    normalizeState: function (state) {
      if (!state || typeof state !== "object") return;
      if (!Array.isArray(state.peerLedger)) {
        state.peerLedger = [];
      }
      var self = this;
      state.peerLedger.forEach(function (entry) {
        if (!entry.id) entry.id = generateId();
        if (typeof entry.amount !== "number") entry.amount = Number(entry.amount) || 0;
        if (typeof entry.settledAmount !== "number") entry.settledAmount = Number(entry.settledAmount) || 0;
        if (!entry.status) {
          entry.status = self.determinePaymentStatus(entry.amount, entry.settledAmount);
        }
        if (!Array.isArray(entry.settlementHistory)) entry.settlementHistory = [];
        if (typeof entry.createdAt !== "number") entry.createdAt = Date.now();
        if (typeof entry.updatedAt !== "number") entry.updatedAt = entry.createdAt;
        if (typeof entry.deleted !== "boolean") entry.deleted = false;
        if (!entry.currency) entry.currency = state.currency || "PHP";
        if (typeof entry.counterpartyName !== "string") entry.counterpartyName = "Unknown";
      });
    },

    /**
     * Adds a new Peer Ledger entry.
     * @param {Object} state
     * @param {Object} input
     * @returns {PeerLedgerEntry}
     */
    addEntry: function (state, input) {
      this.normalizeState(state);
      if (!input.counterpartyName || !input.counterpartyName.trim()) {
        throw new Error("Counterparty name is required.");
      }
      var amount = parseFloat(input.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Amount must be greater than 0.");
      }
      var validTypes = ["UTANG_GIVEN", "UTANG_TAKEN", "PA_SUYO"];
      if (validTypes.indexOf(input.type) === -1) {
        throw new Error("Invalid entry type.");
      }

      var now = Date.now();
      var entry = {
        id: generateId(),
        type: input.type,
        counterpartyName: input.counterpartyName.trim(),
        amount: Math.round(amount * 100) / 100,
        currency: input.currency || state.currency || "PHP",
        description: (input.description || "").trim(),
        status: "UNSETTLED",
        settledAmount: 0,
        settlementHistory: [],
        dueDate: input.dueDate ? new Date(input.dueDate).getTime() : null,
        createdAt: now,
        updatedAt: now,
        deleted: false
      };

      state.peerLedger.push(entry);
      return entry;
    },

    /**
     * Settles part or all of a peer debt entry.
     * Safe against zero-division and over-settlement.
     * @param {Object} state
     * @param {string} entryId
     * @param {number} payAmount
     * @param {boolean} createBudgetTransaction
     * @param {string} [paymentMethod]
     * @param {string} [notes]
     * @returns {{ entry: PeerLedgerEntry, createdTxn: Object|null, paymentRecord: Object }}
     */
    settleEntry: function (state, entryId, payAmount, createBudgetTransaction, paymentMethod, notes) {
      this.normalizeState(state);
      var entry = null;
      for (var i = 0; i < state.peerLedger.length; i++) {
        if (state.peerLedger[i].id === entryId && !state.peerLedger[i].deleted) {
          entry = state.peerLedger[i];
          break;
        }
      }
      if (!entry) {
        throw new Error("Entry not found.");
      }

      var remaining = this.calculateBalanceDue(entry);
      if (remaining <= 0 || entry.status === "SETTLED") {
        throw new Error("Entry is already fully settled.");
      }

      var amountToSettle = parseFloat(payAmount);
      if (isNaN(amountToSettle) || amountToSettle <= 0) {
        throw new Error("Payment amount must be greater than 0.");
      }

      // Zero-division / over-settlement safety: cap at remaining balance
      var actualSettle = Math.min(amountToSettle, remaining);
      actualSettle = Math.round(actualSettle * 100) / 100;

      entry.settledAmount = Math.round((entry.settledAmount + actualSettle) * 100) / 100;
      entry.status = this.determinePaymentStatus(entry.amount, entry.settledAmount);
      entry.updatedAt = Date.now();

      if (!Array.isArray(entry.settlementHistory)) entry.settlementHistory = [];
      var paymentRecord = {
        id: "pay-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        amount: actualSettle,
        paymentMethod: paymentMethod || "Cash",
        notes: (notes || "").trim(),
        timestamp: Date.now()
      };
      entry.settlementHistory.push(paymentRecord);

      var createdTxn = null;
      if (createBudgetTransaction) {
        if (!Array.isArray(state.txns)) state.txns = [];
        // Map ledger settlement to income or expense:
        // UTANG_GIVEN (they owe you) repaid -> income (+)
        // UTANG_TAKEN (you owe them) repaid -> expense (-)
        // PA_SUYO (you paid for them) repaid -> income (+)
        var txnType = (entry.type === "UTANG_TAKEN") ? "expense" : "income";
        var desc = "Utang Settlement (" + (paymentMethod || "Cash") + "): " + entry.counterpartyName + " (" + (entry.description || entry.type) + ")";

        createdTxn = {
          id: "m-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
          desc: desc,
          amount: actualSettle,
          type: txnType,
          cat: "Other",
          ts: Date.now(),
          updated_at: Date.now(),
          deleted: false,
          source: "peer-ledger-settlement"
        };
        state.txns.push(createdTxn);
      }

      return { entry: entry, createdTxn: createdTxn, paymentRecord: paymentRecord };
    },

    /**
     * Soft-deletes a peer ledger entry.
     * @param {Object} state
     * @param {string} entryId
     */
    deleteEntry: function (state, entryId) {
      this.normalizeState(state);
      for (var i = 0; i < state.peerLedger.length; i++) {
        if (state.peerLedger[i].id === entryId) {
          state.peerLedger[i].deleted = true;
          state.peerLedger[i].updatedAt = Date.now();
          return true;
        }
      }
      return false;
    },

    /**
     * Gets summary per counterparty grouped per currency.
     * Net Balance rules:
     *  - UTANG_GIVEN & PA_SUYO: Positively increases net balance (They owe you)
     *  - UTANG_TAKEN: Negatively decreases net balance (You owe them)
     * Keeps currencies strictly separated to avoid summing USD and PHP integers.
     * @param {Object} state
     * @returns {Map<string, Map<string, { netBalance: number, itemsCount: number, totalOwedToYou: number, totalYouOwe: number }>>}
     */
    getSummaryByCounterparty: function (state) {
      this.normalizeState(state);
      // Map<CounterpartyName, Map<CurrencyCode, Aggregation>>
      var summaryMap = new Map();

      state.peerLedger.forEach(function (entry) {
        if (entry.deleted) return;

        var cpName = entry.counterpartyName;
        var currency = entry.currency || "PHP";
        var remaining = Math.max(0, entry.amount - entry.settledAmount);

        if (!summaryMap.has(cpName)) {
          summaryMap.set(cpName, new Map());
        }
        var curMap = summaryMap.get(cpName);

        if (!curMap.has(currency)) {
          curMap.set(currency, {
            netBalance: 0,
            itemsCount: 0,
            totalOwedToYou: 0,
            totalYouOwe: 0
          });
        }

        var agg = curMap.get(currency);
        agg.itemsCount += 1;

        if (entry.type === "UTANG_GIVEN" || entry.type === "PA_SUYO") {
          agg.totalOwedToYou += remaining;
          agg.netBalance += remaining;
        } else if (entry.type === "UTANG_TAKEN") {
          agg.totalYouOwe += remaining;
          agg.netBalance -= remaining;
        }
      });

      return summaryMap;
    },

    /**
     * Gets global metrics separated per currency.
     * @param {Object} state
     * @returns {Object<string, { totalOwedToYou: number, totalYouOwe: number, netBalance: number }>}
     */
    getGlobalTotalsPerCurrency: function (state) {
      this.normalizeState(state);
      var totals = {};

      state.peerLedger.forEach(function (entry) {
        if (entry.deleted) return;
        var currency = entry.currency || state.currency || "PHP";
        var remaining = Math.max(0, entry.amount - entry.settledAmount);

        if (!totals[currency]) {
          totals[currency] = { totalOwedToYou: 0, totalYouOwe: 0, netBalance: 0 };
        }

        if (entry.type === "UTANG_GIVEN" || entry.type === "PA_SUYO") {
          totals[currency].totalOwedToYou += remaining;
          totals[currency].netBalance += remaining;
        } else if (entry.type === "UTANG_TAKEN") {
          totals[currency].totalYouOwe += remaining;
          totals[currency].netBalance -= remaining;
        }
      });

      return totals;
    },

    /**
     * Returns filtered active entries.
     * @param {Object} state
     * @param {string} [statusFilter]
     * @param {string} [typeFilter]
     * @returns {PeerLedgerEntry[]}
     */
    getFilteredEntries: function (state, statusFilter, typeFilter) {
      this.normalizeState(state);
      return state.peerLedger.filter(function (entry) {
        if (entry.deleted) return false;
        if (statusFilter && statusFilter !== "ALL" && entry.status !== statusFilter) return false;
        if (typeFilter && typeFilter !== "ALL" && entry.type !== typeFilter) return false;
        return true;
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PeerLedger: PeerLedger };
  }
  if (global) {
    global.PeerLedger = PeerLedger;
  }
})(typeof window !== "undefined" ? window : global);
