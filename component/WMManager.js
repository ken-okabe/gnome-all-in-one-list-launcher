// component/WMManager.js

import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

import { Timeline, Now } from '../timeline.js';

const log = (message) => {
    console.log(`[AIO-Validator/WMManager] ${message}`);
};

/**
 * ウィンドウの状態を監視し、そのリストをTimelineとして提供します。
 * ライフサイクル管理は呼び出し元が行います。
 * @returns {{windowsTimeline: Timeline<Array>, destroy: () => void}}
 */
export function createWindowModelManager() {
    log('Initializing...');
    const windowsTimeline = Timeline([]);
    const windowTimestamps = new Map();
    const windowTracker = Shell.WindowTracker.get_default();
    let signalIds = new Map();
    let isThrottled = false;

    const disconnectWindowSignals = () => {
        for (const [w, ids] of signalIds) {
            for (const id of ids) {
                try {
                    if (w && !w.is_destroyed()) w.disconnect(id);
                } catch (e) { /* ignore */ }
            }
        }
        signalIds.clear();
    };

    const updateWindows = () => {
        disconnectWindowSignals();
        const windowGroups = new Map();
        const currentWindowIds = new Set();

        for (const w of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
            if (w.is_skip_taskbar()) continue;
            const windowId = w.get_stable_sequence();
            currentWindowIds.add(windowId);
            const app = windowTracker.get_window_app(w);
            if (!app) continue;

            const posId = w.connect('position-changed', () => {
                if (!isThrottled) {
                    isThrottled = true;
                    updateWindows();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        isThrottled = false;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
            signalIds.set(w, [posId]);

            if (!windowTimestamps.has(windowId)) {
                windowTimestamps.set(windowId, Date.now());
            }
            const timestamp = windowTimestamps.get(windowId);
            const appId = app.get_id();
            if (!windowGroups.has(appId)) {
                windowGroups.set(appId, { app: app, windows: [] });
            }
            windowGroups.get(appId).windows.push([w, timestamp]);
        }

        for (const oldId of [...windowTimestamps.keys()]) {
            if (!currentWindowIds.has(oldId)) {
                windowTimestamps.delete(oldId);
            }
        }
        windowsTimeline.define(Now, Array.from(windowGroups.values()));
    };

    const restackedId = global.display.connect('restacked', updateWindows);
    updateWindows();

    const destroy = () => {
        log('Destroying WMManager resources.');
        if (restackedId) {
            try { global.display.disconnect(restackedId); } catch(e) {}
        }
        disconnectWindowSignals();
    };

    return { windowsTimeline, destroy };
}
v 