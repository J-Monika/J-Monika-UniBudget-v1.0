package com.unibudget.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Central sink for GCash messages captured from notifications or SMS.
 *
 *  - If the app (WebView) is alive, the message is handed straight to JS.
 *  - Otherwise it is queued in SharedPreferences and drained when the app opens.
 *  - Either way a system notification is posted so the user is alerted immediately.
 */
public class GcashCaptureStore {

    private static final String PREFS = "unibudget_gcash";
    private static final String KEY_QUEUE = "queue";
    private static final String CHANNEL_ID = "gcash_alerts";
    private static final int NOTIF_BASE = 4200;

    // Set by the Capacitor plugin while the WebView is running.
    public static volatile GcashWatcherPlugin livePlugin = null;

    // Matches "PHP 500.00", "P1,250", "₱1,000.50"
    private static final Pattern AMOUNT =
            Pattern.compile("(?:php|₱|p)\\s?([0-9][0-9,]*\\.?[0-9]{0,2})", Pattern.CASE_INSENSITIVE);
    private static final Pattern LOOKS_LIKE =
            Pattern.compile("(received|sent|paid|payment|debited|credited|cash\\s?in|cash\\s?out|transfer|bought .* load)",
                    Pattern.CASE_INSENSITIVE);
    // GCash reference number — the natural idempotency key.
    private static final Pattern REF =
            Pattern.compile("ref(?:erence)?\\.?\\s*(?:no\\.?)?\\s*[:#]?\\s*([0-9]{6,})", Pattern.CASE_INSENSITIVE);

    private static final String KEY_SEEN = "seen_refs";
    private static final long SEEN_WINDOW_MS = 15 * 60 * 1000; // 15 min

    /** Returns true if the text looks like a GCash transaction alert. */
    public static boolean looksLikeGcash(String text) {
        if (text == null) return false;
        return AMOUNT.matcher(text).find() && LOOKS_LIKE.matcher(text).find();
    }

    /** Entry point called by the notification listener and SMS receiver. */
    public static void handle(Context ctx, String text) {
        if (!looksLikeGcash(text)) return;

        // Idempotency: dedupe by GCash Ref no. (falls back to amount+direction).
        String key = dedupKey(text);
        if (alreadySeen(ctx, key)) return;   // a notification + its SMS collapse to one
        markSeen(ctx, key);

        GcashWatcherPlugin plugin = livePlugin;
        if (plugin != null) {
            plugin.emitMessage(text);      // app open -> JS ingests live
        } else {
            enqueue(ctx, text);            // app closed -> keep for next launch
        }
        postNotification(ctx, text);       // always alert the user
    }

    private static String dedupKey(String text) {
        Matcher r = REF.matcher(text);
        if (r.find()) return "ref:" + r.group(1);
        Matcher a = AMOUNT.matcher(text);
        String amt = a.find() ? a.group(1) : "?";
        boolean income = Pattern.compile("received|credited|cash\\s?in|refund", Pattern.CASE_INSENSITIVE)
                .matcher(text).find();
        return "amt:" + amt + ":" + (income ? "in" : "out");
    }

    private static synchronized boolean alreadySeen(Context ctx, String key) {
        try {
            JSONObject seen = new JSONObject(
                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SEEN, "{}"));
            if (!seen.has(key)) return false;
            return (System.currentTimeMillis() - seen.optLong(key, 0)) < SEEN_WINDOW_MS;
        } catch (Exception e) { return false; }
    }

    private static synchronized void markSeen(Context ctx, String key) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject seen;
        try { seen = new JSONObject(p.getString(KEY_SEEN, "{}")); } catch (Exception e) { seen = new JSONObject(); }
        long now = System.currentTimeMillis();
        try {
            seen.put(key, now);
            // prune expired entries so the map can't grow unbounded
            JSONObject pruned = new JSONObject();
            java.util.Iterator<String> it = seen.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (now - seen.optLong(k, 0) < SEEN_WINDOW_MS) pruned.put(k, seen.getLong(k));
            }
            p.edit().putString(KEY_SEEN, pruned.toString()).apply();
        } catch (Exception ignored) {}
    }

    private static synchronized void enqueue(Context ctx, String text) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray arr;
        try { arr = new JSONArray(p.getString(KEY_QUEUE, "[]")); }
        catch (Exception e) { arr = new JSONArray(); }
        arr.put(text);
        p.edit().putString(KEY_QUEUE, arr.toString()).apply();
    }

    public static synchronized List<String> drain(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        List<String> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(p.getString(KEY_QUEUE, "[]"));
            for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
        } catch (Exception ignored) {}
        return out;
    }

    public static synchronized void clear(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
           .edit().putString(KEY_QUEUE, "[]").apply();
    }

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "GCash alerts", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Auto-logged GCash transactions");
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private static void postNotification(Context ctx, String text) {
        ensureChannel(ctx);

        String amount = "";
        Matcher m = AMOUNT.matcher(text);
        if (m.find()) amount = "₱" + m.group(1);
        boolean income = Pattern.compile("received|credited|cash\\s?in|refund", Pattern.CASE_INSENSITIVE)
                .matcher(text).find();
        String title = income ? ("Money in " + amount).trim() : ("Payment " + amount).trim();
        String body = "Auto-logged to UniBudget · tap to review";

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);

        try {
            NotificationManagerCompat.from(ctx).notify(NOTIF_BASE + (int) (System.currentTimeMillis() % 1000), b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted yet on Android 13+; capture still works.
        }
    }
}
