package com.unibudget.app;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
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
        ret.put("battery", isIgnoringBatteryOptimizations(ctx));
        call.resolve(ret);
    }

    // ---- Battery / background survival (critical on Samsung/Xiaomi/Realme) ----

    @PluginMethod
    public void requestIgnoreBatteryOptimization(PluginCall call) {
        Context ctx = getContext();
        if (isIgnoringBatteryOptimizations(ctx)) { call.resolve(); return; }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            openBatterySettings(call);
            return;
        }
        call.resolve();
    }

    /** Deep-link to the OEM background/battery screen (Samsung "Never sleeping apps"). */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        Intent[] candidates = new Intent[] {
            new Intent().setComponent(new ComponentName("com.samsung.android.lool",
                    "com.samsung.android.sm.ui.battery.BatteryActivity")),
            new Intent().setComponent(new ComponentName("com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity")),
            new Intent().setComponent(new ComponentName("com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity")),
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + ctx.getPackageName()))
        };
        for (Intent i : candidates) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                call.resolve();
                return;
            } catch (Exception ignored) {}
        }
        call.reject("Could not open battery settings");
    }

    private boolean isIgnoringBatteryOptimizations(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
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
