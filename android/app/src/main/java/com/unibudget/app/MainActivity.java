package com.unibudget.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the GCash auto-detection plugin before the bridge loads.
        registerPlugin(GcashWatcherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
