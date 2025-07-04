import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Timeline, createResource } from '../../timeline.js';
import { _flashMenuItem } from '../ui0/manageFavorites.js';

// Simple namespaced logger.
const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

/**
 * manageDynamicItems: フォーカス可能な縦型ダミーリストを管理します。
 * (クラス定義を使用しない実装)
 */
export function manageDynamicItems(container) {
    const listDataTimeline = Timeline(
        Array.from({ length: 10 }, (_, i) => ({
            title: `フォーカス可能リスト ${i + 1}`,
        }))
    );

    listDataTimeline.using(items => {
        const logPrefix = 'DYNAMIC LIST:';
        log(`${logPrefix} Building UI for ${items.length} list items.`);

        const verticalBox = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 4px;'
        });
        container.add_child(verticalBox);

        const listItems = items.map(itemData => {
            // ★ 標準の PopupMenuItem を使用し、プロパティでフォーカス可能にする
            const menuItem = new PopupMenu.PopupMenuItem(itemData.title, {
                reactive: true,
                can_focus: true,
            });

            // ★ 標準の 'activate' シグナルに接続
            menuItem.connect('activate', () => {
                _flashMenuItem(menuItem, '#e0e0e0');
                log(`Activated: ${itemData.title}`);
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
        dispose: () => { }
    };
}