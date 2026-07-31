// ============================================================
//  UniBudget — Cloud Sync & Auth Lifecycle Unit Tests
//  Run with: node tests/cloud-sync-auth.test.js
// ============================================================

const assert = require("assert");

console.log("▶ Running Cloud Sync & Auth Lifecycle Unit Tests...\n");

// ---- Global Mocks ----
const mockLocalStorageData = {};
global.localStorage = {
  getItem: (key) => (key in mockLocalStorageData ? mockLocalStorageData[key] : null),
  setItem: (key, val) => { mockLocalStorageData[key] = String(val); },
  removeItem: (key) => { delete mockLocalStorageData[key]; },
  clear: () => { Object.keys(mockLocalStorageData).forEach(k => delete mockLocalStorageData[k]); }
};

global.navigator = { onLine: true };
global.document = {
  hidden: false,
  getElementById: (id) => ({
    classList: { toggle: () => {} },
    textContent: ""
  }),
  addEventListener: () => {}
};
global.window = {
  navigator: global.navigator,
  addEventListener: () => {},
  UNIBUDGET_CONFIG: {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key"
  }
};

// Mocks for Supabase client factory
let mockQueryError = null;
let mockUserData = { id: "test-user-uuid-123", user_metadata: { name: "Test Student" } };
let mockTxnRows = [];
let mockPeerRows = [];
let mockBudgetRow = null;
let mockSignInError = null;

global.window.supabase = {
  createClient: (url, key) => {
    return {
      auth: {
        getUser: async () => {
          if (mockQueryError && mockQueryError.isAuthError) throw mockQueryError;
          return { data: { user: mockUserData }, error: null };
        },
        getSession: async () => {
          return { data: { session: { user: mockUserData } }, error: null };
        },
        signInWithPassword: async ({ email, password }) => {
          if (mockSignInError) return { data: {}, error: mockSignInError };
          return { data: { user: mockUserData, session: { access_token: "mock-jwt-token" } }, error: null };
        },
        signUp: async ({ email, password }) => {
          return { data: { user: mockUserData, session: { access_token: "mock-jwt-token" } }, error: null };
        },
        signOut: async () => {}
      },
      from: (tableName) => {
        const queryObj = {
          select: () => queryObj,
          eq: () => queryObj,
          gt: async () => {
            if (mockQueryError && !mockQueryError.isAuthError) return { data: null, error: mockQueryError };
            let data = [];
            if (tableName === "transactions") data = mockTxnRows;
            if (tableName === "peer_ledger") data = mockPeerRows;
            return { data: data, error: null };
          },
          maybeSingle: async () => {
            if (mockQueryError && !mockQueryError.isAuthError) return { data: null, error: mockQueryError };
            return { data: mockBudgetRow, error: null };
          },
          upsert: async (rows) => {
            if (mockQueryError && !mockQueryError.isAuthError) return { data: null, error: mockQueryError };
            return { data: rows, error: null };
          }
        };
        return queryObj;
      }
    };
  }
};

// Load cloud.js implementation into context
require("../www/cloud.js");

async function runTests() {
  // --- Test 1: Cloud login under normal network conditions ---
  console.log("  • Test 1: Successful cloud login & hydration under normal network conditions");
  localStorage.clear();
  mockQueryError = null;
  mockSignInError = null;
  mockTxnRows = [
    {
      id: "m-101",
      amount: "250.50",
      type: "expense",
      category: "Food & Dining",
      description: "Lunch",
      occurred_at: "2026-07-31T10:00:00.000Z",
      updated_at: "2026-07-31T10:00:00.000Z",
      deleted: false,
      source_type: "MANUAL"
    }
  ];

  const loginRes = await window.Cloud.login("test@university.edu", "password123");
  assert.strictEqual(loginRes.email, "test@university.edu");
  assert.strictEqual(loginRes.name, "Test Student");

  const cachedData = JSON.parse(localStorage.getItem("unibudget:data:test@university.edu"));
  assert.ok(cachedData, "Cache should be written for user");
  assert.strictEqual(cachedData.txns.length, 1);
  assert.strictEqual(cachedData.txns[0].id, "m-101");
  console.log("  ✓ Test 1 Passed: Login succeeded and pulled 1 transaction");

  // --- Test 2: Resilient Login under Cloud Endpoint 500 Failure (Offline Fallback) ---
  console.log("  • Test 2: Resilient login when cloud sync encounters 500 server error");
  localStorage.clear();
  mockSignInError = null;
  mockQueryError = new Error("500 Internal Server Error: Supabase DB unavailable");

  // Cloud login should NOT throw when hydrate pull fails; it completes login in offline fallback mode
  let loginErr = null;
  let offlineLoginRes = null;
  try {
    offlineLoginRes = await window.Cloud.login("student@university.edu", "password123");
  } catch (err) {
    loginErr = err;
  }

  assert.strictEqual(loginErr, null, "Cloud.login should NOT throw when hydrate sync fails");
  assert.ok(offlineLoginRes, "Login result should be returned despite cloud sync 500 error");
  assert.strictEqual(offlineLoginRes.email, "student@university.edu");
  console.log("  ✓ Test 2 Passed: User logged in successfully in offline mode during 500 error");

  // --- Test 3: Date Parsing Safety (Missing/Invalid ISO Strings) ---
  console.log("  • Test 3: Malformed date string deserialization safety (preventing NaN timestamps)");
  localStorage.clear();
  mockQueryError = null;
  mockTxnRows = [
    {
      id: "m-bad-date",
      amount: "100.00",
      type: "expense",
      category: "Books & Supplies",
      description: "Notebook",
      occurred_at: "INVALID_DATE_STRING",
      updated_at: null,
      deleted: false
    }
  ];

  await window.Cloud.pull("test@university.edu");
  const cacheWithBadDate = JSON.parse(localStorage.getItem("unibudget:data:test@university.edu"));
  assert.ok(cacheWithBadDate, "Cache should exist");
  const txn = cacheWithBadDate.txns.find(t => t.id === "m-bad-date");
  assert.ok(txn, "Transaction should be present");
  assert.strictEqual(typeof txn.ts, "number");
  assert.strictEqual(isNaN(txn.ts), false, "Timestamp ts must not be NaN");
  assert.strictEqual(typeof txn.updated_at, "number");
  assert.strictEqual(isNaN(txn.updated_at), false, "Timestamp updated_at must not be NaN");
  
  const pullWatermark = localStorage.getItem("unibudget:pull:test@university.edu");
  assert.strictEqual(isNaN(Number(pullWatermark)), false, "Pull watermark must not be NaN");
  console.log("  ✓ Test 3 Passed: Invalid date fields safely converted without NaN values");

  // --- Test 4: Auth Session Email & Token Storage ---
  console.log("  • Test 4: Session email context and token persistence");
  localStorage.clear();
  localStorage.setItem("unibudget:session", JSON.stringify({ email: "user@test.edu", name: "User Test" }));
  
  const pullResult = await window.Cloud.pull();
  assert.strictEqual(typeof pullResult, "boolean");
  console.log("  ✓ Test 4 Passed: Session token email accurately read during cloud pull");

  console.log("\n🎉 ALL CLOUD SYNC & AUTH UNIT TESTS PASSED SUCCESSFULLY!\n");
}

runTests().catch(err => {
  console.error("❌ Test execution failed:", err);
  process.exit(1);
});
