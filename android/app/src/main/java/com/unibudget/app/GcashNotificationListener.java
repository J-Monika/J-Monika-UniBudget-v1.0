package com.unibudget.app;

import android.app.Notification;
import android.content.ComponentName;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

/**
 * Reads notifications posted by the GCash app and forwards likely
 * transaction alerts to GcashCaptureStore. Requires the user to grant
 * "Notification access" in system settings (BIND_NOTIFICATION_LISTENER_SERVICE).
 */
public class GcashNotificationListener extends NotificationListenerService {

    // Package substrings for supported e-wallets (GCash, Maya, ShopeePay, GrabPay).
    private static final String[] WALLET_PKGS = { "gcash", "paymaya", "maya", "shopee", "grab" };

    private static boolean isWalletPackage(String pkg) {
        if (pkg == null) return false;
        String p = pkg.toLowerCase();
        for (String w : WALLET_PKGS) if (p.contains(w)) return true;
        return false;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        // Strict package isolation: only ever read notifications from known wallets.
        if (!isWalletPackage(sbn.getPackageName())) return;

        Notification n = sbn.getNotification();
        if (n == null || n.extras == null) return;
        Bundle x = n.extras;

        String title = charSeq(x.getCharSequence(Notification.EXTRA_TITLE));
        String text  = charSeq(x.getCharSequence(Notification.EXTRA_TEXT));
        String big   = charSeq(x.getCharSequence(Notification.EXTRA_BIG_TEXT));

        // Prefer the fullest body available.
        String body = !TextUtils.isEmpty(big) ? big : text;
        String combined = (TextUtils.isEmpty(title) ? "" : title + " ") + (body == null ? "" : body);
        combined = combined.trim();
        if (combined.isEmpty()) return;

        GcashCaptureStore.handle(getApplicationContext(), combined);
    }

    private static String charSeq(CharSequence cs) { return cs == null ? "" : cs.toString(); }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) { /* not needed */ }

    /**
     * When the system re-binds us (after boot, low-memory kill, or OEM deep-sleep),
     * re-scan the notification shade so we don't miss a GCash alert that arrived
     * while we were disconnected.
     */
    @Override
    public void onListenerConnected() {
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) for (StatusBarNotification sbn : active) onNotificationPosted(sbn);
        } catch (Exception ignored) {}
    }

    /** Ask the system to re-bind us ASAP after a disconnect (Android N+). */
    @Override
    public void onListenerDisconnected() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { requestRebind(new ComponentName(this, GcashNotificationListener.class)); }
            catch (Exception ignored) {}
        }
    }
}
