// extension.js

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

// =====================================================================
// === グローバルヘルパー関数 (Global Helper Function) ===
// =====================================================================
/**
 * お気に入り優先と起動順（スタッキングオーダー）の共通ルールで
 * ウィンドウグループまたはウィンドウのリストをソートします。
 * この関数はどのクラスにも属さないため、グローバルに利用可能です。
 * @param {Array<T>} items - ソート対象の配列
 * @param {string[]} favoriteAppIds - お気に入りアプリのIDリスト
 * @param {(item: T) => string | undefined} getAppId - itemからアプリIDを取得する関数
 * @returns {Array<T>} ソート済みの配列（元の配列を直接変更します）
 * @template T
 */
function _sortUsingCommonRules(items, favoriteAppIds, getAppId) {
    const favoriteOrder = new Map(favoriteAppIds.map((id, index) => [id, index]));
    const originalOrder = new Map(items.map((item, index) => [item, index]));

    items.sort((a, b) => {
        const appIdA = getAppId(a);
        const appIdB = getAppId(b);

        const favIndexA = favoriteOrder.get(appIdA);
        const favIndexB = favoriteOrder.get(appIdB);

        const aIsFav = favIndexA !== undefined;
        const bIsFav = favIndexB !== undefined;

        if (aIsFav && !bIsFav) return -1;
        if (!aIsFav && bIsFav) return 1;
        if (aIsFav && bIsFav) return favIndexA - favIndexB;

        return originalOrder.get(a) - originalOrder.get(b);
    });

    return items;
}

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
// extension.js内の既存のRunningAppsIconListクラスを、以下のコードで完全に置き換えてください。

const RunningAppsIconList = GObject.registerClass(
    class RunningAppsIconList extends St.BoxLayout {
        _init() {
            super._init({ style_class: 'window-icon-list-container' });
            this._windowTracker = Shell.WindowTracker.get_default();
        }

        update(windowGroups, favoriteAppIds) {
            this.destroy_all_children();
            if (!windowGroups) return;

            // 手順1: グループ構造を維持したまま、グループ単位でソートする
            // (AppMenuButtonと対称的な実装)
            const getAppIdForGroup = group => group.app.get_id();
            _sortUsingCommonRules(windowGroups, favoriteAppIds, getAppIdForGroup);

            // 手順2: ソート済みの各グループを順番に処理する
            for (const group of windowGroups) {
                // 手順3: 各グループの内部で、ウィンドウをX座標でソートする
                const sortedWindows = group.windows.sort((winA, winB) => {
                    return winA.get_frame_rect().x - winB.get_frame_rect().x;
                });

                // 手順4: ソートされたウィンドウの順序でアイコンを描画する
                for (const win of sortedWindows) {
                    const app = this._windowTracker.get_window_app(win);
                    if (!app) continue;

                    const icon = new St.Icon({ gicon: app.get_icon(), style_class: 'panel-window-icon' });
                    const button = new St.Button({ child: icon, style_class: 'panel-button' });
                    button.connect('clicked', () => Main.activateWindow(win));
                    this.add_child(button);
                }
            }
        }
    }
);

// --- RunningAppsIndicator クラス: 新定義に差し替え ---
const RunningAppsIndicator = GObject.registerClass(
    class RunningAppsIndicator extends PanelMenu.Button {
        _init({ windowsTimeline, favoritesTimeline }) {
            super._init(0.0, null, false);
            this.reactive = false;
            this._iconList = new RunningAppsIconList();
            this.add_child(this._iconList);

            const combinedTimeline = combineLatestWith(
                (win, fav) => ({ win, fav })
            )(windowsTimeline)(favoritesTimeline);

            combinedTimeline.map(({ win, fav }) => {
                this._iconList?.update(win, fav);
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
        // 【置換後の _init メソッド】
        _init({ windowsTimeline, favoritesTimeline, closeOnFavLaunchTimeline, closeOnListActivateTimeline, closeOnListCloseTimeline, extension, settings }) {
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
            this._closeOnFavLaunchTimeline = closeOnFavLaunchTimeline;
            this._closeOnListActivateTimeline = closeOnListActivateTimeline;
            this._closeOnListCloseTimeline = closeOnListCloseTimeline;
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
        // 【置換後の _handleFavLaunch メソッド】
        _handleFavLaunch() {
            this._flashIcon('blue');
            const selectedIndex = this._selectedFavoriteIndexTimeline.at(Now);
            if (selectedIndex !== null && selectedIndex >= 0) {
                const favs = this._extension._favsSettings.get_strv('favorite-apps');
                const appId = favs[selectedIndex];
                if (appId) {
                    const app = Shell.AppSystem.get_default().lookup_app(appId);
                    if (app) {
                        this._launchNewInstance(app);
                        if (this._closeOnFavLaunchTimeline.at(Now)) {
                            this.menu.close();
                        }
                        else {
                            this._resetMenuState();
                        }
                    }
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

            // ★ 新規追加: ショートカットキーでメニューを閉じる機能
            if (this._isMenuCloseShortcut(symbol, event)) {
                this._flashIcon('purple'); // 閉じる動作を視覚的に示す
                this.menu.close();
                return Clutter.EVENT_STOP;
            }

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

        // ★ 新規メソッド: 現在押されたキーがメニューを閉じるショートカットキーかどうかを判定
        _isMenuCloseShortcut(symbol, event) {
            // 設定からopen-popup-shortcutを取得
            const settings = this._extension.getSettings();
            const shortcutKeys = settings.get_strv('open-popup-shortcut');

            if (!shortcutKeys || shortcutKeys.length === 0) {
                return false;
            }

            // ショートカットキーの文字列をパース（例: "<Super>space"）
            const shortcutString = shortcutKeys[0];
            const parsedShortcut = this._parseShortcutString(shortcutString);

            if (!parsedShortcut) {
                return false;
            }

            // 修飾キーの状態をチェック
            const modifierState = event.get_state();

            // 各修飾キーが正しく押されているかチェック
            let modifiersMatch = true;
            for (const modifier of parsedShortcut.modifiers) {
                if (!(modifierState & modifier)) {
                    modifiersMatch = false;
                    break;
                }
            }

            if (!modifiersMatch) {
                return false;
            }

            // キーシンボルが一致するかチェック
            return symbol === parsedShortcut.key;
        }

        // ★ 新規メソッド: ショートカット文字列をパースして修飾キーとキーシンボルに分解
        _parseShortcutString(shortcutString) {
            if (!shortcutString || shortcutString.trim() === '') {
                return null;
            }

            const modifiers = [];
            let keyName = shortcutString;

            // 修飾キーを抽出
            if (shortcutString.includes('<Super>')) {
                modifiers.push(Clutter.ModifierType.SUPER_MASK);
                keyName = keyName.replace('<Super>', '');
            }
            if (shortcutString.includes('<Control>')) {
                modifiers.push(Clutter.ModifierType.CONTROL_MASK);
                keyName = keyName.replace('<Control>', '');
            }
            if (shortcutString.includes('<Alt>')) {
                modifiers.push(Clutter.ModifierType.MOD1_MASK);
                keyName = keyName.replace('<Alt>', '');
            }
            if (shortcutString.includes('<Shift>')) {
                modifiers.push(Clutter.ModifierType.SHIFT_MASK);
                keyName = keyName.replace('<Shift>', '');
            }

            // キー名をClutterのキーシンボルに変換
            let keySymbol;
            switch (keyName.toLowerCase()) {
                case 'space':
                    keySymbol = Clutter.KEY_space;
                    break;
                case 'tab':
                    keySymbol = Clutter.KEY_Tab;
                    break;
                case 'return':
                case 'enter':
                    keySymbol = Clutter.KEY_Return;
                    break;
                case 'escape':
                    keySymbol = Clutter.KEY_Escape;
                    break;
                case 'f1': keySymbol = Clutter.KEY_F1; break;
                case 'f2': keySymbol = Clutter.KEY_F2; break;
                case 'f3': keySymbol = Clutter.KEY_F3; break;
                case 'f4': keySymbol = Clutter.KEY_F4; break;
                case 'f5': keySymbol = Clutter.KEY_F5; break;
                case 'f6': keySymbol = Clutter.KEY_F6; break;
                case 'f7': keySymbol = Clutter.KEY_F7; break;
                case 'f8': keySymbol = Clutter.KEY_F8; break;
                case 'f9': keySymbol = Clutter.KEY_F9; break;
                case 'f10': keySymbol = Clutter.KEY_F10; break;
                case 'f11': keySymbol = Clutter.KEY_F11; break;
                case 'f12': keySymbol = Clutter.KEY_F12; break;
                default:
                    // 単一文字の場合
                    if (keyName.length === 1) {
                        const char = keyName.toLowerCase();
                        if (char >= 'a' && char <= 'z') {
                            keySymbol = Clutter.KEY_a + (char.charCodeAt(0) - 'a'.charCodeAt(0));
                        } else if (char >= '0' && char <= '9') {
                            keySymbol = Clutter.KEY_0 + (char.charCodeAt(0) - '0'.charCodeAt(0));
                        }
                    }
                    break;
            }

            if (keySymbol === undefined) {
                console.warn(`Unknown key name: ${keyName}`);
                return null;
            }

            return {
                modifiers: modifiers,
                key: keySymbol
            };
        }

        // 【新規追加する _isAppLaunchable メソッド】
        _isAppLaunchable(app) {
            if (!app) {
                return false;
            }
            const appInfo = app.get_app_info();
            if (!appInfo) {
                return false;
            }
            return appInfo.should_show();
        }

        /**
         * アプリケーションの新規インスタンス起動プロセスを開始します。
         * @param {Shell.App} app - 起動するアプリケーションオブジェクト。
         */


        // より簡潔な代替実装（Timelineを使わない場合）
        _launchNewInstance(app) {
            if (this._isDestroyed) {
                console.warn("Attempted to launch on a destroyed instance.");
                return;
            }

            const launchMethods = [
                {
                    name: 'request_new_window',
                    execute: (app) => app.request_new_window(-1, null)
                },
                // {  // Promiseを返す activate_action API を完全に除外
                //     name: 'activate_action',
                //     execute: (app) => app.activate_action('new-window', [], -1)
                // },
                {
                    name: 'command_line',
                    execute: (app) => {
                        const appId = app.get_id();
                        let command = null;

                        if (appId === 'org.gnome.Nautilus.desktop') {
                            command = 'nautilus --new-window';
                        } else if (appId === 'org.gnome.Terminal.desktop') {
                            command = 'gnome-terminal --window';
                        } else if (appId === 'org.gnome.Console.desktop') {
                            command = 'kgx';
                        }

                        if (command) {
                            GLib.spawn_command_line_async(command);
                        } else {
                            throw new Error("No suitable command found");
                        }
                    }
                },
                {
                    name: 'fallback_launch',
                    execute: (app) => app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT)
                }
            ];

            const tryNextMethod = (methodIndex) => {
                if (methodIndex >= launchMethods.length) {
                    console.error("💥 All launch methods failed");
                    Main.notify('Error launching application', `Could not launch ${app.get_name()}`);
                    return;
                }

                const method = launchMethods[methodIndex];
                console.log(`--- Attempting: ${method.name} ---`);

                try {
                    method.execute(app);
                    console.log(`✅ ${method.name} succeeded`);
                } catch (e) {
                    console.warn(`❌ ${method.name} failed: ${e.message}`);
                    // 次のメソッドを非同期で試行
                    setTimeout(() => tryNextMethod(methodIndex + 1), 10);
                }
            };

            tryNextMethod(0);
        }

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
                    button.connect('clicked', () => {
                        this._selectedFavoriteIndexTimeline.define(Now, index);
                        this._handleFavLaunch();
                    });
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
            // _sortWindowGroups メソッドの中身をこれだけにします
            return _sortUsingCommonRules(windowGroups, favoriteAppIds, group => group.app.get_id());
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

                    // ↓↓↓ ここで新しいヘルパーメソッドが使用されます ↓↓↓
                    if (this._isAppLaunchable(group.app)) {
                        const isFavorite = favoriteAppIds.includes(group.app.get_id());
                        const starIcon = isFavorite ? 'starred-symbolic' : 'non-starred-symbolic';
                        const starButton = new St.Button({ style_class: 'favorite-star-button', child: new St.Icon({ icon_name: starIcon, style_class: 'popup-menu-icon' }) });
                        starButton.connect('clicked', () => { this._extension._toggleFavorite(group.app.get_id()); });
                        actionsContainer.add_child(starButton);
                    }
                    // ↑↑↑ 修正はここまでです ↑↑↑

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
        _handleWindowActivate(actor, item, itemType) {
            this._flashIcon('green');
            this._activateSelection(actor, item, itemType);
            if (this._closeOnListActivateTimeline.at(Now)) {
                this.menu.close();
            }
        }
        // 【置換後の _handleWindowClose メソッド】
        _handleWindowClose(actor, item, itemType) {
            this._flashIcon('red');
            this._closeSelection(actor, item, itemType);
            if (this._closeOnListCloseTimeline.at(Now)) {
                this.menu.close();
            }
            else {
                this._resetMenuState();
            }
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
        destroy() { if (this._isDestroyed) return; this._isDestroyed = true; super.destroy(); }
    }
);
// ★ DateTime Clock Position Manager Class
const DateTimeClockManager = GObject.registerClass(
    class DateTimeClockManager extends GObject.Object {
        _init() {
            super._init();
            this._originalDateMenu = Main.panel.statusArea.dateMenu;
            this._originalPosition = null;
            this._originalRank = null;

            if (this._originalDateMenu) {
                this._originalPosition = this._findOriginalPosition();
                this._originalRank = this._findOriginalRank();
            }
        }

        manage(positionTimeline, rankTimeline) {
            // Stop any previous management


            const combinedTimeline = combineLatestWith(
                (pos, rank) => ({ pos, rank })
            )(positionTimeline)(rankTimeline);

            combinedTimeline.bind(({ pos, rank }) => {
                this._moveClockToPosition(pos, rank);
                return Timeline(null);
            });
        }

        _findOriginalPosition() {
            if (!this._originalDateMenu) return 'center';
            if (Main.panel._leftBox.contains(this._originalDateMenu)) return 'left';
            if (Main.panel._centerBox.contains(this._originalDateMenu)) return 'center';
            if (Main.panel._rightBox.contains(this._originalDateMenu)) return 'right';
            return 'center';
        }

        _findOriginalRank() {
            const parent = this._originalDateMenu?.get_parent();
            return parent ? parent.get_children().indexOf(this._originalDateMenu) : 0;
        }

        _moveClockToPosition(position, rank) {
            if (!this._originalDateMenu) return;

            const currentParent = this._originalDateMenu.get_parent();
            if (currentParent) {
                currentParent.remove_child(this._originalDateMenu);
            }

            let targetContainer;
            switch (position) {
                case 'left': targetContainer = Main.panel._leftBox; break;
                case 'right': targetContainer = Main.panel._rightBox; break;
                default: targetContainer = Main.panel._centerBox; break;
            }

            const children = targetContainer.get_children();
            const targetIndex = Math.max(0, Math.min(rank, children.length));
            targetContainer.insert_child_at_index(this._originalDateMenu, targetIndex);
        }

        destroy() {

            // Restore the clock to its original place
            //Will crush Gnome, so do notihng
        }
    }
);

// ★ メインクラス (DateTime Clock管理機能を追加)
export default class MinimalTimelineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._lifecycleTimeline = null;
        this._appMenuButton = null;
        this._runningAppsIndicator = null;
        this._windowModel = null;
        this._favsSettings = null;
        this._gsettingsConnections = [];
        this._dateTimeClockManager = null;
    }

    _onOpenPopupShortcut() {
        this._appMenuButton?.menu.open();
    }

    _onFavoriteShortcut(index) {
        const favs = this._favsSettings.get_strv('favorite-apps');
        const appId = favs[index];
        if (appId) {
            const app = Shell.AppSystem.get_default().lookup_app(appId);
            if (app) {
                const windows = app.get_windows();
                if (windows.length > 0) {
                    Main.activateWindow(windows[0]);
                } else {
                    app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT);
                }
            }
        }
    }

    // 【置換後の enable メソッド】
    enable() {
        this._lifecycleTimeline = Timeline(true);
        this._favsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        const settings = this.getSettings();

        // ★ 修正: シンプルで確実なOverview非表示処理
        if (settings.get_boolean('hide-overview-at-startup')) {
            // 段階的に試行する
            const hideOverview = () => {
                try {
                    if (Main.overview.visible) {
                        Main.overview.hide();
                        console.log('Overview hidden at startup');
                        return true;
                    }
                } catch (e) {
                    console.warn('Failed to hide overview:', e.message);
                }
                return false;
            };

            // 即座に試行
            if (!hideOverview()) {
                // 失敗した場合、少し待ってから再試行
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    hideOverview();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        this._lifecycleTimeline.bind(isEnabled => {
            if (isEnabled) {
                // キーバインド登録
                Main.wm.addKeybinding(
                    'open-popup-shortcut', settings, Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL, this._onOpenPopupShortcut.bind(this)
                );
                for (let i = 0; i < 30; i++) {
                    Main.wm.addKeybinding(
                        `shortcut-${i}`, settings, Meta.KeyBindingFlags.NONE,
                        Shell.ActionMode.NORMAL, this._onFavoriteShortcut.bind(this, i)
                    );
                }

                // UI要素の生成と管理
                this._windowModel = new WindowModel();

                const mainIconPosTimeline = this._createStringSettingTimeline(settings, 'main-icon-position');
                const mainIconRankTimeline = this._createIntSettingTimeline(settings, 'main-icon-rank');
                const showIconListTimeline = this._createBooleanSettingTimeline(settings, 'show-window-icon-list');

                // DateTime Clock管理の追加
                const dateMenuPosTimeline = this._createStringSettingTimeline(settings, 'date-menu-position');
                const dateMenuRankTimeline = this._createIntSettingTimeline(settings, 'date-menu-rank');

                this._dateTimeClockManager = new DateTimeClockManager();
                this._dateTimeClockManager.manage(dateMenuPosTimeline, dateMenuRankTimeline);

                const posAndRankTimeline = combineLatestWith(
                    (pos, rank) => ({ pos, rank })
                )(mainIconPosTimeline)(mainIconRankTimeline);

                const mainIconConfigTimeline = combineLatestWith(
                    (posAndRank, show) => ({ ...posAndRank, show })
                )(posAndRankTimeline)(showIconListTimeline);

                mainIconConfigTimeline.bind(({ pos, rank, show }) => {
                    this._appMenuButton?.destroy();
                    this._runningAppsIndicator?.destroy();

                    const favoritesTimeline = this._createStrvSettingTimeline(this._favsSettings, 'favorite-apps');
                    const closeOnFavLaunchTimeline = this._createBooleanSettingTimeline(settings, 'close-on-fav-launch');
                    const closeOnListActivateTimeline = this._createBooleanSettingTimeline(settings, 'close-on-list-activate');
                    const closeOnListCloseTimeline = this._createBooleanSettingTimeline(settings, 'close-on-list-close');

                    this._appMenuButton = new AppMenuButton({
                        windowsTimeline: this._windowModel.windowsTimeline,
                        favoritesTimeline: favoritesTimeline,
                        closeOnFavLaunchTimeline: closeOnFavLaunchTimeline,
                        closeOnListActivateTimeline: closeOnListActivateTimeline,
                        closeOnListCloseTimeline: closeOnListCloseTimeline,
                        extension: this,
                        settings: settings,
                    });
                    Main.panel.addToStatusArea(`${this.uuid}-AppMenuButton`, this._appMenuButton, rank, pos);

                    this._runningAppsIndicator = new RunningAppsIndicator({
                        windowsTimeline: this._windowModel.windowsTimeline,
                        favoritesTimeline: favoritesTimeline,
                    });
                    this._runningAppsIndicator.visible = show;
                    Main.panel.addToStatusArea(`${this.uuid}-RunningAppsIndicator`, this._runningAppsIndicator, rank + 1, pos);

                    showIconListTimeline.map(isVisible => {
                        if (this._runningAppsIndicator) {
                            this._runningAppsIndicator.visible = isVisible;
                        }
                    });

                    return Timeline(null);
                });

            } else {
                // キーバインド解除
                Main.wm.removeKeybinding('open-popup-shortcut');
                for (let i = 0; i < 30; i++) {
                    Main.wm.removeKeybinding(`shortcut-${i}`);
                }

                // UI要素の破棄
                this._appMenuButton?.destroy();
                this._appMenuButton = null;
                this._runningAppsIndicator?.destroy();
                this._runningAppsIndicator = null;
                this._windowModel?.destroy();
                this._windowModel = null;
                this._dateTimeClockManager?.destroy();
                this._dateTimeClockManager = null;
            }
            return Timeline(null);
        });
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
        this._favsSettings = null;
    }

    _createGenericSettingTimeline(settings, key, getter) {
        const timeline = Timeline(getter(key));
        const connectionId = settings.connect(`changed::${key}`, () => {
            timeline.define(Now, getter(key));
        });
        this._gsettingsConnections.push({ source: settings, id: connectionId });
        return timeline;
    }

    _createStrvSettingTimeline(settings, key) {
        return this._createGenericSettingTimeline(settings, key, settings.get_strv.bind(settings));
    }

    _createBooleanSettingTimeline(settings, key) {
        return this._createGenericSettingTimeline(settings, key, settings.get_boolean.bind(settings));
    }

    _createStringSettingTimeline(settings, key) {
        return this._createGenericSettingTimeline(settings, key, settings.get_string.bind(settings));
    }

    _createIntSettingTimeline(settings, key) {
        return this._createGenericSettingTimeline(settings, key, settings.get_int.bind(settings));
    }

    _toggleFavorite(appId) {
        let favorites = this._favsSettings.get_strv('favorite-apps');
        const index = favorites.indexOf(appId);
        if (index === -1) favorites.push(appId);
        else favorites.splice(index, 1);
        this._favsSettings.set_strv('favorite-apps', favorites);
    }
}