// =====================================================================
// === Final Reference Code for Documentation ===
// =====================================================================

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Timeline, Now, createResource } from './timeline.js';

// Simple namespaced logger.
const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

// =====================================================================
// === UI Component Modules ===
// =====================================================================

/** Manages a static list of UI items. */
function manageFavorites(container) {
    const favoritesDataTimeline = Timeline([
        { id: 'files', icon: 'org.gnome.Nautilus-symbolic' },
        { id: 'terminal', icon: 'utilities-terminal-symbolic' },
    ]);

    favoritesDataTimeline.using(favs => {
        log(`FAV: Building UI for ${favs.length} favorite items.`);
        const icons = favs.map(fav => {
            const icon = new St.Icon({
                icon_name: fav.icon,
                style_class: 'popup-menu-icon',
                icon_size: 32,
            });
            container.add_child(icon);
            return icon;
        });
        // Pair the created widgets with their cleanup logic.
        return createResource(icons, () => {
            log(`FAV: Destroying ${icons.length} favorite items.`);
            icons.forEach(icon => icon.destroy());
        });
    });

    // No external resources (like timers) to clean up manually.
    return {
        dispose: () => { }
    };
}

/** Manages a list of items that changes dynamically via a timer. */
function manageDynamicItems(container) {
    // The two states for the timer to toggle between.
    const STATE_A = [{ id: 'terminal', icon: 'utilities-terminal-symbolic' }];
    const STATE_B = [
        { id: 'terminal', icon: 'utilities-terminal-symbolic' },
        { id: 'files', icon: 'org.gnome.Nautilus-symbolic' },
    ];

    const dynamicDataTimeline = Timeline(STATE_A);

    dynamicDataTimeline.using(items => {
        log(`DYNAMIC: Building UI for ${items.length} items.`);
        const icons = items.map(item => {
            const icon = new St.Icon({
                icon_name: item.icon,
                style_class: 'popup-menu-icon',
                icon_size: 24,
            });
            container.add_child(icon);
            return icon;
        });
        // Pair the created widgets with their cleanup logic.
        return createResource(icons, () => {
            log(`DYNAMIC: Destroying ${items.length} items.`);
            icons.forEach(icon => icon.destroy());
        });
    });

    // This GLib timer is an external resource that needs manual cleanup.
    const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        log('DEMO: Timer fired, toggling dynamic data...');
        // Toggle the state between STATE_A and STATE_B.
        const currentState = dynamicDataTimeline.at(Now);
        const nextState = (currentState.length === 1) ? STATE_B : STATE_A;
        dynamicDataTimeline.define(Now, nextState);

        // Return true to keep the timer running.
        return GLib.SOURCE_CONTINUE;
    });

    // Provide a dispose method to clean up the external timer.
    return {
        dispose: () => {
            if (timerId > 0 && GLib.Source.remove(timerId)) {
                log('DEMO: Timer explicitly removed.');
            }
        }
    };
}


// =====================================================================
// === Main Extension Logic ===
// =================================================_
// This is the main class for the GNOME Shell extension.
export default function AIOValidatorExtension(metadata) {
    // The master switch for the extension's lifecycle (true: enabled, false: disabled).
    const lifecycleTimeline = Timeline(false);

    lifecycleTimeline
        .distinctUntilChanged() // Optimization: react only to actual state changes.
        .using(isEnabled => {
            // If disabled, return null to trigger cleanup of all resources.
            if (!isEnabled) {
                return null;
            }

            // --- UI SETUP ---
            log('BRIDGE: Creating top-level UI...');
            const panelMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
            panelMenuButton.add_child(new St.Icon({ icon_name: 'view-app-grid-symbolic' }));

            const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
            panelMenuButton.menu.box.add_child(mainBox);

            const favLabel = new St.Label({ text: 'Favorites' });
            const favBox = new St.BoxLayout({ style: 'spacing: 8px;' });
            mainBox.add_child(favLabel);
            mainBox.add_child(favBox);

            const demoLabel = new St.Label({ text: 'Dynamic Demo' });
            const demoBox = new St.BoxLayout({ style: 'spacing: 8px;' });
            mainBox.add_child(demoLabel);
            mainBox.add_child(demoBox);

            // Create and compose the sub-components.
            const favoritesManager = manageFavorites(favBox);
            const dynamicItemsManager = manageDynamicItems(demoBox);

            Main.panel.addToStatusArea(metadata.uuid, panelMenuButton);
            log('BRIDGE: Top-level UI created.');

            // --- TEARDOWN LOGIC ---
            // This function is automatically called when the extension is disabled.
            const cleanup = () => {
                log('BRIDGE: Destroying top-level UI...');
                // 1. Tell children to clean up their own external resources.
                favoritesManager.dispose();
                dynamicItemsManager.dispose();
                // 2. Destroy the top-level UI widget.
                panelMenuButton.destroy();
                log('BRIDGE: Top-level UI destroyed.');
            };

            // Return the main UI widget and its teardown logic as a single unit.
            return createResource(panelMenuButton, cleanup);
        });

    // Public methods for GNOME Shell to control the lifecycle.
    this.enable = () => lifecycleTimeline.define(Now, true);
    this.disable = () => lifecycleTimeline.define(Now, false);
}