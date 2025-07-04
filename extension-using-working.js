// =====================================================================
// === Extension with Reference Structure (Preserving Key Capture) ===
// =====================================================================

import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Timeline, Now, createResource } from './timeline.js';

// Simple namespaced logger.
const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

// =====================================================================
// === グローバルヘルパー関数 (Global Helper Function) ===
// =====================================================================
/**
 * ウィンドウグループまたはウィンドウのリストをスタッキングオーダーでソートします。
 * @param {Array<T>} items - ソート対象の配列
 * @returns {Array<T>} ソート済みの配列（元の配列を直接変更します）
 * @template T
 */
function _sortUsingCommonRules(items) {
    const originalOrder = new Map(items.map((item, index) => [item, index]));
    items.sort((a, b) => {
        return originalOrder.get(a) - originalOrder.get(b);
    });
    return items;
}

// --- NonClosingPopupBaseMenuItem Class ---
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

// --- AppMenuButton Class ---
const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init({ toBeFocusedNewTimeline, toBeFocusedIndexCloseTimeline, toBeFocusedIndexActivateTimeline, redrawTimeline, closeOnListActivateTimeline, closeOnListCloseTimeline, extension, settings }) {
            super._init(0.0, 'Timeline Event Network');
            this._isDestroyed = false;

            this._panelIcon = new St.Icon({ icon_name: 'start-here-symbolic', style_class: 'system-status-icon' });
            this.add_child(this._panelIcon);

            this._extension = extension;
            this._settings = settings;
            this._favoritesContainer = null;
            this._separatorItem = null;
            this._windowsContainer = [];
            this._dummyButtons = [];
            this._lastFocusedItem = null;
            this._lastSelectedIndex = null;

            this.toBeFocusedNewTimeline = toBeFocusedNewTimeline;
            this.toBeFocusedIndexCloseTimeline = toBeFocusedIndexCloseTimeline;
            this.toBeFocusedIndexActivateTimeline = toBeFocusedIndexActivateTimeline;
            this.redrawTimeline = redrawTimeline;
            this._closeOnListActivateTimeline = closeOnListActivateTimeline;
            this._closeOnListCloseTimeline = closeOnListCloseTimeline;
            this._windowItemsMap = new Map();
            this._windowTitleConnections = new Map();

            this._selectedDummyIndexTimeline = Timeline(0);

            this._initializeMenuStructure();
            this._updateDummyItemsUnit(this._selectedDummyIndexTimeline.at(Now));
            this._updateWindowsUnit([]);

            this._selectedDummyIndexTimeline.map(selectedIndex => {
                if (this._isDestroyed) return;
                this._updateDummySelection(selectedIndex);
            });
        }

        open() {
            super.open();
            this.menu.actor.grab_key_focus();
        }

        close() {
            super.close();
            this._selectedDummyIndexTimeline.define(Now, null);
        }

        _initializeMenuStructure() {
            if (this._isDestroyed) return;
            this.menu.removeAll();
            this.menu.actor.connect('key-press-event', this._onMenuKeyPress.bind(this));
            this.menu.connect('active-item-changed', (menu, item) => { this._lastFocusedItem = item; });
            this._favoritesContainer = null;
            this._separatorItem = null;
            this._windowsContainer = [];
            this._dummyButtons = [];
            this._lastSelectedIndex = null;
        }

        _flashSelectedItem() {
            const selectedIndex = this._selectedDummyIndexTimeline.at(Now);
            if (selectedIndex === null || !this._dummyButtons[selectedIndex]) return;

            const button = this._dummyButtons[selectedIndex];
            const originalStyle = button.get_style();
            const flashStyle = "background-color: #f0f0f0; border-radius: 6px;";

            button.set_style(flashStyle);

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                if (button && !button.is_destroyed) {
                    button.set_style(originalStyle);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        _flashMenuItem(menuItem, color) {
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

        _onMenuKeyPress(actor, event) {
            this._extension.recoverFocusTimeline.define(Now, true);
            const symbol = event.get_key_symbol();

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                const DUMMY_ITEM_COUNT = 7;
                let currentIndex = this._selectedDummyIndexTimeline.at(Now) ?? 0;

                const direction = (symbol === Clutter.KEY_Left) ? -1 : 1;
                const newIndex = (currentIndex + direction + DUMMY_ITEM_COUNT) % DUMMY_ITEM_COUNT;

                this._selectedDummyIndexTimeline.define(Now, newIndex);
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._flashSelectedItem();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        _updateDummySelection(newSelectedIndex) {
            const oldSelectedIndex = this._lastSelectedIndex;

            if (oldSelectedIndex !== null && this._dummyButtons[oldSelectedIndex]) {
                this._dummyButtons[oldSelectedIndex].remove_style_class_name('selected');
            }
            if (newSelectedIndex !== null && this._dummyButtons[newSelectedIndex]) {
                this._dummyButtons[newSelectedIndex].add_style_class_name('selected');
            }
            this._lastSelectedIndex = newSelectedIndex;
        }

        _updateDummyItemsUnit(selectedIndex) {
            this._favoritesContainer?.destroy();
            this._favoritesContainer = null;
            this._dummyButtons = [];

            const DUMMY_ITEM_COUNT = 7;

            this._favoritesContainer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const topLevelFavoritesBox = new St.BoxLayout({ x_expand: true, style_class: 'aio-favorites-bar-container' });
            this._favoritesContainer.add_child(topLevelFavoritesBox);
            const favoritesGroupContainer = new St.BoxLayout({ style_class: 'aio-favorites-group' });

            for (let i = 0; i < DUMMY_ITEM_COUNT; i++) {
                const button = new St.Button({
                    child: new St.Icon({ icon_name: 'document-new-symbolic', style_class: 'aio-favorite-icon' }),
                    style_class: 'aio-favorite-button',
                    can_focus: false,
                    track_hover: true
                });

                button._dummyIndex = i;

                button.connect('clicked', () => {
                    this._selectedDummyIndexTimeline.define(Now, i);
                    this._flashSelectedItem();
                });
                button.connect('enter-event', () => {
                    this._selectedDummyIndexTimeline.define(Now, i);
                });

                this._dummyButtons.push(button);
                favoritesGroupContainer.add_child(button);
            }

            const settingsSpacer = new St.Widget({ x_expand: true, x_align: Clutter.ActorAlign.FILL });
            topLevelFavoritesBox.add_child(favoritesGroupContainer);
            topLevelFavoritesBox.add_child(settingsSpacer);

            const settingsButton = new St.Button({
                child: new St.Icon({ icon_name: 'preferences-system-symbolic', style_class: 'aio-settings-icon' }),
                style_class: 'aio-settings-button', can_focus: false, track_hover: true
            });
            settingsButton.connect('clicked', () => { this._openSettings(); });
            topLevelFavoritesBox.add_child(settingsButton);

            if (this.menu.numMenuItems > 0) {
                this.menu.box.insert_child_at_index(this._favoritesContainer.actor, 0);
            } else {
                this.menu.addMenuItem(this._favoritesContainer);
            }

            this._updateDummySelection(selectedIndex);
        }

        _openSettings() {
            this._extension.openPreferences();
            this.menu.close();
        }

        _updateWindowsUnit(windowGroups) {
            this._windowItemsMap.clear();
            this._windowsContainer.forEach(child => child.destroy());
            this._windowsContainer = [];
            this._separatorItem?.destroy();
            this._separatorItem = null;

            const dummyGroups = [
                {
                    app: { name: "Dummy App 1", icon: 'application-x-executable-symbolic' },
                    windows: [
                        { title: "Dummy Window A" },
                        { title: "Dummy Window B" },
                    ]
                },
                {
                    app: { name: "Dummy App 2", icon: 'computer-symbolic' },
                    windows: [
                        { title: "Another Dummy Window C" },
                    ]
                }
            ];

            if (this._favoritesContainer && dummyGroups.length > 0) {
                this._separatorItem = new PopupMenu.PopupSeparatorMenuItem();
                if (this.menu.box.contains(this._favoritesContainer.actor)) {
                    this.menu.addMenuItem(this._separatorItem, this.menu.box.get_children().indexOf(this._favoritesContainer.actor) + 1);
                } else {
                    this.menu.addMenuItem(this._separatorItem);
                }
            }

            if (dummyGroups.length > 0) {
                for (const group of dummyGroups) {
                    const headerItem = new NonClosingPopupBaseMenuItem({
                        reactive: true, can_focus: true,
                        style_class: 'aio-window-list-item aio-window-list-group-header'
                    });
                    headerItem._itemData = group;
                    headerItem._itemType = 'group';

                    const hbox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'aio-window-list-group-container' });
                    headerItem.add_child(hbox);
                    hbox.add_child(new St.Icon({ icon_name: group.app.icon, icon_size: 20, style_class: 'aio-window-list-group-icon' }));
                    hbox.add_child(new St.Label({ text: group.app.name, y_align: Clutter.ActorAlign.CENTER, style_class: 'aio-window-list-group-title' }));
                    hbox.add_child(new St.Widget({ x_expand: true }));
                    const actionsContainer = new St.BoxLayout({ style_class: 'aio-window-list-actions' });

                    const spacer = new St.Widget({ style_class: 'aio-action-spacer' });
                    actionsContainer.add_child(spacer);

                    const groupCloseButton = new St.Button({ style_class: 'aio-window-list-close-button', child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                    groupCloseButton.connect('clicked', () => this._flashMenuItem(headerItem, '#ff7b7b'));
                    actionsContainer.add_child(groupCloseButton);
                    hbox.add_child(actionsContainer);

                    headerItem.connect('custom-activate', () => this._flashMenuItem(headerItem, '#f0f0f0'));
                    headerItem.connect('custom-close', () => this._flashMenuItem(headerItem, '#ff7b7b'));
                    this.menu.addMenuItem(headerItem);
                    this._windowsContainer.push(headerItem);

                    for (const metaWindow of group.windows) {
                        const windowItem = new NonClosingPopupBaseMenuItem({
                            reactive: true, can_focus: true,
                            style_class: 'aio-window-list-item aio-window-list-window-item'
                        });
                        windowItem._itemData = metaWindow;
                        windowItem._itemType = 'window';
                        const windowHbox = new St.BoxLayout({ x_expand: true, style_class: 'aio-window-list-aio-window-list-window-container' });
                        windowItem.add_child(windowHbox);

                        const titleLabel = new St.Label({ text: metaWindow.title, y_align: Clutter.ActorAlign.CENTER, style_class: 'aio-window-list-aio-window-list-window-title' });
                        windowHbox.add_child(titleLabel);

                        windowHbox.add_child(new St.Widget({ x_expand: true }));
                        const windowCloseButton = new St.Button({ style_class: 'aio-window-list-close-button', child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                        windowCloseButton.connect('clicked', () => this._flashMenuItem(windowItem, '#ff7b7b'));
                        windowHbox.add_child(windowCloseButton);

                        windowItem.connect('custom-activate', () => this._flashMenuItem(windowItem, '#f0f0f0'));
                        windowItem.connect('custom-close', () => this._flashMenuItem(windowItem, '#ff7b7b'));
                        this.menu.addMenuItem(windowItem);
                        this._windowsContainer.push(windowItem);
                    }
                }
            } else {
                const noWindowsItem = new PopupMenu.PopupMenuItem("No open windows", { reactive: false });
                this.menu.addMenuItem(noWindowsItem);
                this._windowsContainer.push(noWindowsItem);
            }

            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this.redrawTimeline) {
                    this.redrawTimeline.define(Now, true);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        destroy() {
            if (this._isDestroyed) return;
            this._isDestroyed = true;
            super.destroy();
        }
    }
);

// =====================================================================
// === AppMenuButton Manager Module ===
// =====================================================================

/** Manages the AppMenuButton lifecycle using the new structure */
function manageAppMenuButton(extension, settings) {
    log('APPMENU: Creating AppMenuButton management...');

    // Create all required timelines
    const toBeFocusedNewTimeline = Timeline(null);
    const toBeFocusedIndexCloseTimeline = Timeline(null);
    const toBeFocusedIndexActivateTimeline = Timeline(null);
    const redrawTimeline = Timeline(null);
    const recoverFocusTimeline = Timeline(null);

    // Create boolean setting timelines
    const closeOnListActivateTimeline = extension._createBooleanSettingTimeline(settings, 'close-on-list-activate');
    const closeOnListCloseTimeline = extension._createBooleanSettingTimeline(settings, 'close-on-list-close');

    // Set up the extension's timelines for internal use
    extension.toBeFocusedNewTimeline = toBeFocusedNewTimeline;
    extension.toBeFocusedIndexCloseTimeline = toBeFocusedIndexCloseTimeline;
    extension.toBeFocusedIndexActivateTimeline = toBeFocusedIndexActivateTimeline;
    extension.redrawTimeline = redrawTimeline;
    extension.recoverFocusTimeline = recoverFocusTimeline;

    // Set up timeline behaviors
    recoverFocusTimeline.map(() => {
        if (extension._appMenuButton && extension._appMenuButton.menu.isOpen) {
            if (!extension._hasActiveMenuItem()) extension._focusMenuItemByIndex(0);
        }
    });

    redrawTimeline.map(() => {
        extension._applyFocusIntent();
    });

    // Create the actual AppMenuButton
    const appMenuButton = new AppMenuButton({
        toBeFocusedNewTimeline: toBeFocusedNewTimeline,
        toBeFocusedIndexCloseTimeline: toBeFocusedIndexCloseTimeline,
        toBeFocusedIndexActivateTimeline: toBeFocusedIndexActivateTimeline,
        redrawTimeline: redrawTimeline,
        closeOnListActivateTimeline: closeOnListActivateTimeline,
        closeOnListCloseTimeline: closeOnListCloseTimeline,
        extension: extension,
        settings: settings,
    });

    // Add to status area
    Main.panel.addToStatusArea(`${extension.uuid}-AppMenuButton`, appMenuButton, 0, 'center');
    extension._appMenuButton = appMenuButton;

    log('APPMENU: AppMenuButton created and added to panel.');

    // Return cleanup function
    return {
        dispose: () => {
            log('APPMENU: Disposing AppMenuButton...');
            if (extension._appMenuButton) {
                extension._appMenuButton.destroy();
                extension._appMenuButton = null;
            }
            log('APPMENU: AppMenuButton disposed.');
        }
    };
}

// =====================================================================
// === Main Extension Logic ===
// =====================================================================

export default class MinimalTimelineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._lifecycleTimeline = null;
        this._appMenuButton = null;
        this._gsettingsConnections = [];
        this.toBeFocusedNewTimeline = null;
        this.toBeFocusedIndexCloseTimeline = null;
        this.toBeFocusedIndexActivateTimeline = null;
        this.redrawTimeline = null;
        this.recoverFocusTimeline = null;
    }

    _hasActiveMenuItem() {
        try {
            if (!this._appMenuButton || !this._appMenuButton.menu.isOpen) return false;
            const menu = this._appMenuButton.menu;
            const menuBox = menu.box;
            if (!menuBox) return false;
            if (menu.active_item) {
                const activeItem = menu.active_item;
                const isVisible = activeItem && activeItem.visible && activeItem.mapped;
                const canInteract = activeItem.reactive && activeItem.can_focus;
                const opacity = activeItem.get_paint_opacity();
                const isNotTransparent = opacity > 0;
                if (isVisible && canInteract && isNotTransparent) return true;
            }
            return false;
        } catch (error) {
            console.error(`[ActiveCheck] Error: ${error.message}`);
            return false;
        }
    }

    _focusMenuItemByIndex(targetIndex) {
        if (!this._appMenuButton || !this._appMenuButton.menu.isOpen) return;
        const menu = this._appMenuButton.menu;
        const menuBox = menu.box;
        if (!menuBox) return;
        const children = menuBox.get_children();
        const focusableItems = children.filter(child => {
            const isVisible = child && child.visible && child.mapped;
            const canInteract = child.reactive && child.can_focus;
            const opacity = child.get_paint_opacity();
            const isNotTransparent = opacity > 0;
            return isVisible && canInteract && isNotTransparent;
        });
        if (targetIndex < 0 || targetIndex >= focusableItems.length) return;
        const targetItem = focusableItems[targetIndex];
        try {
            menu.active_item = targetItem;
            targetItem.grab_key_focus();
        } catch (error) { /* ignore */ }
    }

    _applyFocusIntent() {
        const indexCloseToFocus = this.toBeFocusedIndexCloseTimeline.at(Now);
        const indexActivateToFocus = this.toBeFocusedIndexActivateTimeline.at(Now);
        if (indexCloseToFocus === null && indexActivateToFocus === null) return;

        this.toBeFocusedIndexCloseTimeline.define(Now, null);
        this.toBeFocusedIndexActivateTimeline.define(Now, null);

        const focus = () => {
            if (!this._appMenuButton || !this._appMenuButton.menu.isOpen) return;
            if (indexCloseToFocus !== null && indexCloseToFocus >= 0) {
                const allItems = this._appMenuButton.menu._getMenuItems();
                const focusableItems = allItems.filter(item => item && item.reactive);
                if (focusableItems.length > 0) {
                    const newFocusIndex = Math.max(0, indexCloseToFocus - 1);
                    this._focusMenuItemByIndex(newFocusIndex);
                }
            } else if (indexActivateToFocus !== null && indexActivateToFocus >= 0) {
                this._focusMenuItemByIndex(indexActivateToFocus);
            }
        };
        setTimeout(focus, 100);
    }

    _createGenericSettingTimeline(settings, key, getter) {
        const timeline = Timeline(getter(key));
        const connectionId = settings.connect(`changed::${key}`, () => {
            timeline.define(Now, getter(key));
        });
        this._gsettingsConnections.push({ source: settings, id: connectionId });
        return timeline;
    }

    _createBooleanSettingTimeline(settings, key) {
        return this._createGenericSettingTimeline(settings, key, settings.get_boolean.bind(settings));
    }

    enable() {
        // The master switch for the extension's lifecycle (true: enabled, false: disabled).
        this._lifecycleTimeline = Timeline(false);

        this._lifecycleTimeline
            .distinctUntilChanged() // Optimization: react only to actual state changes.
            .using(isEnabled => {
                // If disabled, return null to trigger cleanup of all resources.
                if (!isEnabled) {
                    return null;
                }

                log('BRIDGE: Creating extension resources...');
                const settings = this.getSettings();

                // Create the AppMenuButton manager
                const appMenuButtonManager = manageAppMenuButton(this, settings);

                log('BRIDGE: Extension resources created.');

                // Return cleanup function
                const cleanup = () => {
                    log('BRIDGE: Disposing extension resources...');
                    appMenuButtonManager.dispose();
                    log('BRIDGE: Extension resources disposed.');
                };

                return createResource(null, cleanup);
            });

        // Enable the extension
        this._lifecycleTimeline.define(Now, true);
    }

    disable() {
        this._lifecycleTimeline?.define(Now, false);
        this._lifecycleTimeline = null;
        this._gsettingsConnections.forEach(({ source, id }) => {
            if (source && id) {
                try { source.disconnect(id); } catch (e) { }
            }
        });
        this._gsettingsConnections = [];
    }
}