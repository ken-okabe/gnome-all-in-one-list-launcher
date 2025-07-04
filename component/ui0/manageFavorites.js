import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Timeline, Now, createResource } from '../../timeline.js';

const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

export function _flashMenuItem(menuItem, color) {
    if (!menuItem || menuItem.is_destroyed) return;
    const hasStyleClass = menuItem.has_style_class_name('aio-favorite-button');
    const originalStyle = hasStyleClass ? '' : (menuItem.get_style() || '');
    const flashStyle = `background-color: ${color}; border-radius: 6px;`;
    menuItem.set_style(flashStyle);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        if (menuItem && !menuItem.is_destroyed) {
            menuItem.set_style(hasStyleClass ? null : originalStyle);
        }
        return GLib.SOURCE_REMOVE;
    });
}

export function manageFavorites(container, keyPressTimeline) {
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
        const initialFavId = favs.length > 0 ? favs[0].id : null;
        const selectedFavIdTimeline = Timeline(initialFavId);
        const iconMap = new Map();

        const favButtons = favs.map(favData => {
            const button = new St.Button({
                style_class: 'aio-favorite-button',
                can_focus: false,
                child: new St.Icon({ icon_name: favData.icon, style_class: 'aio-favorite-icon' })
            });
            button.connect('enter-event', () => {
                log(`DEBUG: FAV: Hovered over ${favData.id}`);
                selectedFavIdTimeline.define(Now, favData.id);
            });
            button.connect('clicked', () => {
                log(`DEBUG: FAV: Clicked on ${favData.id}`);
                selectedFavIdTimeline.define(Now, favData.id);
                keyPressTimeline.define(Now, Clutter.KEY_Return);
            });
            container.add_child(button);
            iconMap.set(favData.id, button);
            return button;
        });

        keyPressTimeline.map(keySymbol => {
            if (!keySymbol) return; // バグ修正箇所
            
            const currentId = selectedFavIdTimeline.at(Now);
            log(`DEBUG: FAV: Key event (symbol: ${keySymbol}) received via Timeline.`);
            let currentIndex = favs.findIndex(f => f.id === currentId);
            currentIndex = currentIndex !== -1 ? currentIndex : 0;
            let nextIndex = currentIndex;
            switch (keySymbol) {
                case Clutter.KEY_Left:
                    nextIndex = (currentIndex > 0) ? currentIndex - 1 : favs.length - 1;
                    selectedFavIdTimeline.define(Now, favs[nextIndex].id);
                    break;
                case Clutter.KEY_Right:
                    nextIndex = (currentIndex < favs.length - 1) ? currentIndex + 1 : 0;
                    selectedFavIdTimeline.define(Now, favs[nextIndex].id);
                    break;
                case Clutter.KEY_Return:
                case Clutter.KEY_KP_Enter:
                    if (currentId) {
                        const activatedButton = iconMap.get(currentId);
                        log(`DEBUG: FAV: Activate event for ID: ${currentId}`);
                        if(activatedButton) _flashMenuItem(activatedButton, '#e0e0e0');
                    }
                    break;
            }
        });

        let lastSelectedButton = null;
        selectedFavIdTimeline.using(selectedId => {
            if (lastSelectedButton && !lastSelectedButton.is_destroyed) {
                lastSelectedButton.remove_style_class_name('selected');
            }
            const newSelectedButton = iconMap.get(selectedId);
            if (newSelectedButton && !newSelectedButton.is_destroyed) {
                newSelectedButton.add_style_class_name('selected');
                lastSelectedButton = newSelectedButton;
            } else {
                lastSelectedButton = null;
            }
            return createResource(newSelectedButton, () => {
                if (newSelectedButton && !newSelectedButton.is_destroyed) {
                    newSelectedButton.remove_style_class_name('selected');
                }
            });
        });

        return createResource(favButtons, () => {
            log(`${logPrefix} Destroying ${favButtons.length} favorite items.`);
            favButtons.forEach(button => button.destroy());
        });
    });

    return { dispose: () => {} };
}