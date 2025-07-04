import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { Now } from '../../timeline.js';

/**
 * Manages the entire lifecycle of the AppMenuButton.
 * It creates the button and handles key navigation once dependencies are injected.
 */
export default function manageAppMenuButton() {
    // 1. Create the UI instance here.
    const appMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
    appMenuButton.add_child(new St.Icon({ icon_name: 'view-app-grid-symbolic' }));

    // 2. Create its internal structure.
    const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
    appMenuButton.menu.box.add_child(mainBox);

    // --- DEPENDENCY INJECTION ---
    // This will hold the controls for the favBar, injected later.
    let favBar = null;

    // 3. Define key press handling.
    const onKeyPress = (actor, event) => {
        // Guard against running before favBar is injected.
        if (!favBar) {
            console.log('[AIO-AppMenuButton] Key press ignored: favBar not yet injected.');
            return Clutter.EVENT_PROPAGATE;
        }

        const symbol = event.get_key_symbol();
        // --- FIXED: Removed problematic key_symbol_to_string call ---
        console.log(`[AIO-AppMenuButton] onKeyPress received key symbol: ${symbol}`);

        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
            console.log(`[AIO-AppMenuButton] Arrow key detected. Handling navigation.`);
            const DUMMY_ITEM_COUNT = 7; // This should ideally be passed in or defined centrally.
            let currentIndex = favBar.selectedIndexTimeline.at(Now);
            const direction = (symbol === Clutter.KEY_Left) ? -1 : 1;
            const newIndex = (currentIndex + direction + DUMMY_ITEM_COUNT) % DUMMY_ITEM_COUNT;
            favBar.selectedIndexTimeline.define(Now, newIndex);
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            console.log('[AIO-AppMenuButton] Enter key detected. Flashing item.');
            favBar.flashSelectedItem();
            return Clutter.EVENT_STOP;
        }

        console.log('[AIO-AppMenuButton] Key not handled, propagating.');
        return Clutter.EVENT_PROPAGATE;
    };

    // 4. Connect signals.
    appMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
        if (isOpen) {
            console.log('[AIO-AppMenuButton] Menu opened, grabbing key focus for the menu actor.');
            menu.actor.grab_key_focus();
        }
    });
    appMenuButton.menu.actor.connect('key-press-event', onKeyPress);

    // 5. Define its cleanup.
    const dispose = () => {
        appMenuButton.destroy();
    };

    // 6. Define the dependency injector.
    const setFavBar = (favBarControls) => {
        console.log('[AIO-AppMenuButton] favBar controls injected.');
        favBar = favBarControls;
    };

    // 7. Return the live instance and its controls.
    return {
        instance: appMenuButton,
        mainBox: mainBox,
        setFavBar: setFavBar, // Expose the injector
        dispose: dispose,
    };
}