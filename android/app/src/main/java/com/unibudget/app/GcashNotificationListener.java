package com.unibudget.app;

import android.app.Notification;
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

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (pkg == null || !pkg.toLowerCase().contains("gcash")) return;

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
}
