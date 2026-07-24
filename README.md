# UniBudget — Android app

A student budget tracker with **login/signup (Supabase cloud sync)** and **automatic GCash detection**: when GCash notifies you of money received or sent, the app parses it, logs the transaction, updates your budget, and sends you a notification — even when the app is closed.

A ready-to-install debug build is already here: **`UniBudget-debug.apk`**.
(It runs in offline *Device mode* until you add your Supabase keys and rebuild — see below.)

---

## What's in the project

```
UniBudget/
├─ UniBudget-debug.apk     ← installable build (sideload this to your phone)
├─ www/                    ← the app (HTML/CSS/JS)
│  ├─ index.html           ← UI + login/signup + budget logic
│  ├─ app-config.js        ← ⚙️ paste your Supabase keys here
│  ├─ cloud.js             ← Supabase auth + sync adapter
│  ├─ gcash-bridge.js      ← connects native capture → app + "Connect GCash" panel
│  └─ vendor/supabase.js   ← bundled Supabase client (no CDN needed)
├─ android/                ← native Android project
│  └─ app/src/main/java/com/unibudget/app/
│     ├─ GcashNotificationListener.java  ← reads GCash notifications
│     ├─ GcashSmsReceiver.java           ← reads GCash SMS
│     ├─ GcashCaptureStore.java          ← queue + system notification
│     ├─ GcashWatcherPlugin.java         ← native ↔ JS bridge + permissions
│     └─ MainActivity.java
├─ supabase-schema.sql     ← run once in Supabase
└─ capacitor.config.json
```

---

## 1) Set up Supabase (cloud accounts + sync)

1. Create a free project at **https://supabase.com** (New project → pick a name + database password → wait ~2 min).
2. **SQL Editor** → **New query** → paste all of **`supabase-schema.sql`** → **Run**.
3. **Authentication → Sign In / Providers → Email**: turn **"Confirm email" OFF** (so students can log in immediately without email verification). Leave it on if you prefer verified emails.
4. **Project Settings → API**, copy two values:
   - **Project URL**
   - **anon public** key
5. Open **`www/app-config.js`** and paste them in:
   ```js
   window.UNIBUDGET_CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi....(the long anon key)...."
   };
   ```
6. Re-sync + rebuild (see next section). Once keys are present the login screen shows **"☁ Cloud sync"** instead of "Device mode", and accounts + data sync across devices.

> No keys yet? The app still works fully — it just stores accounts and data on the device only.

---

## 2) Build the APK

Everything is already configured (`android/local.properties` points at your SDK). Two ways:

**A. Android Studio (easiest)**
```
npx cap open android
```
Wait for Gradle to finish, then **Build → Build Bundle(s)/APK(s) → Build APK(s)**.
Find it at `android/app/build/outputs/apk/debug/app-debug.apk`.

**B. Command line**
```bash
npx cap sync android
cd android
./gradlew assembleDebug          # Windows: .\gradlew.bat assembleDebug
```

Whenever you change anything in `www/`, run **`npx cap sync android`** before rebuilding.

---

## 3) Install on your phone

1. Copy **`UniBudget-debug.apk`** to the phone (USB, Google Drive, or email to yourself).
2. Tap it. Android will ask to allow installing from this source → **Allow** → **Install**.
3. Open **UniBudget**, sign up / log in.

*(This is a debug-signed APK — perfect for personal use and sideloading. For the Play Store you'd need a signed release build, and note the SMS/notification-reading features are unlikely to pass Play review — sideloading is the intended path.)*

---

## 4) Turn on GCash auto-detection

In the app: **avatar menu (top-right) → 🔗 Connect GCash**, then grant the three items:

| Step | What it does | Where |
|------|--------------|-------|
| **Notification access** | Reads GCash's notifications (the main source) | Opens Android's Notification-access list → enable **"UniBudget GCash detector"** |
| **SMS access** | Backup for GCash text alerts | In-app permission prompt |
| **Show notifications** | Lets the app alert you (Android 13+) | In-app permission prompt |

Make sure **GCash itself has notifications enabled** (GCash app → its notification settings), since notifications are the primary signal.

---

## 5) How it works / how to test

- GCash posts a notification like *"You have received PHP 500.00 from JUAN D…"*.
- The native listener catches it (app open **or** closed), and:
  - shows you a notification (**"Money in ₱500 · Auto-logged to UniBudget"**), and
  - hands the text to the app, which parses amount + direction (received → income, sent/paid → expense), guesses a category, and adds the transaction — updating balance, category bars, and (if configured) Supabase.
- Captures that arrive while the app is closed are queued and applied the next time you open it.

**Quick test without spending money:** send yourself an SMS containing text like
`GCash: You received PHP 250.00 from TEST. Your balance is PHP 1,000.00`
— the SMS receiver will parse it and log ₱250 as income.

---

## Notes & limits

- **Parsing** covers common GCash phrasings (received / sent / paid / cash-in / cash-out / bills payment). If GCash changes wording or you spot a message that isn't caught, the patterns live in `www/index.html` (`parseGcash`) and `GcashCaptureStore.java` (`looksLikeGcash`) — easy to extend.
- **Duplicates** are guarded: the same amount+type within 90 seconds is ignored (a notification and its SMS won't double-count).
- **Currency switch** changes the symbol only, not exchange rates.
- Data is cached on-device and synced to Supabase when keys are set and you're online.
