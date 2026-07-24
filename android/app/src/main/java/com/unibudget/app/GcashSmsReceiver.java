package com.unibudget.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;

/**
 * Catches incoming SMS and forwards those from the GCash sender (or that
 * clearly look like GCash transaction texts) to GcashCaptureStore.
 * Requires RECEIVE_SMS.
 */
public class GcashSmsReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;
        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        if (pdus == null) return;
        String format = bundle.getString("format");

        // A single multipart SMS arrives as several PDUs — stitch the body back together.
        StringBuilder body = new StringBuilder();
        String sender = "";
        for (Object pdu : pdus) {
            SmsMessage msg = (format != null)
                    ? SmsMessage.createFromPdu((byte[]) pdu, format)
                    : SmsMessage.createFromPdu((byte[]) pdu);
            if (msg == null) continue;
            if (sender.isEmpty() && msg.getOriginatingAddress() != null) sender = msg.getOriginatingAddress();
            body.append(msg.getMessageBody());
        }

        String text = body.toString().trim();
        if (text.isEmpty()) return;

        boolean fromGcash = sender != null && sender.toLowerCase().contains("gcash");
        // Accept if the sender is GCash, or the body itself is unmistakably a GCash alert.
        if (fromGcash || text.toLowerCase().contains("gcash")) {
            GcashCaptureStore.handle(context.getApplicationContext(), text);
        }
    }
}
