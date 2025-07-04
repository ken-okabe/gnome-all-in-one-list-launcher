// extension.js

import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Timeline, Now, createResource } from './timeline.js';

// =====================================================================
// === Reusable UI Classes (Skeletons) ===
// =====================================================================

/**
 * A valid, reusable UI component that prevents the menu from closing on activation.
 */
const NonClosingPopupBaseMenuItem = GObject.registerClass({
    Signals: {
        'custom-activate': {},
        'custom-close': {},
    },
}, class NonClosingPopupBaseMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(params) {
        super._init(params);
        this.activate = (event) => {
            this.emit('custom-activate');
            return false;
        };
    }
    vfunc_button_press_event(buttonEvent) {
        if (buttonEvent.button === 1) { this.activate(buttonEvent); return Clutter.EVENT_STOP; }
        return Clutter.EVENT_PROPAGATE;
    }
    vfunc_button_release_event(buttonEvent) {
        if (buttonEvent.button === 1) { return Clutter.EVENT_STOP; }
        return Clutter.EVENT_PROPAGATE;
    }
    vfunc_key_press_event(keyEvent) {
        const symbol = keyEvent.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) { return Clutter.EVENT_PROPAGATE; }
        if (symbol === Clutter.KEY_space) { this.emit('custom-activate'); return Clutter.EVENT_STOP; }
        else if (symbol === Clutter.KEY_BackSpace) { this.emit('custom-close'); return Clutter.EVENT_STOP; }
        return super.vfunc_key_press_event(keyEvent);
    }
    vfunc_touch_event(touchEvent) {
        if (touchEvent.type === Clutter.EventType.TOUCH_BEGIN) { this.activate(touchEvent); return Clutter.EVENT_STOP; }
        return Clutter.EVENT_PROPAGATE;
    }
});

/**
 * Refactored: A pure UI component with no business logic.
 * It only builds the skeleton of the panel button and its menu box.
 */
const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init() {
            super._init(0.5, 'FP AppMenu');
            this.add_child(new St.Icon({ icon_name: 'view-app-grid-symbolic' }));

            // Create and expose the main container for other logic to add content to.
            this.mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
            this.menu.box.add_child(this.mainBox);
        }
    }
);

/**
 * A pure UI skeleton class to hold icons on the panel.
 */
const PanelIcons = GObject.registerClass(
    class PanelIcons extends GObject.Object {
        _init() {
            super._init();
            // This container will hold the icons on the panel.
            // It's exposed so other logic can add children to it.
            this.container = new St.BoxLayout({ style_class: 'panel-window-list' });

            // Add the container to the left side of the panel.
            Main.panel.add_child(this.container);
        }

        destroy() {
            // The container is a child of this object, so destroying
            // the container is sufficient. It will be removed from the panel.
            this.container.destroy();
        }
    }
);

// =====================================================================
// === Main Extension Logic (Composer) ===
// =====================================================================
export default function AIOValidatorExtension(metadata) {
    // Simple namespaced logger, defined within the extension's scope.
    const log = (message) => {
        console.log(`[AIO-Validator] ${message}`);
    };

    const lifecycleTimeline = Timeline(false);

    lifecycleTimeline.using(isEnabled => {
        if (!isEnabled) {
            return null;
        }

        // --- UI SETUP ---
        log('BRIDGE: Creating top-level UI...');
        const panelMenuButton = new AppMenuButton();
        const panelIcons = new PanelIcons();

        Main.panel.addToStatusArea(metadata.uuid, panelMenuButton);
        log('BRIDGE: Top-level UI created.');

        // --- TEARDOWN LOGIC ---
        const cleanup = () => {
            log('BRIDGE: Destroying top-level UI...');
            panelMenuButton.destroy();
            panelIcons.destroy();
            log('BRIDGE: Top-level UI destroyed.');
        };

        // Group all UI components into a single resource object.
        const topLevelUI = {
            button: panelMenuButton,
            icons: panelIcons,
        };

        // Return the combined UI object and its single cleanup function.
        return createResource(topLevelUI, cleanup);
    });

    // Public methods for GNOME Shell to control the lifecycle.
    this.enable = () => lifecycleTimeline.define(Now, true);
    this.disable = () => lifecycleTimeline.define(Now, false);
}