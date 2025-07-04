import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import { Timeline, Now } from '../../timeline.js';

/**
 * A self-contained "using" component to manage the favorites bar.
 * @param {St.BoxLayout} container - The parent container to add the UI to.
 * @param {Clutter.Actor} menuActor - The actor to attach key press events to.
 * @returns {{dispose: () => void}} - An object with a dispose method for cleanup.
 */
export default function manageFavBar(container, menuActor) {
    const DUMMY_ITEM_COUNT = 7;
    const items = Array.from({ length: DUMMY_ITEM_COUNT });

    const selectedIndexTimeline = Timeline(0);

    const favBarBox = new St.BoxLayout({ style_class: 'aio-favorites-group' });
    const buttons = items.map((_, i) => {
        const button = new St.Button({
            child: new St.Icon({ icon_name: 'document-new-symbolic', style_class: 'aio-favorite-icon' }),
            style_class: 'aio-favorite-button',
            can_focus: false,
            track_hover: true
        });
        button.connect('clicked', () => selectedIndexTimeline.define(Now, i));
        favBarBox.add_child(button);
        return button;
    });
    container.add_child(favBarBox);

    selectedIndexTimeline.map(newIndex => {
        buttons.forEach((button, i) => {
            if (i === newIndex) {
                button.add_style_class_name('selected');
            } else {
                button.remove_style_class_name('selected');
            }
        });
    });

    const flashSelectedItem = () => {
        const index = selectedIndexTimeline.at(Now);
        const button = buttons[index];
        if (!button) return;

        const originalStyle = button.get_style() || '';
        button.set_style('background-color: rgba(255, 255, 255, 0.9);');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (button && !button.is_destroyed) {
                button.set_style(originalStyle);
            }
            return GLib.SOURCE_REMOVE;
        });
    };

    const onKeyPress = (actor, event) => {
        const symbol = event.get_key_symbol();
        console.log(`[AIO-FavBar] onKeyPress received key: ${Clutter.key_symbol_to_string(symbol)}`); // DEBUG LOG
        let currentIndex = selectedIndexTimeline.at(Now);

        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
            console.log(`[AIO-FavBar] Arrow key detected. Direction: ${symbol === Clutter.KEY_Left ? 'Left' : 'Right'}`); // DEBUG LOG
            const direction = (symbol === Clutter.KEY_Left) ? -1 : 1;
            const newIndex = (currentIndex + direction + DUMMY_ITEM_COUNT) % DUMMY_ITEM_COUNT;
            selectedIndexTimeline.define(Now, newIndex);
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            console.log('[AIO-FavBar] Enter key detected.'); // DEBUG LOG
            flashSelectedItem();
            return Clutter.EVENT_STOP;
        }
        console.log('[AIO-FavBar] Key not handled, propagating.'); // DEBUG LOG
        return Clutter.EVENT_PROPAGATE;
    };
    const keyPressSignalId = menuActor.connect('key-press-event', onKeyPress);

    const dispose = () => {
        if (keyPressSignalId > 0) {
            menuActor.disconnect(keyPressSignalId);
        }
        // --- REMOVED ---
        // The result of .map() is a timeline, not a disposable subscription.
        // This line was incorrect and caused the error.
        // selectionBinding.dispose();
    };

    return { dispose };
}