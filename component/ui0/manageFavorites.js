import GLib from 'gi://GLib';
import St from 'gi://St';

import { Timeline, createResource } from '../../timeline.js';

// Simple namespaced logger.
const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

/**
 * _flashMenuItem: メニュー項目を一時的にハイライトするヘルパー関数
 * @param {St.Widget} menuItem - ハイライトするウィジェット
 * @param {string} color - ハイライト色
 */
export function _flashMenuItem(menuItem, color) {
    if (!menuItem || menuItem.is_destroyed) return;

    const originalStyle = menuItem.get_style() || '';
    const flashStyle = `background-color: ${color}; border-radius: 6px;`;

    menuItem.set_style(flashStyle);

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        if (menuItem && !menuItem.is_destroyed) {
            menuItem.set_style(originalStyle);
        }
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * manageFavorites: 静的なアイコンリストを管理します。
 */
export function manageFavorites(container) {
    const favoritesDataTimeline = Timeline([
        { id: 'files', icon: 'org.gnome.Nautilus-symbolic' },
        { id: 'terminal', icon: 'utilities-terminal-symbolic' },
        { id: 'gedit', icon: 'org.gnome.gedit-symbolic' },
        { id: 'calculator', icon: 'accessories-calculator-symbolic' },
        { id: 'calendar', icon: 'x-office-calendar-symbolic' },
        { id: 'weather', icon: 'weather-clear-symbolic' },
        { id: 'clocks', icon: 'gnome-clocks-symbolic' },
    ]);

    favoritesDataTimeline.using(favs => {
        const logPrefix = 'FAV:';
        log(`${logPrefix} Building UI for ${favs.length} favorite items.`);
        const icons = favs.map(fav => {
            const icon = new St.Icon({
                icon_name: fav.icon,
                style_class: 'popup-menu-icon',
                icon_size: 32,
            });
            container.add_child(icon);
            return icon;
        });
        return createResource(icons, () => {
            log(`${logPrefix} Destroying ${icons.length} favorite items.`);
            icons.forEach(icon => icon.destroy());
        });
    });

    return {
        dispose: () => { }
    };
}