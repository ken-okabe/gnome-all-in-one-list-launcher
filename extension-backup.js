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

import { Timeline, Now, combineLatestWith } from './timeline.js';

// --- NonClosingPopupBaseMenuItem Class (変更なし) ---
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

// --- WindowModel Class (変更なし) ---
const WindowModel = GObject.registerClass(
    class WindowModel extends GObject.Object {
        _init() {
            super._init();
            this.windowsTimeline = Timeline([]);
            this._windowTracker = Shell.WindowTracker.get_default();
            this._signalIds = new Map();
            this._trackerChangedId = this._windowTracker.connect('tracked-windows-changed', () => this.update());
            this.update();
        }
        update() {
            this._disconnectWindowSignals();
            const g = new Map();
            for (const w of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
                if (w.is_skip_taskbar()) continue;
                const a = this._windowTracker.get_window_app(w);
                if (!a) continue;
                const s = w.connect('notify::title', () => this.update());
                this._signalIds.set(w, s);
                const i = a.get_id();
                if (!g.has(i)) g.set(i, { app: a, windows: [] });
                g.get(i).windows.push(w);
            }
            this.windowsTimeline.define(Now, Array.from(g.values()));
        }
        _disconnectWindowSignals() {
            for (const [w, i] of this._signalIds) {
                try { if (w && !w.is_destroyed) w.disconnect(i); } catch (e) { }
            }
            this._signalIds.clear();
        }
        destroy() {
            if (this._trackerChangedId) { this._windowTracker.disconnect(this._trackerChangedId); this._trackerChangedId = null; }
            this._disconnectWindowSignals();
        }
    });

// --- RunningAppsIndicator & RunningAppsIconList Class (変更なし) ---
const RunningAppsIconList = GObject.registerClass(
    class RunningAppsIconList extends St.BoxLayout {
        _init() {
            super._init();
            this._icons = [];
        }

        update(windowGroups) {
            this.destroy_all_children();
            this._icons = [];

            if (!windowGroups) return;

            for (const group of windowGroups) {
                const icon = new St.Icon({
                    gicon: group.app.get_icon(),
                    style_class: 'system-status-icon'
                });
                const button = new St.Button({ child: icon });
                button.connect('clicked', () => {
                    if (group.windows.length > 0) Main.activateWindow(group.windows[0]);
                });
                this.add_child(button);
                this._icons.push(button);
            }
        }
    }
);

const RunningAppsIndicator = GObject.registerClass(
    class RunningAppsIndicator extends PanelMenu.Button {
        _init({ windowsTimeline }) {
            super._init(0.0, null, false);
            this.reactive = false;

            this._iconList = new RunningAppsIconList();
            this.add_child(this._iconList);

            windowsTimeline.map(windowGroups => {
                this._iconList?.update(windowGroups);
            });
        }

        destroy() {
            this._iconList?.destroy();
            this._iconList = null;
            super.destroy();
        }
    }
);


// --- AppMenuButton Class (変更なし) ---
const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init({ windowsTimeline, favoritesTimeline, extension, settings }) {
            super._init(0.0, 'Timeline Event Network');
            this._isDestroyed = false;
            this._panelIcon = new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'system-status-icon' });
            this.add_child(this._panelIcon);
            this._extension = extension;
            this._settings = settings;
            this._favoritesContainer = null;
            this._separatorItem = null;
            this._windowsContainer = [];
            this._favoriteButtons = [];
            this._lastSelectedIndex = null;
            this._lastFocusedItem = null;
            this._resetting = false;
            const initialFavorites = favoritesTimeline.at(Now);
            this._selectedFavoriteIndexTimeline = Timeline(initialFavorites.length > 0 ? 0 : null);
            this._windowsTimeline = windowsTimeline;
            this._favoritesTimeline = favoritesTimeline;
            this._initializeMenuStructure();
            this._favoritesTimeline.map(favoriteAppIds => {
                if (this._isDestroyed) return;
                this._updateFavoritesSection(favoriteAppIds, this._selectedFavoriteIndexTimeline.at(Now));
            });
            this._selectedFavoriteIndexTimeline.map(selectedIndex => {
                if (this._isDestroyed) return;
                this._updateFavoriteSelection(selectedIndex);
            });
            const windowSectionDataTimeline = combineLatestWith(
                (windows, favs) => ({ windows, favs })
            )(this._windowsTimeline)(this._favoritesTimeline);
            windowSectionDataTimeline.map(({ windows, favs }) => {
                if (this._isDestroyed) return;
                this._updateWindowsSection(windows, favs);
            });
        }
        open() {
            super.open();
            this.menu.actor.grab_key_focus();
            const favCount = this._extension._favsSettings.get_strv('favorite-apps')?.length || 0;
            const initialIndex = favCount > 0 ? 0 : null;
            this._selectedFavoriteIndexTimeline.define(Now, initialIndex);
        }
        close() { super.close(); this._selectedFavoriteIndexTimeline.define(Now, null); }
        _flashIcon(color) {
            if (this._isDestroyed || !this._panelIcon || this._panelIcon.is_destroyed) return;
            const originalStyle = this._panelIcon.get_style();
            this._panelIcon.set_style(`background-color: ${color};`);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                if (this._panelIcon && !this._panelIcon.is_destroyed) this._panelIcon.set_style(originalStyle);
                return GLib.SOURCE_REMOVE;
            });
        }
        _initializeMenuStructure() {
            if (this._isDestroyed) return;
            this.menu.removeAll();
            this.menu.actor.connect('key-press-event', this._onMenuKeyPress.bind(this));
            this.menu.connect('active-item-changed', (menu, item) => { this._lastFocusedItem = item; });
            this._favoritesContainer = null;
            this._separatorItem = null;
            this._windowsContainer = [];
            this._favoriteButtons = [];
            this._lastSelectedIndex = null;
        }
        _handleFavLaunch() {
            this._flashIcon('blue');
            const selectedIndex = this._selectedFavoriteIndexTimeline.at(Now);
            if (selectedIndex !== null && selectedIndex >= 0) {
                const favs = this._extension._favsSettings.get_strv('favorite-apps');
                const appId = favs[selectedIndex];
                if (appId) {
                    const app = Shell.AppSystem.get_default().lookup_app(appId);
                    if (app) { this._launchNewInstance(app); this._resetMenuState(); }
                }
            }
        }
        _resetMenuState() {
            if (this._resetting || this._isDestroyed) return;
            this._resetting = true;
            let handlerId = 0;
            handlerId = this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (this._isDestroyed) { if (handlerId > 0) this.menu.disconnect(handlerId); return; }
                if (!isOpen) {
                    this.menu.open();
                    if (this.menu.first_item) this.menu.set_active_item(this.menu.first_item);
                    this.menu.actor.grab_key_focus();
                    if (handlerId > 0) this.menu.disconnect(handlerId);
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => { this._resetting = false; return GLib.SOURCE_REMOVE; });
                }
            });
            this.menu.close();
        }
        _onMenuKeyPress(actor, event) {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                this._flashIcon('orange');
                const favs = this._extension._favsSettings.get_strv('favorite-apps');
                if (favs.length > 0) {
                    const direction = (symbol === Clutter.KEY_Left) ? -1 : 1;
                    const currentIndex = this._selectedFavoriteIndexTimeline.at(Now) ?? favs.length;
                    const newIndex = (currentIndex + direction + favs.length) % favs.length;
                    this._selectedFavoriteIndexTimeline.define(Now, newIndex);
                }
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._handleFavLaunch();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        _launchNewInstance(app) { if (this._isDestroyed) return; app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT); }
        _updateFavoriteSelection(newIndex) {
            const oldIndex = this._lastSelectedIndex;
            if (oldIndex !== null && this._favoriteButtons[oldIndex]) this._favoriteButtons[oldIndex].remove_style_class_name('selected');
            if (newIndex !== null && this._favoriteButtons[newIndex]) this._favoriteButtons[newIndex].add_style_class_name('selected');
            this._lastSelectedIndex = newIndex;
        }
        _updateFavoritesSection(favoriteAppIds, selectedIndex) {
            this._favoritesContainer?.destroy();
            this._favoritesContainer = null;
            this._favoriteButtons = [];
            if (favoriteAppIds && favoriteAppIds.length > 0) {
                this._favoritesContainer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                const favoritesBox = new St.BoxLayout({ x_expand: true, style_class: 'favorites-bar-container' });
                this._favoritesContainer.add_child(favoritesBox);
                for (const [index, appId] of favoriteAppIds.entries()) {
                    const app = Shell.AppSystem.get_default().lookup_app(appId);
                    if (!app) continue;
                    const button = new St.Button({ child: new St.Icon({ gicon: app.get_icon(), icon_size: 28, style_class: 'favorite-bar-app-icon' }), style_class: 'favorite-button', can_focus: false, track_hover: true });
                    button.connect('clicked', () => { this._selectedFavoriteIndexTimeline.define(Now, index); this._launchNewInstance(app); });
                    button.connect('enter-event', () => { this._selectedFavoriteIndexTimeline.define(Now, index); });
                    this._favoriteButtons[index] = button;
                    favoritesBox.add_child(button);
                }
                if (this.menu.numMenuItems > 0) this.menu.box.insert_child_at_index(this._favoritesContainer.actor, 0);
                else this.menu.addMenuItem(this._favoritesContainer);
                this._updateFavoriteSelection(selectedIndex);
            }
        }
        _sortWindowGroups(windowGroups, favoriteAppIds) {
            const favoriteOrder = new Map(favoriteAppIds.map((id, index) => [id, index]));
            windowGroups.sort((a, b) => {
                const favIndexA = favoriteOrder.get(a.app.get_id());
                const favIndexB = favoriteOrder.get(b.app.get_id());
                const aIsFav = favIndexA !== undefined;
                const bIsFav = favIndexB !== undefined;
                if (aIsFav && !bIsFav) return -1;
                if (!aIsFav && bIsFav) return 1;
                if (aIsFav && bIsFav) return favIndexA - favIndexB;
                return 0;
            });
            return windowGroups;
        }
        _updateWindowsSection(windowGroups, favoriteAppIds) {
            this._windowsContainer.forEach(child => child.destroy());
            this._windowsContainer = [];
            this._separatorItem?.destroy();
            this._separatorItem = null;
            if (this._favoritesContainer && windowGroups && windowGroups.length > 0) {
                this._separatorItem = new PopupMenu.PopupSeparatorMenuItem();
                this.menu.addMenuItem(this._separatorItem);
            }
            if (windowGroups && windowGroups.length > 0) {
                const sortedGroups = this._sortWindowGroups([...windowGroups], favoriteAppIds);
                for (const group of sortedGroups) {
                    const headerItem = new NonClosingPopupBaseMenuItem({ reactive: true, can_focus: true, style_class: 'window-list-item app-header-item' });
                    headerItem._itemData = group;
                    headerItem._itemType = 'group';
                    const hbox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'app-header-container' });
                    headerItem.add_child(hbox);
                    hbox.add_child(new St.Icon({ gicon: group.app.get_icon(), icon_size: 20, style_class: 'app-header-icon' }));
                    hbox.add_child(new St.Label({ text: group.app.get_name(), y_align: Clutter.ActorAlign.CENTER, style_class: 'app-header-title' }));
                    hbox.add_child(new St.Widget({ x_expand: true }));
                    const actionsContainer = new St.BoxLayout({ style_class: 'item-actions-container' });
                    const isFavorite = favoriteAppIds.includes(group.app.get_id());
                    const starIcon = isFavorite ? 'starred-symbolic' : 'non-starred-symbolic';
                    const starButton = new St.Button({ style_class: 'favorite-star-button', child: new St.Icon({ icon_name: starIcon, style_class: 'popup-menu-icon' }) });
                    starButton.connect('clicked', () => { this._extension._toggleFavorite(group.app.get_id()); });
                    actionsContainer.add_child(starButton);
                    const groupCloseButton = new St.Button({ style_class: 'window-close-button', child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                    groupCloseButton.connect('clicked', () => headerItem.emit('custom-close'));
                    actionsContainer.add_child(groupCloseButton);
                    hbox.add_child(actionsContainer);
                    headerItem.connect('custom-activate', () => this._handleWindowActivate(headerItem, group, 'group'));
                    headerItem.connect('custom-close', () => this._handleWindowClose(headerItem, group, 'group'));
                    this.menu.addMenuItem(headerItem);
                    this._windowsContainer.push(headerItem);
                    const sortedWindows = group.windows.sort((winA, winB) => winA.get_frame_rect().y - winB.get_frame_rect().y);
                    for (const metaWindow of sortedWindows) {
                        const windowItem = new NonClosingPopupBaseMenuItem({ reactive: true, can_focus: true, style_class: 'window-list-item window-item' });
                        windowItem._itemData = metaWindow;
                        windowItem._itemType = 'window';
                        const windowHbox = new St.BoxLayout({ x_expand: true, style_class: 'window-item-container' });
                        windowItem.add_child(windowHbox);
                        windowHbox.add_child(new St.Label({ text: metaWindow.get_title() || '...', y_align: Clutter.ActorAlign.CENTER, style_class: 'window-item-title' }));
                        windowHbox.add_child(new St.Widget({ x_expand: true }));
                        const windowCloseButton = new St.Button({ style_class: 'window-close-button', child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                        windowCloseButton.connect('clicked', () => windowItem.emit('custom-close'));
                        windowHbox.add_child(windowCloseButton);
                        windowItem.connect('custom-activate', () => this._handleWindowActivate(windowItem, metaWindow, 'window'));
                        windowItem.connect('custom-close', () => this._handleWindowClose(windowItem, metaWindow, 'window'));
                        this.menu.addMenuItem(windowItem);
                        this._windowsContainer.push(windowItem);
                    }
                }
            } else {
                const noWindowsItem = new PopupMenu.PopupMenuItem("No open windows", { reactive: false });
                this.menu.addMenuItem(noWindowsItem);
                this._windowsContainer.push(noWindowsItem);
            }
        }
        _handleWindowActivate(actor, item, itemType) { this._flashIcon('green'); this._activateSelection(actor, item, itemType); }
        _handleWindowClose(actor, item, itemType) { this._flashIcon('red'); this._closeSelection(actor, item, itemType); this._resetMenuState(); }
        _closeSelection(actor, item, itemType) {
            if (this._isDestroyed) return;
            if (itemType === 'group') item.windows.forEach(win => win.delete(global.get_current_time()));
            else item.delete(global.get_current_time());
        }
        _activateSelection(actor, item, itemType) {
            if (this._isDestroyed) return;
            const windowToActivate = (itemType === 'group') ? item.windows[0] : item;
            if (windowToActivate) Main.activateWindow(windowToActivate);
        }
        destroy() { if (this._isDestroyed) return; this._isDestroyed = true; super.destroy(); }
    }
);

// ★★★★★ メインの拡張機能クラス (バグ修正・全体版) ★★★★★
// ★★★★★ メインの拡張機能クラス (最終修正版) ★★★★★
export default class MinimalTimelineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._appMenuButton = null;
        this._runningAppsIndicator = null;
        this._windowModel = null;
        this._favsSettings = null;
        this._lifecycleTimeline = null;

        this._gsettingsConnections = [];
        this._shortcutId = null;
        this._startupSignalId = null;
    }

    _createSettingTimeline(source, key, type = 'string') {
        const getValue = () => {
            switch (type) {
                case 'strv': return source.get_strv(key);
                case 'boolean': return source.get_boolean(key);
                case 'integer': return source.get_int(key);
                default: return source.get_string(key);
            }
        };
        const timeline = Timeline(getValue());
        const id = source.connect(`changed::${key}`, () => timeline.define(Now, getValue()));
        this._gsettingsConnections.push({ source, id });
        return timeline;
    }

    enable() {
        this._lifecycleTimeline = Timeline(true);
        this._favsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

        this._lifecycleTimeline.bind(isEnabled => {
            if (isEnabled) {
                this._windowModel = new WindowModel();

                const extSettings = this.getSettings();
                const favoritesTimeline = this._createSettingTimeline(this._favsSettings, 'favorite-apps', 'strv');
                const mainIconPosTimeline = this._createSettingTimeline(extSettings, 'main-icon-position');
                const mainIconRankTimeline = this._createSettingTimeline(extSettings, 'main-icon-rank', 'integer');
                const dateMenuPosTimeline = this._createSettingTimeline(extSettings, 'date-menu-position');
                const dateMenuRankTimeline = this._createSettingTimeline(extSettings, 'date-menu-rank', 'integer');
                const showWindowIconListTimeline = this._createSettingTimeline(extSettings, 'show-window-icon-list', 'boolean');
                const hideOverviewTimeline = this._createSettingTimeline(extSettings, 'hide-overview-at-startup', 'boolean');
                const openPopupShortcutTimeline = this._createSettingTimeline(extSettings, 'open-popup-shortcut', 'strv');

                const mainIconPlacementTimeline = combineLatestWith((p, r) => ({ pos: p, rank: r }))(mainIconPosTimeline)(mainIconRankTimeline);
                const dateMenuPlacementTimeline = combineLatestWith((p, r) => ({ pos: p, rank: r }))(dateMenuPosTimeline)(dateMenuRankTimeline);

                this._appMenuButton = new AppMenuButton({
                    windowsTimeline: this._windowModel.windowsTimeline,
                    favoritesTimeline: favoritesTimeline,
                    extension: this,
                    settings: extSettings,
                });
                mainIconPlacementTimeline.map(({ pos, rank }) => {
                    if (this._appMenuButton?.is_destroyed === false) {
                        const container = this._appMenuButton.get_parent();
                        if (container) {
                            container.remove_child(this._appMenuButton);
                        }
                        Main.panel.addToStatusArea(`${this.uuid}-AppMenuButton`, this._appMenuButton, rank, pos);
                    }
                });

                // --- ▼▼▼ ここからが最終修正箇所 ▼▼▼ ---

                // 1. _runningAppsIndicator の全状態を単一のTimelineに合成
                //    combineLatestWith をカリー化された正しい形式で呼び出す
                const indicatorStateTimeline = combineLatestWith(
                    (show, placement) => ({
                        show,
                        pos: placement.pos,
                        rank: placement.rank,
                    })
                )(showWindowIconListTimeline)(mainIconPlacementTimeline);


                // 2. 合成された単一のTimelineを購読し、UIを一元管理する
                indicatorStateTimeline.map(({ show, pos, rank }) => {
                    if (show) {
                        // 表示がONの場合
                        if (!this._runningAppsIndicator) {
                            // ウィジェットが存在しない場合のみ生成
                            this._runningAppsIndicator = new RunningAppsIndicator({
                                windowsTimeline: this._windowModel.windowsTimeline,
                            });
                        }
                        // 配置を更新 (必ず一度親から削除してから追加する)
                        const container = this._runningAppsIndicator.get_parent();
                        if (container) {
                            container.remove_child(this._runningAppsIndicator);
                        }
                        Main.panel.addToStatusArea(`${this.uuid}-RunningAppsIndicator`, this._runningAppsIndicator, rank + 1, pos);
                    } else {
                        // 表示がOFFの場合
                        if (this._runningAppsIndicator) {
                            // ウィジェットが存在すれば完全に破棄してnullにする
                            this._runningAppsIndicator.destroy();
                            this._runningAppsIndicator = null;
                        }
                    }
                });

                // --- ▲▲▲ 修正箇所ここまで ▲▲▲ ---

                dateMenuPlacementTimeline.map(({ pos, rank }) => {
                    const dateMenu = Main.panel.statusArea.dateMenu;
                    if (!dateMenu) return;
                    const container = dateMenu.get_parent();
                    if (container) {
                        container.remove_child(dateMenu);
                    }
                    Main.panel[`_${pos}Box`].insert_child_at_index(dateMenu, rank);
                });

                openPopupShortcutTimeline.map(shortcut => {
                    if (this._shortcutId) {
                        Main.wm.removeKeybinding(this._shortcutId);
                        this._shortcutId = null;
                    }
                    if (shortcut && shortcut[0]) {
                        this._shortcutId = 'open-popup-shortcut';
                        Main.wm.addKeybinding(
                            this._shortcutId,
                            extSettings,
                            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                            Shell.ActionMode.NORMAL,
                            () => this._appMenuButton?.menu.toggle()
                        );
                    }
                });

                hideOverviewTimeline.map(shouldHide => {
                    if (shouldHide && !this._startupSignalId) {
                        this._startupSignalId = Main.layoutManager.connect('startup-complete', () => {
                            if (Main.overview.visible) Main.overview.hide();
                        });
                    } else if (!shouldHide && this._startupSignalId) {
                        Main.layoutManager.disconnect(this._startupSignalId);
                        this._startupSignalId = null;
                    }
                });

            } else { // isEnabledがfalseの時のクリーンアップ処理
                this._appMenuButton?.destroy();
                this._appMenuButton = null;
                this._runningAppsIndicator?.destroy();
                this._runningAppsIndicator = null;
                this._windowModel?.destroy();
                this._windowModel = null;

                if (this._shortcutId) {
                    Main.wm.removeKeybinding(this._shortcutId);
                    this._shortcutId = null;
                }
                if (this._startupSignalId) {
                    Main.layoutManager.disconnect(this._startupSignalId);
                    this._startupSignalId = null;
                }
                const dateMenu = Main.panel.statusArea.dateMenu;
                if (dateMenu) {
                    const container = dateMenu.get_parent();
                    if (container) {
                        container.remove_child(dateMenu);
                    }
                    Main.panel._centerBox.insert_child_at_index(dateMenu, 0);
                }
            }
            return Timeline(null);
        });
    }

    disable() {
        this._lifecycleTimeline?.define(Now, false);
        this._lifecycleTimeline = null;

        this._gsettingsConnections.forEach(({ source, id }) => {
            try {
                if (source && id) source.disconnect(id);
            } catch (e) { /* ignore */ }
        });
        this._gsettingsConnections = [];

        this._favsSettings = null;
    }

    _toggleFavorite(appId) {
        let favorites = this._favsSettings.get_strv('favorite-apps');
        const index = favorites.indexOf(appId);
        if (index === -1) favorites.push(appId);
        else favorites.splice(index, 1);
        this._favsSettings.set_strv('favorite-apps', favorites);
    }
}