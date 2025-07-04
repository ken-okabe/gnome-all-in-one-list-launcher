import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter'; // +++ ADDED: Import Clutter for key handling
import { Now } from '../../timeline.js'; // +++ ADDED: Import Now for timeline access

/**
 * Manages the entire lifecycle of the AppMenuButton.
 * It is now responsible for CREATING the button, not just managing a pre-made class.
 * It also handles key navigation for the contained components.
 * @param {object} favBar - The control object from manageFavBar.
 * @param {Timeline} favBar.selectedIndexTimeline - The timeline for the selected favorite.
 * @param {() => void} favBar.flashSelectedItem - Function to flash the selected item.
 */
export default function manageAppMenuButton(favBar) {
    // 1. Create the UI instance here. This is the point of "birth".
    const appMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
    appMenuButton.add_child(new St.Icon({ icon_name: 'view-app-grid-symbolic' }));

    // 2. Create its internal structure.
    const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
    appMenuButton.menu.box.add_child(mainBox);

    // 3. Define key press handling, now managed by the component that grabs focus.
    const onKeyPress = (actor, event) => {
        const symbol = event.get_key_symbol();
        // --- FIXED: Corrected the debug log call that caused the TypeError ---
        console.log(`[AIO-AppMenuButton] onKeyPress received key: ${Clutter.key_symbol_to_string(symbol)}`);

        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
            console.log(`[AIO-AppMenuButton] Arrow key detected. Handling navigation.`);
            const DUMMY_ITEM_COUNT = 7; // This should ideally be passed in or defined centrally.
            let currentIndex = favBar.selectedIndexTimeline.at(Now);
            const direction = (symbol === Clutter.KEY_Left) ? -1 : 1;
            const newIndex = (currentIndex + direction + DUMMY_ITEM_COUNT) % DUMMY_ITEM_COUNT;
            favBar.selectedIndexTimeline.define(Now, newIndex);
            return Clutter.EVENT_STOP; // Consume the event to prevent it from propagating.
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

    // 6. Return the live instance AND its parts for other components to use.
    return {
        instance: appMenuButton,
        mainBox: mainBox, // Expose mainBox for favBarManager
        dispose: dispose,
    };
}