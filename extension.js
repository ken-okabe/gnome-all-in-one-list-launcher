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

// --- RunningAppsIndicator & IconList Classes (変更なし) ---
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
                const icon = new St.Icon({ gicon: group.app.get_icon(), style_class: 'system-status-icon' });
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
            this._initMenuStateMonitoring();  // ← 追加
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

        /**
         * メニューの開閉状態を監視してアイコンの色を変更
         */
        _initMenuStateMonitoring() {
            // メニューの開閉状態変化を監視
            this.menu.connect('open-state-changed', (menu, isOpen) => {
                this._updateIconForMenuState(isOpen);
            });
            // 初期状態の設定
            this._updateIconForMenuState(false);
        }

        /**
         * メニューの状態に応じてアイコンの色を更新
         * @param {boolean} isOpen - メニューが開いているかどうか
         */
        _updateIconForMenuState(isOpen) {
            if (this._isDestroyed || !this._panelIcon || this._panelIcon.is_destroyed) {
                return;
            }
            if (isOpen) {
                // メニューが開いている時: 緑色
                this._panelIcon.set_style('color: #4ade80; background-color: rgba(74, 222, 128, 0.2); border-radius: 4px; padding: 2px;');
            } else {
                // メニューが閉じている時: デフォルト色に戻す
                this._panelIcon.set_style('');
            }
        }

        /**
         * デバッグ用: 判定結果を一瞬だけアイコン色で表示
         * @param {boolean} isOpen - 現在の開閉状態
         */
        _showDebugState(isOpen) {
            if (this._isDestroyed || !this._panelIcon || this._panelIcon.is_destroyed) {
                return;
            }
            // 判定結果を色で表示 (赤=開いている, 青=閉じている)
            const debugColor = isOpen ? '#ef4444' : '#3b82f6';
            this._panelIcon.set_style(`color: ${debugColor}; background-color: rgba(255, 255, 255, 0.3); border-radius: 4px; padding: 2px; border: 2px solid ${debugColor};`);
            // 300ms後に通常の状態表示に戻す
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                if (this._panelIcon && !this._panelIcon.is_destroyed) {
                    this._updateIconForMenuState(this.menu.isOpen);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * アプリケーションの新規インスタンス起動プロセスを開始します。
         * @param {Shell.App} app - 起動するアプリケーションオブジェクト。
         */
        // _launchNewInstance(app) {
        //     if (this._isDestroyed) {
        //         console.warn("Attempted to launch on a destroyed instance.");
        //         return;
        //     }

        //     console.log(`Starting sequential launch attempts for app: ${app.get_id()}`);

        //     const self = this;

        //     // 各試行の結果を受け取るTimeline
        //     const attempt1Result = Timeline(null);
        //     const attempt2Result = Timeline(null);
        //     const attempt3Result = Timeline(null);
        //     const attempt4Result = Timeline(null);
        //     const finalResult = Timeline(null);

        //     // 初期値でチェーンを開始
        //     const initialTrigger = Timeline({ app, attemptNumber: 1 });

        //     const launchChain = initialTrigger
        //         .bind(({ app, attemptNumber }) => {
        //             console.log(`--- Attempt ${attemptNumber}: request_new_window ---`);

        //             // 非同期的に結果を決定
        //             setTimeout(() => {
        //                 try {
        //                     app.request_new_window(-1, null);
        //                     console.log("✅ request_new_window succeeded");
        //                     // 成功時は最終結果に成功を通知
        //                     finalResult.define(Now, { success: true, method: 'request_new_window' });
        //                 } catch (e) {
        //                     console.warn(`❌ request_new_window failed: ${e.message}`);
        //                     // 失敗時は次の試行をトリガー
        //                     attempt1Result.define(Now, { app, attemptNumber: 2 });
        //                 }
        //             }, 10); // 短い遅延で非同期処理をシミュレート

        //             return attempt1Result;
        //         })
        //         .bind(({ app, attemptNumber }) => {
        //             if (attemptNumber !== 2) return attempt2Result; // 既に成功している場合はスキップ

        //             console.log(`--- Attempt ${attemptNumber}: activate_action ---`);

        //             setTimeout(() => {
        //                 try {
        //                     app.activate_action('new-window', [], -1);
        //                     console.log("✅ activate_action succeeded");
        //                     finalResult.define(Now, { success: true, method: 'activate_action' });
        //                 } catch (e) {
        //                     console.warn(`❌ activate_action failed: ${e.message}`);
        //                     attempt2Result.define(Now, { app, attemptNumber: 3 });
        //                 }
        //             }, 10);

        //             return attempt2Result;
        //         })
        //         .bind(({ app, attemptNumber }) => {
        //             if (attemptNumber !== 3) return attempt3Result; // 既に成功している場合はスキップ

        //             console.log(`--- Attempt ${attemptNumber}: command_line ---`);

        //             setTimeout(() => {
        //                 try {
        //                     const appId = app.get_id();
        //                     let command = null;

        //                     // アプリケーション固有のコマンドを設定
        //                     if (appId === 'org.gnome.Nautilus.desktop') {
        //                         command = 'nautilus --new-window';
        //                     } else if (appId === 'org.gnome.Terminal.desktop') {
        //                         command = 'gnome-terminal --window';
        //                     } else if (appId === 'org.gnome.Console.desktop') {
        //                         command = 'kgx';
        //                     } else {
        //                         // 汎用的なコマンド生成
        //                         const executableName = app.get_app_info().get_executable();
        //                         command = executableName ? `${executableName} --new-window` : null;
        //                     }

        //                     if (command) {
        //                         console.log(`  Executing command: ${command}`);
        //                         GLib.spawn_command_line_async(command);
        //                         console.log("✅ command_line succeeded");
        //                         finalResult.define(Now, { success: true, method: 'command_line' });
        //                     } else {
        //                         throw new Error("No suitable command found");
        //                     }
        //                 } catch (e) {
        //                     console.warn(`❌ command_line failed: ${e.message}`);
        //                     attempt3Result.define(Now, { app, attemptNumber: 4 });
        //                 }
        //             }, 10);

        //             return attempt3Result;
        //         })
        //         .bind(({ app, attemptNumber }) => {
        //             if (attemptNumber !== 4) return attempt4Result; // 既に成功している場合はスキップ

        //             console.log(`--- Attempt ${attemptNumber}: fallback launch ---`);

        //             setTimeout(() => {
        //                 try {
        //                     app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT);
        //                     console.log("✅ fallback launch succeeded");
        //                     finalResult.define(Now, { success: true, method: 'launch' });
        //                 } catch (e) {
        //                     console.error(`💥 All launch attempts failed. Final error: ${e.message}`);
        //                     finalResult.define(Now, {
        //                         success: false,
        //                         error: e.message,
        //                         appName: app.get_name()
        //                     });
        //                 }
        //             }, 10);

        //             return attempt4Result;
        //         });

        //     // 最終結果の処理
        //     finalResult.map(result => {
        //         if (result.success) {
        //             console.log(`🎉 Application launched successfully using method: ${result.method}`);
        //             // 成功時の追加処理があればここに記述
        //         } else {
        //             console.error(`💥 Failed to launch ${result.appName}: ${result.error}`);
        //             Main.notify('Error launching application', `Could not launch ${result.appName}`);
        //         }
        //         return result;
        //     });

        //     // チェーンを開始
        //     initialTrigger.define(Now, { app, attemptNumber: 1 });
        // }

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
        const isCurrentlyOpen = this._appMenuButton?.menu.isOpen;
        // デバッグ用: 判定結果をアイコン色で一瞬表示
        this._appMenuButton?._showDebugState(isCurrentlyOpen);
        if (isCurrentlyOpen) {
            // Wayland環境でのキーボードイベントシミュレーション
            try {
                this._appMenuButton?.menu.toggle();
            } catch (e) {
                logError(e);
            }
        } else {
            this._appMenuButton?.menu.toggle();
        }
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

    enable() {
        this._lifecycleTimeline = Timeline(true);
        this._favsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        const settings = this.getSettings();

        if (settings.get_boolean('hide-overview-at-startup')) {
            Main.overview.hide();
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

                    this._appMenuButton = new AppMenuButton({
                        windowsTimeline: this._windowModel.windowsTimeline,
                        favoritesTimeline: favoritesTimeline,
                        extension: this,
                        settings: settings,
                    });
                    Main.panel.addToStatusArea(`${this.uuid}-AppMenuButton`, this._appMenuButton, rank, pos);

                    this._runningAppsIndicator = new RunningAppsIndicator({
                        windowsTimeline: this._windowModel.windowsTimeline,
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