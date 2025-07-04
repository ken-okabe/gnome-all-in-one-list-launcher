// =====================================================================
// === Final Reference Code for Documentation (修正版) ===
// =====================================================================

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Timeline, Now, createResource } from './timeline.js';
import { manageFavorites } from './component/ui0/manageFavorites.js';
import { manageDynamicItems } from './component/ui1/manageDynamicItems.js';

// Simple namespaced logger.
const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

// =====================================================================
// === Main Extension Logic ===
// =====================================================================
// This is the main class for the GNOME Shell extension.
export default function AIOValidatorExtension(metadata) {
    // The master switch for the extension's lifecycle (true: enabled, false: disabled).
    const lifecycleTimeline = Timeline(false);

    lifecycleTimeline
        .distinctUntilChanged()
        .using(isEnabled => {
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

            const demoLabel = new St.Label({ text: 'Focusable List Demo' });
            const demoBox = new St.BoxLayout({ style: 'spacing: 8px;' });
            mainBox.add_child(demoLabel);
            mainBox.add_child(demoBox);

            const favoritesManager = manageFavorites(favBox);
            const dynamicItemsManager = manageDynamicItems(demoBox);

            Main.panel.addToStatusArea(metadata.uuid, panelMenuButton);
            log('BRIDGE: Top-level UI created.');

            // --- TEARDOWN LOGIC ---
            const cleanup = () => {
                log('BRIDGE: Destroying top-level UI...');
                favoritesManager.dispose();
                dynamicItemsManager.dispose();
                panelMenuButton.destroy();
                log('BRIDGE: Top-level UI destroyed.');
            };

            return createResource(panelMenuButton, cleanup);
        });

    // Public methods for GNOME Shell to control the lifecycle.
    this.enable = () => lifecycleTimeline.define(Now, true);
    this.disable = () => lifecycleTimeline.define(Now, false);
}