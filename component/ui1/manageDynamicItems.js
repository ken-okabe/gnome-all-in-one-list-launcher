import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Timeline, Now, createResource } from '../../timeline.js';
import { _flashMenuItem } from '../ui0/manageFavorites.js';

const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

export function manageDynamicItems(container) {
    const listDataTimeline = Timeline(
        Array.from({ length: 10 }, (_, i) => ({
            title: `フォーカス可能リスト ${i + 1}`,
        }))
    );

    listDataTimeline.using(items => {
        const logPrefix = 'DYNAMIC LIST:';
        log(`${logPrefix} Building UI for ${items.length} list items.`);

        const verticalBox = new St.BoxLayout({ vertical: true, style: 'spacing: 4px;' });
        container.add_child(verticalBox);

        const listItems = items.map(itemData => {
            const menuItem = new PopupMenu.PopupMenuItem(itemData.title, {
                reactive: true,
                can_focus: true,
            });

            // ★★★ 巻き戻し: Enterキーをブロックするハンドラを再実装 ★★★
            menuItem.connect('key-press-event', (actor, event) => {
                const keySymbol = event.get_key_symbol();
                if (keySymbol === Clutter.KEY_Return || keySymbol === Clutter.KEY_KP_Enter) {
                    log(`DEBUG: DYNAMIC: Enter key blocked for "${itemData.title}"`);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            menuItem.connect('activate', () => {
                _flashMenuItem(menuItem, '#e0e0e0');
                log(`DEBUG: DYNAMIC: Activated with Space: "${itemData.title}"`);
            });

            verticalBox.add_child(menuItem);
            return menuItem;
        });

        return createResource(verticalBox, () => {
            log(`${logPrefix} Destroying ${listItems.length} list items.`);
            verticalBox.destroy();
        });
    });

    return {
        dispose: () => {}
    };
}