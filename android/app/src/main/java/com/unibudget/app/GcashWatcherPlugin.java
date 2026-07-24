package com.unibudget.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;

/**
 * JS <-> native bridge for GCash auto-detection.
 *
 * JS API (see www/gcash-bridge.js):
 *   GcashWatcher.getQueue()  -> { messages: string[] }
 *   GcashWatcher.clearQueue()
 *   GcashWatcher.checkPermissions() -> { notificationAccess, sms, postNotifications }
 *   GcashWatcher.openNotificationAccessSettings()
 *   GcashWatcher.requestSmsPermission()
 *   GcashWatcher.requestPostNotifications()
 * Emits "gcashMessage" events with { text } while the app is open.
 */
@CapacitorPlugin(
    name = "GcashWatcher",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS }),
        @Permission(alias = "postNotifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class GcashWatcherPlugin extends Plugin {

    @Override
    public void load() {
        // Register this instance so capture services can push live events.
        GcashCaptureStore.livePlugin = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (GcashCaptureStore.livePlugin == this) GcashCaptureStore.livePlugin = null;
    }

    /** Called by GcashCaptureStore when the app is open. */
    public void emitMessage(String text) {
        JSObject ev = new JSObject();
        ev.put("text", text);
        notifyListeners("gcashMessage", ev);
    }

    @PluginMethod
    public void getQueue(PluginCall call) {
        List<String> msgs = GcashCaptureStore.drain(getContext());
        JSArray arr = new JSArray();
        for (String m : msgs) arr.put(m);
        JSObject ret = new JSObject();
        ret.put("messages", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearQueue(PluginCall call) {
        GcashCaptureStore.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("notificationAccess", isNotificationAccessGranted(ctx));
        ret.put("sms", getPermissionState("sms").toString().equals("granted"));
        boolean postNotif = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        ret.put("postNotifications", postNotif);
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (getPermissionState("sms").toString().equals("granted")) { call.resolve(); return; }
        requestPermissionForAlias("sms", call, "smsResult");
    }

    @PermissionCallback
    private void smsResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("sms").toString().equals("granted"));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPostNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { call.resolve(); return; }
        if (getPermissionState("postNotifications").toString().equals("granted")) { call.resolve(); return; }
        requestPermissionForAlias("postNotifications", call, "postNotifResult");
    }

    @PermissionCallback
    private void postNotifResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("postNotifications").toString().equals("granted"));
        call.resolve(ret);
    }

    private boolean isNotificationAccessGranted(Context ctx) {
        String enabled = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(ctx.getPackageName());
    }
}
