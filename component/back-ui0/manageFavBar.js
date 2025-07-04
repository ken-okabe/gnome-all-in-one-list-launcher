import St from 'gi://St';
import GLib from 'gi://GLib';

import { Timeline, Now } from '../../timeline.js';

/**
 * A self-contained "using" component to manage the favorites bar.
 * It is ONLY responsible for creating the UI and managing its own state.
 * It returns controls for another component to use.
 * @param {St.BoxLayout} container - The parent container to add the UI to.
 * @returns {{dispose: () => void, selectedIndexTimeline: Timeline, flashSelectedItem: () => void}}
 */
export default function manageFavBar(container) {
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

    const dispose = () => {
        // All resources are managed by parent components.
        // favBarBox is destroyed when its parent (mainBox) is destroyed.
    };

    return {
        dispose,
        selectedIndexTimeline,
        flashSelectedItem,
    };
}