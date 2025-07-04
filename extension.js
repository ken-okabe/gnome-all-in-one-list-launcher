import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib'; // +++ ADDED: Import GLib for idle_add
import { Timeline, Now, createResource } from './timeline.js';

import manageAppMenuButton from './component/ui0/manageAppMenuButton.js';
import manageFavBar from './component/ui0/manageFavBar.js';
import managePanelIcons from './component/ui1/managePanelIcons.js';

// =====================================================================
// === Main Extension Logic (Composer / Assembler) ===
// =====================================================================
export default function AIOValidatorExtension(metadata) {
    const log = (message) => {
        console.log(`[AIO-Validator] ${message}`);
    };

    const lifecycleTimeline = Timeline(false);

    lifecycleTimeline.using(isEnabled => {
        if (!isEnabled) {
            return null;
        }

        log('BRIDGE: Creating UI components from factories...');

        const panelIconsManager = managePanelIcons();
        const appMenuButtonManager = manageAppMenuButton();

        const panelIcons = panelIconsManager.instance;
        const panelMenuButton = appMenuButtonManager.instance;
        const mainBox = appMenuButtonManager.mainBox;

        // --- THE DEFINITIVE FIX for the race condition ---
        // This variable will hold the ID of our deferred task.
        let idleAddId = 0;

        // DEFER ASSEMBLY: Defer adding widgets to the panel.
        // This gives the shell time to process pending layout changes, avoiding conflicts.
        idleAddId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            // This code runs after the shell has processed pending layout changes.
            if (panelMenuButton.is_destroyed || panelIcons.is_destroyed) {
                // In case the extension was disabled again very quickly.
                idleAddId = 0;
                return GLib.SOURCE_REMOVE;
            }

            // TODO: Make position configurable via GSettings (e.g., 'left', 'center', 'right').
            // For now, default to the left box to fix the allocation issue.
            const targetPanelBox = Main.panel._leftBox;
            targetPanelBox.add_child(panelIcons);

            // The AppMenuButton is always added to the status area (right box).
            Main.panel.addToStatusArea(metadata.uuid, panelMenuButton);

            idleAddId = 0; // Reset the ID after execution.
            return GLib.SOURCE_REMOVE; // Ensures this runs only once.
        });

        const favBarManager = manageFavBar(mainBox, panelMenuButton.menu.actor);

        log('BRIDGE: UI Assembly initiated.');

        const cleanup = () => {
            log('BRIDGE: Destroying top-level UI...');

            // --- CRITICAL: Also clean up the deferred task if it hasn't run yet ---
            if (idleAddId > 0) {
                GLib.Source.remove(idleAddId);
                idleAddId = 0;
            }

            favBarManager.dispose();
            appMenuButtonManager.dispose();
            panelIconsManager.dispose();
            log('BRIDGE: Top-level UI destroyed.');
        };

        const topLevelUI = {
            button: panelMenuButton,
            icons: panelIcons,
        };

        return createResource(topLevelUI, cleanup);
    });

    this.enable = () => lifecycleTimeline.define(Now, true);
    this.disable = () => lifecycleTimeline.define(Now, false);
}