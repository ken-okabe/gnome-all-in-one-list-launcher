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

// (NonClosingPopupBaseMenuItem, WindowModelクラスは変更なし)
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
            this.activate(buttonEvent);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_release_event(buttonEvent) {
        if (buttonEvent.button === 1) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_press_event(keyEvent) {
        const symbol = keyEvent.get_key_symbol();

        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            return Clutter.EVENT_PROPAGATE;
        }

        if (symbol === Clutter.KEY_space) {
            this.emit('custom-activate');
            return Clutter.EVENT_STOP;
        }

        else if (symbol === Clutter.KEY_BackSpace) {
            this.emit('custom-close');
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(keyEvent);
    }

    vfunc_touch_event(touchEvent) {
        if (touchEvent.type === Clutter.EventType.TOUCH_BEGIN) {
            this.activate(touchEvent);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

const WindowModel = GObject.registerClass(
    class WindowModel extends GObject.Object {
        _init() { super._init(); this.windowsTimeline = Timeline([]); this._windowTracker = Shell.WindowTracker.get_default(); this._signalIds = new Map(); this._trackerChangedId = this._windowTracker.connect('tracked-windows-changed', () => this.update()); this.update(); }
        update() { this._disconnectWindowSignals(); const g = new Map(); for (const w of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) { if (w.is_skip_taskbar()) continue; const a = this._windowTracker.get_window_app(w); if (!a) continue; const s = w.connect('notify::title', () => this.update()); this._signalIds.set(w, s); const i = a.get_id(); if (!g.has(i)) g.set(i, { app: a, windows: [] }); g.get(i).windows.push(w); } this.windowsTimeline.define(Now, Array.from(g.values())); }
        _disconnectWindowSignals() { for (const [w, i] of this._signalIds) { try { if (w && !w.is_destroyed) w.disconnect(i); } catch (e) { } } this._signalIds.clear(); }
        destroy() { if (this._trackerChangedId) { this._windowTracker.disconnect(this._trackerChangedId); this._trackerChangedId = null; } this._disconnectWindowSignals(); }
    });


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

            this._lastFocusedItem = null;
            this._resetting = false;

            const initialFavorites = favoritesTimeline.at(Now);
            this._selectedFavoriteIndexTimeline = Timeline(initialFavorites.length > 0 ? 0 : null);
            this._windowsTimeline = windowsTimeline;
            this._favoritesTimeline = favoritesTimeline;

            const favoritesStateTimeline = combineLatestWith(
                (favorites, selectedIndex) => ({ favorites, selectedIndex })
            )(this._favoritesTimeline)(this._selectedFavoriteIndexTimeline);

            const windowSectionDataTimeline = combineLatestWith(
                (windows, favs) => ({ windows, favs })
            )(this._windowsTimeline)(this._favoritesTimeline);

            this._initializeMenuStructure();

            favoritesStateTimeline.map(state => {
                if (this._isDestroyed) return;
                this._updateFavoritesSection(state.favorites, state.selectedIndex);
            });

            windowSectionDataTimeline.map(({ windows, favs }) => {
                if (this._isDestroyed) return;
                this._updateWindowsSection(windows, favs);
            });
        }

        open() {
            super.open();
            this.menu.actor.grab_key_focus();
            // ★★★ 修正点 1/3 ★★★
            const favCount = this._extension._favsSettings.get_strv('favorite-apps')?.length || 0;
            const initialIndex = favCount > 0 ? 0 : null;
            this._selectedFavoriteIndexTimeline.define(Now, initialIndex);
        }

        close() {
            super.close();
            this._selectedFavoriteIndexTimeline.define(Now, null);
        }

        _flashIcon(color) {
            if (this._isDestroyed || !this._panelIcon || this._panelIcon.is_destroyed) return;
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
            if (selectedIndex !== null && selectedIndex >= 0) {
                // ★★★ 修正点 2/3 ★★★
                const favs = this._extension._favsSettings.get_strv('favorite-apps');
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

        _resetMenuState() {
            if (this._resetting || this._isDestroyed) return;
            this._resetting = true;
            let handlerId = 0;
            handlerId = this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (this._isDestroyed) {
                    if (handlerId > 0) this.menu.disconnect(handlerId);
                    return;
                }
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
                // ★★★ 修正点 3/3 ★★★
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

        _launchNewInstance(app) {
            if (this._isDestroyed) return;
            app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT);
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

        _closeSelection(actor, item, itemType) {
            if (this._isDestroyed) return;
            if (itemType === 'group') {
                item.windows.forEach(win => win.delete(global.get_current_time()));
            } else {
                item.delete(global.get_current_time());
            }
        }

        _activateSelection(actor, item, itemType) {
            if (this._isDestroyed) return;
            const windowToActivate = (itemType === 'group') ? item.windows[0] : item;
            if (windowToActivate) {
                Main.activateWindow(windowToActivate);
            }
        }

        _updateFavoritesSection(favoriteAppIds, selectedIndex) {
            this._favoritesContainer?.destroy();
            this._favoritesContainer = null;
            if (favoriteAppIds && favoriteAppIds.length > 0) {
                this._favoritesContainer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                const favoritesBox = new St.BoxLayout({ x_expand: true, style_class: 'favorites-bar-container' });
                this._favoritesContainer.add_child(favoritesBox);
                for (const [index, appId] of favoriteAppIds.entries()) {
                    const app = Shell.AppSystem.get_default().lookup_app(appId);
                    if (!app) continue;
                    const button = new St.Button({
                        child: new St.Icon({ gicon: app.get_icon(), icon_size: 28, style_class: 'favorite-bar-app-icon' }),
                        style_class: 'favorite-button',
                        can_focus: false,
                        track_hover: true,
                    });
                    // 1. マウスホバー時の処理
                    button.connect('enter-event', () => {
                        this._selectedFavoriteIndexTimeline.define(Now, index);
                    });

                    // 2. マウスクリック時の処理
                    button.connect('clicked', () => {
                        this._selectedFavoriteIndexTimeline.define(Now, index);
                        this._launchNewInstance(app);
                    });


                    if (index === selectedIndex) {
                        button.add_style_class_name('selected');
                    }
                    favoritesBox.add_child(button);
                }
                if (this.menu.numMenuItems > 0) {
                    this.menu.box.insert_child_at_index(this._favoritesContainer.actor, 0);
                } else {
                    this.menu.addMenuItem(this._favoritesContainer);
                }
            }
        }

        _sortWindowGroups(windowGroups, favoriteAppIds) {
            // 【UIベースコード】のロジックを完全に移植
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
                // お気に入りでないもの同士はソートしない（元の順序を維持）
                return 0;
            });
            return windowGroups;
        }

        _updateWindowsSection(windowGroups, favoriteAppIds) {
            // このメソッド全体を【UIベースコード】から忠実に翻訳
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
                    // --- アプリヘッダー項目の描画 ---
                    const headerItem = new NonClosingPopupBaseMenuItem({
                        reactive: true,
                        can_focus: true,
                        style_class: 'window-list-item app-header-item'
                    });
                    headerItem._itemData = group;
                    headerItem._itemType = 'group';

                    const hbox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'app-header-container' });
                    headerItem.add_child(hbox);
                    hbox.add_child(new St.Icon({ gicon: group.app.get_icon(), icon_size: 20, style_class: 'app-header-icon' }));
                    hbox.add_child(new St.Label({ text: group.app.get_name(), y_align: Clutter.ActorAlign.CENTER, style_class: 'app-header-title' }));
                    hbox.add_child(new St.Widget({ x_expand: true }));

                    const actionsContainer = new St.BoxLayout({ style_class: 'item-actions-container' });

                    // お気に入りスターボタン
                    const isFavorite = favoriteAppIds.includes(group.app.get_id());
                    const starIcon = isFavorite ? 'starred-symbolic' : 'non-starred-symbolic';
                    const starButton = new St.Button({
                        style_class: 'favorite-star-button',
                        child: new St.Icon({ icon_name: starIcon, style_class: 'popup-menu-icon' })
                    });
                    starButton.connect('clicked', () => {
                        this._extension._toggleFavorite(group.app.get_id());
                    });
                    actionsContainer.add_child(starButton);

                    // 閉じるボタン
                    const groupCloseButton = new St.Button({
                        style_class: 'window-close-button',
                        child: new St.Icon({ icon_name: 'window-close-symbolic' })
                    });
                    groupCloseButton.connect('clicked', () => headerItem.emit('custom-close'));
                    actionsContainer.add_child(groupCloseButton);

                    hbox.add_child(actionsContainer);

                    // イベントハンドラの接続
                    headerItem.connect('custom-activate', () => this._handleWindowActivate(headerItem, group, 'group'));
                    headerItem.connect('custom-close', () => this._handleWindowClose(headerItem, group, 'group'));

                    this.menu.addMenuItem(headerItem);
                    this._windowsContainer.push(headerItem);

                    // --- ウィンドウ項目の描画 ---
                    const sortedWindows = group.windows.sort((winA, winB) => winA.get_frame_rect().y - winB.get_frame_rect().y);

                    for (const metaWindow of sortedWindows) {
                        const windowItem = new NonClosingPopupBaseMenuItem({
                            reactive: true,
                            can_focus: true,
                            style_class: 'window-list-item window-item'
                        });
                        windowItem._itemData = metaWindow;
                        windowItem._itemType = 'window';

                        const windowHbox = new St.BoxLayout({ x_expand: true, style_class: 'window-item-container' });
                        windowItem.add_child(windowHbox);
                        windowHbox.add_child(new St.Label({ text: metaWindow.get_title() || '...', y_align: Clutter.ActorAlign.CENTER, style_class: 'window-item-title' }));
                        windowHbox.add_child(new St.Widget({ x_expand: true }));

                        const windowCloseButton = new St.Button({
                            style_class: 'window-close-button',
                            child: new St.Icon({ icon_name: 'window-close-symbolic' })
                        });
                        windowCloseButton.connect('clicked', () => windowItem.emit('custom-close'));
                        windowHbox.add_child(windowCloseButton);

                        // イベントハンドラの接続
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

        destroy() {
            if (this._isDestroyed) return;
            this._isDestroyed = true;
            super.destroy();
        }
    });


export default class MinimalTimelineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._appMenuButton = null;
        this._windowModel = null;
        this._favsSettings = null; // プロパティをクラスレベルで宣言
        this._lifecycleTimeline = null;
        this._favsConnectionId = null; // 接続IDもクラスレベルで管理
    }

    _createSettingTimeline(settings, key) {
        const t = Timeline(settings.get_strv(key));
        // GSettingsの接続IDを返し、呼び出し元で管理するように変更
        const id = settings.connect(`changed::${key}`, () => {
            t.define(Now, settings.get_strv(key));
        });
        return { timeline: t, GSettingConnectionId: id };
    }

    enable() {
        // ★★★ enable/disableメソッドを全面的に修正 ★★★
        this._lifecycleTimeline = Timeline(true);

        // favsSettingsをインスタンスのプロパティとして初期化
        this._favsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        const favsInfo = this._createSettingTimeline(this._favsSettings, 'favorite-apps');
        this._favsConnectionId = favsInfo.GSettingConnectionId; // 接続IDを保存

        this._lifecycleTimeline.bind(isEnabled => {
            if (isEnabled) {
                this._windowModel = new WindowModel();

                this._appMenuButton = new AppMenuButton({
                    windowsTimeline: this._windowModel.windowsTimeline,
                    favoritesTimeline: favsInfo.timeline,
                    extension: this,
                    settings: this.getSettings(),
                });
                Main.panel.addToStatusArea(this.uuid, this._appMenuButton);
            } else {
                // isEnabledがfalseになったらUIとモデルのみを破棄
                this._appMenuButton?.destroy();
                this._appMenuButton = null;
                this._windowModel?.destroy();
                this._windowModel = null;
            }
            return Timeline(null);
        });
    }

    disable() {
        // 1. ライフサイクルをfalseにして、bindの破棄ロジックをトリガー
        this._lifecycleTimeline?.define(Now, false);
        this._lifecycleTimeline = null;

        // 2. GSettingsのリスナーを明示的に切断
        if (this._favsSettings && this._favsConnectionId) {
            this._favsSettings.disconnect(this._favsConnectionId);
            this._favsConnectionId = null;
        }
        this._favsSettings = null;
    }

    _toggleFavorite(appId) {
        let favorites = this._favsSettings.get_strv('favorite-apps');
        const index = favorites.indexOf(appId);
        if (index === -1) {
            favorites.push(appId);
        } else {
            favorites.splice(index, 1);
        }
        this._favsSettings.set_strv('favorite-apps', favorites);
    }
}