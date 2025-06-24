import St from 'gi://St';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Timeline, Now, combineLatestWith } from './timeline.js';

// --- ▼▼▼ 修正されたカスタムメニュー項目クラス ▼▼▼ ---

const NonClosingPopupBaseMenuItem = GObject.registerClass({
    Signals: {
        'custom-activate': {}, // ウィンドウ/グループをアクティブにするためのシグナル
        'custom-close': {},    // ウィンドウ/グループを閉じるためのシグナル
    },
}, class NonClosingPopupBaseMenuItem extends PopupMenu.PopupBaseMenuItem {

    _init(params) {
        super._init(params);
        // メニューの自動クローズを無効にする
        this.activate = (event) => {
            // カスタムアクティベートシグナルを発火してから、メニューが閉じないようにする
            this.emit('custom-activate');
            // メニューが閉じるのを防ぐため、何も返さない（またはfalseを返す）
            return false;
        };
    }

    // クリックイベント
    vfunc_button_press_event(buttonEvent) {
        if (buttonEvent.button === 1) { // 左クリック
            // activateメソッドを呼び出すことで、通常のクリック処理を実行
            this.activate(buttonEvent);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // クリック解放イベントも確実に止める
    vfunc_button_release_event(buttonEvent) {
        if (buttonEvent.button === 1) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_press_event(keyEvent) {
        const symbol = keyEvent.get_key_symbol();

        // [+] Enterキーを明示的に捕捉する
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            // activateを発生させず、イベントをメニュー全体（AppMenuButton）に伝播させる
            return Clutter.EVENT_PROPAGATE;
        }

        // Spaceキーはここで処理してイベントを停止する
        if (symbol === Clutter.KEY_space) {
            this.emit('custom-activate');
            return Clutter.EVENT_STOP;
        }

        // Backspaceキーもここで処理してイベントを停止する
        else if (symbol === Clutter.KEY_BackSpace) {
            this.emit('custom-close');
            return Clutter.EVENT_STOP;
        }

        // 上下の矢印キーなど、上記以外のキーだけをデフォルト処理に任せる
        return super.vfunc_key_press_event(keyEvent);
    }
    // タッチイベントも処理
    vfunc_touch_event(touchEvent) {
        if (touchEvent.type === Clutter.EventType.TOUCH_BEGIN) {
            this.activate(touchEvent);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

const NonClosingPopupMenuItem = GObject.registerClass(
    class NonClosingPopupMenuItem extends NonClosingPopupBaseMenuItem {
        _init(text, params) {
            super._init(params);
            this.label = new St.Label({ text: text });
            this.add_child(this.label);
        }
    });

// --- ▲▲▲ 修正されたカスタムメニューアイテムクラス ▲▲▲ ---


const WindowModel = GObject.registerClass({
    Signals: { 'updated': {} },
}, class WindowModel extends GObject.Object {
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
        const groupedByApp = new Map();
        for (const metaWindow of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
            if (metaWindow.is_skip_taskbar()) continue;
            const app = this._windowTracker.get_window_app(metaWindow);
            if (!app) continue;
            const titleId = metaWindow.connect('notify::title', () => this.update());
            const posId = metaWindow.connect('position-changed', () => this.update());
            this._signalIds.set(metaWindow, [titleId, posId]);
            const appId = app.get_id();
            if (!groupedByApp.has(appId)) {
                groupedByApp.set(appId, { app, windows: [] });
            }
            groupedByApp.get(appId).windows.push(metaWindow);
        }
        this.windowsTimeline.define(Now, Array.from(groupedByApp.values()));
        this.emit('updated');
    }
    _disconnectWindowSignals() {
        for (const [win, ids] of this._signalIds) {
            for (const id of ids) {
                try { if (win && !win.is_destroyed) win.disconnect(id); } catch (e) { /* ignore */ }
            }
        }
        this._signalIds.clear();
    }
    destroy() {
        if (this._trackerChangedId) this._windowTracker.disconnect(this._trackerChangedId);
        this._disconnectWindowSignals();
    }
});

const WindowIconList = GObject.registerClass(
    class WindowIconList extends St.BoxLayout {
        _init() {
            super._init({ style_class: 'panel-buttons' });
        }
        update(windowGroups) {
            if (!this || this.is_destroyed) return;
            this.destroy_all_children();
            if (!windowGroups) return;
            // ★ グループ内ウィンドウをX座標順でソート
            windowGroups.forEach(group => {
                const sortedWindows = group.windows.slice().sort((winA, winB) => {
                    return winA.get_frame_rect().x - winB.get_frame_rect().x;
                });
                sortedWindows.forEach(win => {
                    const icon = new St.Icon({
                        gicon: group.app.get_icon(),
                        style_class: 'system-status-icon',
                        icon_size: 20
                    });
                    const button = new St.Button({ child: icon });
                    button.connect('clicked', () => Main.activateWindow(win));
                    this.add_child(button);
                });
            });
        }
        destroy() { super.destroy(); }
    });

const WindowIconListIndicator = GObject.registerClass(
    class WindowIconListIndicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, null, false);
            this.reactive = false;
            this._iconList = new WindowIconList();
            this.add_child(this._iconList);
        }
        update(windowGroups) {
            if (!this._iconList) return;
            this._iconList.update(windowGroups);
        }
        destroy() {
            if (this._iconList) {
                this._iconList.destroy();
                this._iconList = null;
            }
            super.destroy();
        }
    });


// ======================================================================
// AppMenuButton クラス (全体)
// ======================================================================
const AppMenuButton = GObject.registerClass(class AppMenuButton extends PanelMenu.Button {
    _init(params) {
        super._init(0.0, 'Timeline Event Network');
        this._isDestroyed = false;

        this._panelIcon = new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'system-status-icon' });
        this.add_child(this._panelIcon);

        this._extension = params.extension;
        this._settings = params.settings;

        this._favoritesContainer = null;
        this._separatorItem = null;
        this._windowsContainer = [];

        this._lastFocusedItem = null;
        this._resetting = false;

        const favoritesTimeline = params.favoritesTimeline;
        const windowsTimeline = params.windowsTimeline;
        const initialFavorites = favoritesTimeline.at(Now);

        this._selectedFavoriteIndexTimeline = Timeline(initialFavorites.length > 0 ? 0 : null);

        const favoritesStateTimeline = combineLatestWith(
            (favs, selectedIndex) => ({ favs, selectedIndex })
        )(favoritesTimeline)(this._selectedFavoriteIndexTimeline);

        const windowSectionDataTimeline = combineLatestWith(
            (windows, favs) => ({ windows, favs })
        )(windowsTimeline)(favoritesTimeline);

        this._initializeMenuStructure();
        this._performInitialDisplay(initialFavorites, this._selectedFavoriteIndexTimeline.at(Now), windowsTimeline.at(Now));

        favoritesStateTimeline.map(state => {
            if (this._isDestroyed) return;
            this._updateFavoritesSection(state.favs, state.selectedIndex);
        });

        windowSectionDataTimeline.map(({ windows, favs }) => {
            if (this._isDestroyed) return;
            this._updateWindowsSection(windows, favs);
        });
    }

    _flashIcon(color) {
        const originalStyle = this._panelIcon.get_style();
        this._panelIcon.set_style(`background-color: ${color};`);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this._panelIcon && !this._panelIcon.is_destroyed) {
                this._panelIcon.set_style(originalStyle);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _initializeMenuStructure() {
        if (this._isDestroyed) return;
        this.menu.removeAll();
        this.menu.actor.connect('key-press-event', this._onMenuKeyPress.bind(this));

        this.menu.connect('active-item-changed', (menu, item) => {
            this._lastFocusedItem = item;
        });

        this._favoritesContainer = null;
        this._separatorItem = null;
        this._windowsContainer = [];
    }

    _handleFavLaunch() {
        this._flashIcon('blue');

        const selectedIndex = this._selectedFavoriteIndexTimeline.at(Now);
        if (selectedIndex !== null) {
            const favs = this._extension.favsSettings.get_strv('favorite-apps');
            const appId = favs[selectedIndex];
            if (appId) {
                const app = Shell.AppSystem.get_default().lookup_app(appId);
                if (app) {
                    this._launchNewInstance(app);
                    this._resetMenuState();
                }
            }
        }
    }

    _handleWindowActivate(actor, item, itemType) {
        this._flashIcon('green');
        this._activateSelection(actor, item, itemType);
    }

    _handleWindowClose(actor, item, itemType) {
        this._flashIcon('red');
        this._closeSelection(actor, item, itemType);
        this._resetMenuState();
    }

    _resetMenuState() {
        if (this._resetting) return;
        this._resetting = true;

        let handlerId = 0;

        handlerId = this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (!isOpen) {
                this.menu.open();

                if (this.menu.first_item) {
                    this.menu.set_active_item(this.menu.first_item);
                }
                this.menu.actor.grab_key_focus();

                if (handlerId > 0) {
                    this.menu.disconnect(handlerId);
                }

                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._resetting = false;
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        this.menu.close();
    }

    _onMenuKeyPress(actor, event) {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
            this._flashIcon('orange');
            const favs = this._extension.favsSettings.get_strv('favorite-apps');
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

    _performInitialDisplay(initialFavorites, initialSelectedIndex, initialWindows) {
        if (this._isDestroyed) return;
        this._updateFavoritesSection(initialFavorites, initialSelectedIndex);
        this._updateWindowsSection(initialWindows, initialFavorites);
    }

    _updateFavoritesSection(favoriteAppIds, selectedIndex) {
        if (this._isDestroyed) return;
        this._favoritesContainer?.destroy();
        this._favoritesContainer = null;
        this._separatorItem?.destroy();
        this._separatorItem = null;
        if (favoriteAppIds && favoriteAppIds.length > 0) {
            const appSystem = Shell.AppSystem.get_default();
            this._favoritesContainer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const favoritesBox = new St.BoxLayout({ x_expand: true });
            favoritesBox.spacing = 8;
            this._favoritesContainer.add_child(favoritesBox);
            favoriteAppIds.forEach((appId, index) => {
                const app = appSystem.lookup_app(appId);
                if (!app) return;
                const button = new St.Button({
                    child: new St.Icon({ gicon: app.get_icon(), icon_size: 28 }),
                    can_focus: false, track_hover: true, style_class: 'favorite-button'
                });
                if (index === selectedIndex) button.add_style_class_name('selected');
                button.connect('clicked', () => this._launchNewInstance(app));
                favoritesBox.add_child(button);
            });
            this.menu.box.insert_child_at_index(this._favoritesContainer.actor, 0);
            this._separatorItem = new PopupMenu.PopupSeparatorMenuItem();
            this.menu.box.insert_child_at_index(this._separatorItem.actor, 1);
        }
    }

    // ======================================================================
    // AppMenuButton._updateWindowsSection メソッド (全体)
    // このブロックで既存のメソッドを完全に置き換えてください。
    // ======================================================================
    _updateWindowsSection(windowGroups, favoriteAppIds) {
        if (this._isDestroyed) return;

        let lastFocusedId = null;
        if (this._lastFocusedItem && !this._lastFocusedItem.is_destroyed) {
            const itemData = this._lastFocusedItem._itemData;
            const itemType = this._lastFocusedItem._itemType;
            if (itemType === 'group') {
                lastFocusedId = `app:${itemData.app.get_id()}`;
            } else if (itemType === 'window') {
                lastFocusedId = `win:${itemData.get_id()}`;
            }
        }

        this._windowsContainer.forEach(child => child.destroy());
        this._windowsContainer = [];

        if (!windowGroups || windowGroups.length === 0) {
            const noWindowsItem = new PopupMenu.PopupMenuItem(_("No open windows"), { reactive: false });
            this.menu.addMenuItem(noWindowsItem);
            this._windowsContainer.push(noWindowsItem);
        } else {
            const sortedGroups = this._extension._sortWindowGroups([...windowGroups], favoriteAppIds);

            for (const group of sortedGroups) {
                // --- ▼▼▼ ヘッダー項目の実装 ▼▼▼ ---
                const headerItem = new NonClosingPopupBaseMenuItem({
                    reactive: true,
                    can_focus: true,
                    style_class: 'window-list-item' // CSSホバー効果のためクラスを追加
                });
                headerItem._itemData = group;
                headerItem._itemType = 'group';

                const hbox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
                headerItem.add_child(hbox);

                hbox.add_child(new St.Icon({ gicon: group.app.get_icon(), icon_size: 20 }));
                hbox.add_child(new St.Label({ text: group.app.get_name(), y_align: Clutter.ActorAlign.CENTER }));
                hbox.add_child(new St.Widget({ x_expand: true })); // スペーサー

                // 【変更点】閉じるボタンを追加
                const groupCloseButton = new St.Button({
                    style_class: 'window-close-button',
                    child: new St.Icon({ icon_name: 'window-close-symbolic' })
                });
                groupCloseButton.connect('clicked', () => headerItem.emit('custom-close'));
                hbox.add_child(groupCloseButton);

                if (this._extension._isAppLaunchable(group.app)) {
                    const isFavorite = favoriteAppIds.includes(group.app.get_id());
                    const starIcon = isFavorite ? 'starred-symbolic' : 'non-starred-symbolic';
                    const starButton = new St.Button({
                        style_class: 'favorite-star-button',
                        child: new St.Icon({
                            icon_name: starIcon,
                            style_class: 'popup-menu-icon'
                        })
                    });
                    starButton.connect('clicked', (button, event) => {
                        this._extension._toggleFavorite(group.app.get_id());
                        if (event) event.stop_propagation();
                        return Clutter.EVENT_STOP;
                    });
                    hbox.add_child(starButton);
                }

                headerItem.connect('custom-activate', () => this._handleWindowActivate(headerItem, group, 'group'));
                headerItem.connect('custom-close', () => this._handleWindowClose(headerItem, group, 'group'));

                this.menu.addMenuItem(headerItem);
                this._windowsContainer.push(headerItem);

                // --- ▼▼▼ ウィンドウ項目の実装 ▼▼▼ ---
                const sortedWindows = group.windows.sort((winA, winB) => winA.get_frame_rect().y - winB.get_frame_rect().y);

                for (const metaWindow of sortedWindows) {
                    // 【変更点】レイアウトのため NonClosingPopupBaseMenuItem を使用
                    const windowItem = new NonClosingPopupBaseMenuItem({
                        reactive: true,
                        can_focus: true,
                        style_class: 'window-list-item' // CSSホバー効果のためクラスを追加
                    });
                    windowItem._itemData = metaWindow;
                    windowItem._itemType = 'window';

                    // 【変更点】インデントとボタン配置のため BoxLayout を使用
                    const windowHbox = new St.BoxLayout({ x_expand: true, style: 'padding-left: 20px;' });
                    windowItem.add_child(windowHbox);

                    windowHbox.add_child(new St.Label({ text: metaWindow.get_title() || '...', y_align: Clutter.ActorAlign.CENTER }));
                    windowHbox.add_child(new St.Widget({ x_expand: true })); // スペーサー

                    // 【変更点】閉じるボタンを追加
                    const windowCloseButton = new St.Button({
                        style_class: 'window-close-button',
                        child: new St.Icon({ icon_name: 'window-close-symbolic' })
                    });
                    windowCloseButton.connect('clicked', () => windowItem.emit('custom-close'));
                    windowHbox.add_child(windowCloseButton);

                    windowItem.connect('custom-activate', () => this._handleWindowActivate(windowItem, metaWindow, 'window'));
                    windowItem.connect('custom-close', () => this._handleWindowClose(windowItem, metaWindow, 'window'));

                    this.menu.addMenuItem(windowItem);
                    this._windowsContainer.push(windowItem);
                }
            }
        }

        if (lastFocusedId) {
            let itemToFocus = null;
            for (const newItem of this._windowsContainer) {
                if (!newItem._itemData) continue;
                const itemData = newItem._itemData;
                const itemType = newItem._itemType;
                let currentId = null;
                if (itemType === 'group') {
                    currentId = `app:${itemData.app.get_id()}`;
                } else if (itemType === 'window') {
                    currentId = `win:${itemData.get_id()}`;
                }
                if (currentId === lastFocusedId) {
                    itemToFocus = newItem;
                    break;
                }
            }
            if (itemToFocus) {
                this.menu.set_active_item(itemToFocus);
            } else {
                this._lastFocusedItem = null;
            }
        }
    }

    _isStarButtonClick(source, starButton) {
        let current = source;
        while (current) {
            if (current === starButton) {
                return true;
            }
            current = current.get_parent();
        }
        return false;
    }

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

    _launchNewInstance(app) {
        if (this._isDestroyed) return;
        app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT);
    }

    destroy() {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        super.destroy();
    }
});

// ======================================================================
// AllWindowsExtension クラス (全体)
// ======================================================================
export default class AllWindowsExtension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this.favsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        this.appMenuButton = null;
        this.openPopupShortcutId = 'open-popup-shortcut';
        this._startupCompleteId = null;
        this._disposer = null;
        if (this.settings.get_boolean('hide-overview-at-startup')) {
            this._startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
                if (Main.overview.visible) {
                    Main.overview.hide();
                }
                if (this._startupCompleteId) {
                    Main.layoutManager.disconnect(this._startupCompleteId);
                    this._startupCompleteId = null;
                }
            });
        }
        this._disposer = this._buildAndWireUI();
        this._bindShortcuts();
    }

    disable() {
        this._unbindShortcuts();
        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = null;
        }
        this._disposer?.();
        this._disposer = null;
        this.appMenuButton = null;
    }

    _bindShortcuts() {
        Main.wm.addKeybinding(
            this.openPopupShortcutId,
            this.settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL,
            () => {
                this.appMenuButton?.menu.toggle();
            }
        );
    }

    _unbindShortcuts() {
        Main.wm.removeKeybinding(this.openPopupShortcutId);
    }

    // --- ▼▼▼ ここからが修正箇所 ▼▼▼ ---
    _isAppLaunchable(app) {
        if (!app) {
            return false;
        }
        
        const appInfo = app.get_app_info();
        // 【修正】appInfoがnullの場合を考慮するnullチェックを追加
        if (!appInfo) {
            return false;
        }

        return appInfo.should_show();
    }
    // --- ▲▲▲ 修正箇所ここまで ▲▲▲ ---

    _buildAndWireUI() {
        const sessionResources = { models: [], listeners: [] };
        const createSettingTimeline = (source, key, type) => {
            const getValue = () => {
                if (type === 'strv') return source.get_strv(key);
                if (type === 'boolean') return source.get_boolean(key);
                if (type === 'integer') return source.get_int(key);
                return source.get_string(key);
            };
            const timeline = Timeline(getValue());
            const id = source.connect(`changed::${key}`, () => timeline.define(Now, getValue()));
            sessionResources.listeners.push({ source, id });
            return timeline;
        };

        const windowModel = new WindowModel();
        sessionResources.models.push(windowModel);

        const favoritesTimeline = createSettingTimeline(this.favsSettings, 'favorite-apps', 'strv');
        const showWindowIconListTimeline = createSettingTimeline(this.settings, 'show-window-icon-list', 'boolean');
        const mainIconPosTimeline = createSettingTimeline(this.settings, 'main-icon-position', 'string');
        const mainIconRankTimeline = createSettingTimeline(this.settings, 'main-icon-rank', 'integer');
        const dateMenuPosTimeline = createSettingTimeline(this.settings, 'date-menu-position', 'string');
        const dateMenuRankTimeline = createSettingTimeline(this.settings, 'date-menu-rank', 'integer');

        const mainIconPlacementTimeline = combineLatestWith((p, r) => ({ p, r }))(mainIconPosTimeline)(mainIconRankTimeline);
        const dateMenuPlacementTimeline = combineLatestWith((p, r) => ({ p, r }))(dateMenuPosTimeline)(dateMenuRankTimeline);

        this.appMenuButton = new AppMenuButton({
            extension: this,
            settings: this.settings,
            windowsTimeline: windowModel.windowsTimeline,
            favoritesTimeline: favoritesTimeline
        });

        mainIconPlacementTimeline.map(({ p, r }) => {
            if (this.appMenuButton.is_destroyed) return;
            Main.panel.addToStatusArea(`${this.uuid}-AppMenuButton`, this.appMenuButton, r, p);
        });

        let windowIconListWidget = null;

        const combinedWinAndFavs = combineLatestWith(
            (windowGroups, favs) => ({ windowGroups, favs })
        )(windowModel.windowsTimeline)(favoritesTimeline);
        const iconListDataTimeline = combineLatestWith(
            (winFavs, show) => ({ ...winFavs, show })
        )(combinedWinAndFavs)(showWindowIconListTimeline);

        iconListDataTimeline.map(({ windowGroups, favs, show }) => {
            const { p, r } = mainIconPlacementTimeline.at(Now);

            if (!show) {
                if (windowIconListWidget) {
                    windowIconListWidget.destroy();
                    windowIconListWidget = null;
                }
                return;
            }

            if (!windowIconListWidget) {
                windowIconListWidget = new WindowIconListIndicator();
                Main.panel.addToStatusArea(`${this.uuid}-WindowIconList`, windowIconListWidget, r + 1, p);
            }

            if (windowIconListWidget && !windowIconListWidget.is_destroyed) {
                const sortedGroups = this._sortWindowGroups([...windowGroups], favs);
                windowIconListWidget.update(sortedGroups);
            }
        });

        dateMenuPlacementTimeline.map(({ p, r }) => {
            const dateMenu = Main.panel.statusArea.dateMenu;
            if (!dateMenu) return;
            const targetBox = Main.panel[`_${p}Box`];
            if (!targetBox) return;
            if (dateMenu.get_parent()) dateMenu.get_parent().remove_child(dateMenu);
            targetBox.insert_child_at_index(dateMenu, r);
        });

        return () => {
            sessionResources.listeners.forEach(l => {
                try { if (l.source && l.id) l.source.disconnect(l.id); } catch (e) { }
            });
            try {
                const dateMenu = Main.panel.statusArea.dateMenu;
                if (dateMenu?.get_parent()) dateMenu.get_parent().remove_child(dateMenu);
                Main.panel._centerBox.insert_child_at_index(dateMenu, 0);
            } catch (e) { }
            this.appMenuButton?.destroy();
            windowIconListWidget?.destroy();
            sessionResources.models.forEach(m => { try { m.destroy(); } catch (e) { } });
        };
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
            if (aIsFav && bIsFav) {
                return favIndexA - favIndexB;
            }
            return 0;
        });
        return windowGroups;
    }

    _toggleFavorite(appId) {
        let favorites = this.favsSettings.get_strv('favorite-apps');
        const index = favorites.indexOf(appId);
        if (index === -1) favorites.push(appId);
        else favorites.splice(index, 1);
        this.favsSettings.set_strv('favorite-apps', favorites);
    }
}