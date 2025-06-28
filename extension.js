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

// --- Robust Tooltip System for GNOME Shell Extensions ---

// Singleton tooltip manager to prevent multiple tooltips
class TooltipManager {
    constructor() {
        this._currentTooltip = null;
        this._pendingTimeouts = new Set();
    }

    static getInstance() {
        if (!this._instance) {
            this._instance = new TooltipManager();
        }
        return this._instance;
    }

    showTooltip(text, sourceActor, options = {}) {
        // Hide any existing tooltip first
        this.hideCurrentTooltip();

        try {
            this._currentTooltip = new ImprovedTooltip();
            this._currentTooltip.show(text, sourceActor, options);
        } catch (error) {
            log(`Tooltip error: ${error.message}`);
            this._currentTooltip = null;
        }
    }

    hideCurrentTooltip() {
        if (this._currentTooltip) {
            this._currentTooltip.hide();
            this._currentTooltip = null;
        }
    }

    addTimeout(timeoutId) {
        this._pendingTimeouts.add(timeoutId);
    }

    removeTimeout(timeoutId) {
        if (timeoutId && this._pendingTimeouts.has(timeoutId)) {
            GLib.source_remove(timeoutId);
            this._pendingTimeouts.delete(timeoutId);
        }
    }

    cleanup() {
        this.hideCurrentTooltip();
        // Clear all pending timeouts
        for (const timeoutId of this._pendingTimeouts) {
            GLib.source_remove(timeoutId);
        }
        this._pendingTimeouts.clear();
    }

    static destroy() {
        if (this._instance) {
            this._instance.cleanup();
            this._instance = null;
        }
    }
}

// Improved tooltip widget
const ImprovedTooltip = GObject.registerClass(
    class ImprovedTooltip extends St.Label {
        _init() {
            super._init({
                style_class: 'tooltip-label',
                reactive: false,
                can_focus: false,
                track_hover: false,
                visible: false,
                opacity: 0
            });

            // Apply CSS styling
            this._applyStyle();

            this._isShowing = false;
            this._isHiding = false;
            this._animationTimeout = null;

            // Add to UI group with proper error handling
            try {
                Main.uiGroup.add_child(this);
            } catch (error) {
                log(`Failed to add tooltip to UI group: ${error.message}`);
                this.destroy();
                throw error;
            }
        }

        _applyStyle() {
            const style = [
                'background-color: rgba(40, 40, 40, 0.95);',
                'color: #ffffff;',
                'border: 1px solid rgba(255, 255, 255, 0.1);',
                'border-radius: 6px;',
                'padding: 8px 12px;',
                'font-size: 13px;',
                'font-weight: 400;',
                'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);',
                'max-width: 300px;'
            ].join(' ');

            this.set_style(style);
        }

        show(text, sourceActor, options = {}) {
            if (this._isShowing || this._isHiding) {
                return;
            }

            this._isShowing = true;

            const {
                delay = 300,
                position = 'auto',
                offset = 8
            } = options;

            // Validate inputs
            if (!text || typeof text !== 'string') {
                this._isShowing = false;
                return;
            }

            if (!sourceActor || !sourceActor.get_stage) {
                this._isShowing = false;
                return;
            }

            this.set_text(text);
            this._positionTooltip(sourceActor, position, offset);

            // Show with animation
            this.visible = true;
            this.ease({
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    this._isShowing = false;
                }
            });
        }

        _positionTooltip(sourceActor, position, offset) {
            // Force layout to get accurate dimensions
            this.get_theme_node().get_content_box(this.get_allocation_box());

            const [stageX, stageY] = sourceActor.get_transformed_position();
            const [actorWidth, actorHeight] = sourceActor.get_size();
            const [tooltipWidth, tooltipHeight] = this.get_size();

            const stageWidth = global.stage.width;
            const stageHeight = global.stage.height;

            let x, y;

            // Determine optimal position
            const actualPosition = this._determinePosition(
                position, stageX, stageY, actorWidth, actorHeight,
                tooltipWidth, tooltipHeight, stageWidth, stageHeight
            );

            switch (actualPosition) {
                case 'top':
                    x = stageX + (actorWidth - tooltipWidth) / 2;
                    y = stageY - tooltipHeight - offset;
                    break;
                case 'bottom':
                    x = stageX + (actorWidth - tooltipWidth) / 2;
                    y = stageY + actorHeight + offset;
                    break;
                case 'left':
                    x = stageX - tooltipWidth - offset;
                    y = stageY + (actorHeight - tooltipHeight) / 2;
                    break;
                case 'right':
                    x = stageX + actorWidth + offset;
                    y = stageY + (actorHeight - tooltipHeight) / 2;
                    break;
                default: // fallback to bottom
                    x = stageX + (actorWidth - tooltipWidth) / 2;
                    y = stageY + actorHeight + offset;
            }

            // Constrain to screen bounds
            x = Math.max(4, Math.min(x, stageWidth - tooltipWidth - 4));
            y = Math.max(4, Math.min(y, stageHeight - tooltipHeight - 4));

            this.set_position(Math.round(x), Math.round(y));
        }

        _determinePosition(preferredPosition, stageX, stageY, actorWidth, actorHeight,
            tooltipWidth, tooltipHeight, stageWidth, stageHeight) {

            if (preferredPosition !== 'auto') {
                return preferredPosition;
            }

            // Check if actor is in top panel
            const isInTopPanel = stageY < 50; // Approximate panel height

            // For top panel, prefer bottom position
            if (isInTopPanel) {
                return 'bottom';
            }

            // For other cases, check available space
            const spaceTop = stageY;
            const spaceBottom = stageHeight - (stageY + actorHeight);
            const spaceLeft = stageX;
            const spaceRight = stageWidth - (stageX + actorWidth);

            // Prefer top if there's enough space, otherwise bottom
            if (spaceTop >= tooltipHeight + 8) {
                return 'top';
            } else if (spaceBottom >= tooltipHeight + 8) {
                return 'bottom';
            } else if (spaceRight >= tooltipWidth + 8) {
                return 'right';
            } else if (spaceLeft >= tooltipWidth + 8) {
                return 'left';
            }

            return 'bottom'; // Fallback
        }

        hide() {
            if (this._isHiding || !this.visible) {
                return;
            }

            this._isHiding = true;
            this._isShowing = false;

            // Clear any pending animation
            this.remove_all_transitions();

            this.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    this.visible = false;
                    this._isHiding = false;
                    // Auto-destroy after hiding
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this.destroy();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        }

        destroy() {
            // Clear any pending timeouts
            if (this._animationTimeout) {
                GLib.source_remove(this._animationTimeout);
                this._animationTimeout = null;
            }

            // Stop all animations
            this.remove_all_transitions();

            // Remove from parent
            const parent = this.get_parent();
            if (parent) {
                parent.remove_child(this);
            }

            super.destroy();
        }
    }
);

// Enhanced tooltip helper function
function addTooltip(actor, text, options = {}) {
    // Validate inputs
    if (!actor || !text) {
        log('addTooltip: Invalid actor or text provided');
        return null;
    }

    const {
        delay = 500,
        position = 'auto',
        offset = 8
    } = options;

    let showTimeout = null;
    let isHovering = false;
    const tooltipManager = TooltipManager.getInstance();

    // Clean up any existing tooltip handlers
    if (actor._tooltipCleanup) {
        actor._tooltipCleanup();
    }

    const enterHandler = actor.connect('enter-event', () => {
        if (isHovering) return;
        isHovering = true;

        // Clear any existing timeout
        if (showTimeout) {
            tooltipManager.removeTimeout(showTimeout);
            showTimeout = null;
        }

        showTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            if (isHovering && actor.get_stage()) {
                try {
                    tooltipManager.showTooltip(text, actor, { position, offset });
                } catch (error) {
                    log(`Tooltip show error: ${error.message}`);
                }
            }
            showTimeout = null;
            return GLib.SOURCE_REMOVE;
        });

        tooltipManager.addTimeout(showTimeout);
    });

    const leaveHandler = actor.connect('leave-event', () => {
        if (!isHovering) return;
        isHovering = false;

        // Clear show timeout
        if (showTimeout) {
            tooltipManager.removeTimeout(showTimeout);
            showTimeout = null;
        }

        // Hide current tooltip
        tooltipManager.hideCurrentTooltip();
    });

    // Cleanup function
    actor._tooltipCleanup = () => {
        isHovering = false;

        // Clear timeout
        if (showTimeout) {
            tooltipManager.removeTimeout(showTimeout);
            showTimeout = null;
        }

        // Disconnect handlers safely
        try {
            if (enterHandler) actor.disconnect(enterHandler);
            if (leaveHandler) actor.disconnect(leaveHandler);
        } catch (error) {
            // Actor might be destroyed already
        }

        // Hide tooltip
        tooltipManager.hideCurrentTooltip();

        // Remove cleanup reference
        delete actor._tooltipCleanup;
    };

    // Return cleanup function for manual cleanup if needed
    return actor._tooltipCleanup;
}

// Utility function to clean up all tooltips (call this when extension is disabled)
function cleanupAllTooltips() {
    TooltipManager.destroy();
}

// Export functions for use in extensions
var tooltip = {
    addTooltip,
    cleanupAllTooltips,
    TooltipManager
};

// Usage example:
/*
// Add tooltip to an actor
const cleanup = addTooltip(myActor, "This is a tooltip", {
    delay: 300,
    position: 'top',
    offset: 10
});

// Manual cleanup if needed
if (cleanup) cleanup();

// Clean up all tooltips when extension is disabled
cleanupAllTooltips();
*/



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

// --- NonClosingPopupBaseMenuItem Class ---
const NonClosingPopupBaseMenuItem = GObject.registerClass({
    Signals: {
        'custom-activate': {},
        'custom-close': {},
    },
}, class NonClosingPopupBaseMenuItem extends PopupMenu.PopupBaseMenuItem {
    // _init で extension インスタンスを受け取るように修正（前回の回答通り）
    _init(params) {
        super._init(params); // 親クラスにそのままパラメータを渡す

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
// --- WindowModel Class ---
// --- WindowModel Class ---
const WindowModel = GObject.registerClass(
    class WindowModel extends GObject.Object {
        _init({ windowTimestamps }) {
            super._init();
            this.windowsTimeline = Timeline([]);
            this._windowTracker = Shell.WindowTracker.get_default();
            this._signalIds = new Map();
            this._windowTimestamps = windowTimestamps;
            this._restackedId = global.display.connect('restacked', () => this.update());
            this.update();
        }

        update() {
            this._disconnectWindowSignals();
            const windowGroups = new Map();
            const currentWindowIds = new Set();

            for (const w of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
                if (w.is_skip_taskbar()) continue;

                const windowId = w.get_stable_sequence();
                currentWindowIds.add(windowId);

                const a = this._windowTracker.get_window_app(w);
                if (!a) continue;

                const posId = w.connect('position-changed', () => this.update());

                // ★★★ ここが修正箇所 ★★★
                // 未定義の titleId への参照を完全に削除
                this._signalIds.set(w, [posId]);

                if (!this._windowTimestamps.has(windowId)) {
                    this._windowTimestamps.set(windowId, Date.now());
                }
                const timestamp = this._windowTimestamps.get(windowId);

                const i = a.get_id();
                if (!windowGroups.has(i)) {
                    windowGroups.set(i, { app: a, windows: [] });
                }
                windowGroups.get(i).windows.push([w, timestamp]);
            }

            for (const oldId of this._windowTimestamps.keys()) {
                if (!currentWindowIds.has(oldId)) {
                    this._windowTimestamps.delete(oldId);
                }
            }

            this.windowsTimeline.define(Now, Array.from(windowGroups.values()));
        }

        _disconnectWindowSignals() {
            for (const [w, i] of this._signalIds) {
                for (const id of i) {
                    try { if (w && !w.is_destroyed()) w.disconnect(id); } catch (e) { }
                }
            }
            this._signalIds.clear();
        }

        destroy() {
            if (this._restackedId) {
                global.display.disconnect(this._restackedId);
                this._restackedId = null;
            }
            this._disconnectWindowSignals();
        }
    });
// --- RunningAppsIconList Class ---
const RunningAppsIconList = GObject.registerClass(
    class RunningAppsIconList extends St.BoxLayout {
        _init() {
            super._init({ style_class: 'window-icon-list-container' });
            this._windowTracker = Shell.WindowTracker.get_default();
        }

        update(windowGroups, favoriteAppIds) {
            this.destroy_all_children();
            if (!windowGroups) return;

            const getAppIdForGroup = group => group.app.get_id();
            _sortUsingCommonRules(windowGroups, favoriteAppIds, getAppIdForGroup);

            for (const group of windowGroups) {
                // ★★★ ここからが修正箇所 ★★★
                const sortedWindows = group.windows.sort(([winA, tsA], [winB, tsB]) => {
                    const xDiff = winA.get_frame_rect().x - winB.get_frame_rect().x;
                    // X座標が異なる場合は、その差でソート
                    if (xDiff !== 0) {
                        return xDiff;
                    }
                    // X座標が同じ場合は、タイムスタンプでソート（昇順）
                    return tsA - tsB;
                });
                // ★★★ 修正ここまで ★★★

                for (const [win, timestamp] of sortedWindows) {
                    const app = this._windowTracker.get_window_app(win);
                    if (!app) continue;

                    const icon = new St.Icon({ gicon: app.get_icon(), style_class: 'panel-window-icon' });
                    const button = new St.Button({ child: icon, style_class: 'panel-button' });
                    button.connect('clicked', () => Main.activateWindow(win));

                    addTooltip(button, app.get_name()); // この行を追加

                    this.add_child(button);
                }
            }
        }
    }
);


// --- RunningAppsIndicator クラス ---
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

// --- AppMenuButton Class ---
const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init({ windowsTimeline, favoritesTimeline, toBeFocusedNewTimeline, toBeFocusedRemoveTimeline, redrawTimeline, closeOnFavLaunchTimeline, closeOnListActivateTimeline, closeOnListCloseTimeline, extension, settings }) {
            super._init(0.0, 'Timeline Event Network');
            this._isDestroyed = false;

            // プロパティの初期化
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

            this._windowsTimeline = windowsTimeline;
            this._favoritesTimeline = favoritesTimeline;
            this.toBeFocusedNewTimeline = toBeFocusedNewTimeline;
            this.toBeFocusedRemoveTimeline = toBeFocusedRemoveTimeline;
            this.redrawTimeline = redrawTimeline;
            this._closeOnFavLaunchTimeline = closeOnFavLaunchTimeline;
            this._closeOnListActivateTimeline = closeOnListActivateTimeline;
            this._closeOnListCloseTimeline = closeOnListCloseTimeline;

            this._windowItemsMap = new Map();
            this._windowTitleConnections = new Map();

            // ★★★ ここからが修正箇所 ★★★
            // windowsTimeline と favoritesTimeline を combineLatestWith で合成する
            const combinedTimeline = combineLatestWith(
                (win, fav) => ({ windowGroups: win, favoriteAppIds: fav })
            )(this._windowsTimeline)(this._favoritesTimeline);

            // 合成されたタイムラインに bind する
            this._lifecycleManager = combinedTimeline.bind(({ windowGroups, favoriteAppIds }) => {
                // --- 1. 古いタイトル監視をすべて破棄 ---
                for (const [win, id] of this._windowTitleConnections) {
                    try {
                        if (win && !win.is_destroyed) win.disconnect(id);
                    } catch (e) { /* ignore */ }
                }
                this._windowTitleConnections.clear();

                // --- 2. 新しいタイトル監視をセットアップ ---
                const allWindows = windowGroups.flatMap(g => g.windows.map(([win, ts]) => win));

                for (const metaWindow of allWindows) {
                    const connectionId = metaWindow.connect('notify::title', () => {
                        this._updateSingleWindowTitle(metaWindow);
                    });
                    this._windowTitleConnections.set(metaWindow, connectionId);
                }

                // --- 3. UI全体の再描画をトリガー ---
                // bindから渡された最新の favorites を使って再描画
                this._updateWindowsUnit(windowGroups, favoriteAppIds);

                return Timeline(true);
            });
            // ★★★ 修正ここまで ★★★

            const initialFavorites = favoritesTimeline.at(Now);
            this._selectedFavoriteIndexTimeline = Timeline(initialFavorites.length > 0 ? 0 : null);

            this._initializeMenuStructure();

            // favoritesTimelineの更新は、お気に入りバーの更新にも必要
            this._favoritesTimeline.map(favoriteAppIds => {
                if (this._isDestroyed) return;
                this._updateFavoritesUnit(favoriteAppIds, this._selectedFavoriteIndexTimeline.at(Now));
            });

            this._selectedFavoriteIndexTimeline.map(selectedIndex => {
                if (this._isDestroyed) return;
                this._updateFavoriteSelection(selectedIndex);
            });
        }

        _updateSingleWindowTitle(metaWindow) {
            try {
                const windowId = metaWindow.get_stable_sequence();
                const refs = this._windowItemsMap.get(windowId);

                if (refs && refs.label && !refs.label.is_destroyed) {
                    const newTitle = metaWindow.get_title() || '...';
                    refs.label.set_text(newTitle);
                }
            } catch (e) {
                // ignore
            }
        }

        // --- その他のメソッドは変更なし ... ---

        open() {
            super.open();
            this.menu.actor.grab_key_focus();
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
                    if (app) {
                        console.log(`[FocusDebug] _handleFavLaunch: Setting focus intent for app: ${app.get_id()}`);
                        this.toBeFocusedNewTimeline.define(Now, app);
                        this.toBeFocusedRemoveTimeline.define(Now, null);
                        this._launchNewInstance(app);
                        if (this._closeOnFavLaunchTimeline.at(Now)) {
                            this.menu.close();
                        }
                    }
                }
            }
        }

        _onMenuKeyPress(actor, event) {
            this._extension.recoverFocusTimeline.define(Now, true);
            console.log(`[FocusDebug] recoverFocusTimeline triggered by key press BECAUSE possible focus recovery`);
            const symbol = event.get_key_symbol();
            if (this._isMenuCloseShortcut(symbol, event)) {
                this._flashIcon('purple');
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

        _isMenuCloseShortcut(symbol, event) {
            const settings = this._extension.getSettings();
            const shortcutKeys = settings.get_strv('open-popup-shortcut');
            if (!shortcutKeys || shortcutKeys.length === 0) return false;
            const shortcutString = shortcutKeys[0];
            const parsedShortcut = this._parseShortcutString(shortcutString);
            if (!parsedShortcut) return false;
            const modifierState = event.get_state();
            let modifiersMatch = true;
            for (const modifier of parsedShortcut.modifiers) {
                if (!(modifierState & modifier)) {
                    modifiersMatch = false;
                    break;
                }
            }
            if (!modifiersMatch) return false;
            return symbol === parsedShortcut.key;
        }

        _parseShortcutString(shortcutString) {
            if (!shortcutString || shortcutString.trim() === '') return null;
            const modifiers = [];
            let keyName = shortcutString;
            if (shortcutString.includes('<Super>')) { modifiers.push(Clutter.ModifierType.SUPER_MASK); keyName = keyName.replace('<Super>', ''); }
            if (shortcutString.includes('<Control>')) { modifiers.push(Clutter.ModifierType.CONTROL_MASK); keyName = keyName.replace('<Control>', ''); }
            if (shortcutString.includes('<Alt>')) { modifiers.push(Clutter.ModifierType.MOD1_MASK); keyName = keyName.replace('<Alt>', ''); }
            if (shortcutString.includes('<Shift>')) { modifiers.push(Clutter.ModifierType.SHIFT_MASK); keyName = keyName.replace('<Shift>', ''); }
            let keySymbol;
            switch (keyName.toLowerCase()) {
                case 'space': keySymbol = Clutter.KEY_space; break;
                case 'tab': keySymbol = Clutter.KEY_Tab; break;
                case 'return': case 'enter': keySymbol = Clutter.KEY_Return; break;
                case 'escape': keySymbol = Clutter.KEY_Escape; break;
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
                case 'f13': keySymbol = Clutter.KEY_F13; break;
                case 'f14': keySymbol = Clutter.KEY_F14; break;
                case 'f15': keySymbol = Clutter.KEY_F15; break;
                case 'f16': keySymbol = Clutter.KEY_F16; break;
                case 'f17': keySymbol = Clutter.KEY_F17; break;
                case 'f18': keySymbol = Clutter.KEY_F18; break;
                case 'f19': keySymbol = Clutter.KEY_F19; break;
                case 'f20': keySymbol = Clutter.KEY_F20; break;
                case 'f21': keySymbol = Clutter.KEY_F21; break;
                case 'f22': keySymbol = Clutter.KEY_F22; break;
                case 'f23': keySymbol = Clutter.KEY_F23; break;
                case 'f24': keySymbol = Clutter.KEY_F24; break;
                default:
                    if (keyName.length === 1) {
                        const char = keyName.toLowerCase();
                        if (char >= 'a' && char <= 'z') { keySymbol = Clutter.KEY_a + (char.charCodeAt(0) - 'a'.charCodeAt(0)); }
                        else if (char >= '0' && char <= '9') { keySymbol = Clutter.KEY_0 + (char.charCodeAt(0) - '0'.charCodeAt(0)); }
                    }
                    break;
            }
            if (keySymbol === undefined) { console.warn(`Unknown key name: ${keyName}`); return null; }
            return { modifiers: modifiers, key: keySymbol };
        }

        _isAppLaunchable(app) {
            if (!app) return false;
            const appInfo = app.get_app_info();
            return appInfo ? appInfo.should_show() : false;
        }

        _launchNewInstance(app) {
            if (this._isDestroyed) { console.warn("Attempted to launch on a destroyed instance."); return; }
            const launchMethods = [
                { name: 'request_new_window', execute: (app) => app.request_new_window(-1, null) },
                {
                    name: 'command_line', execute: (app) => {
                        const appId = app.get_id();
                        let command = null;
                        if (appId === 'org.gnome.Nautilus.desktop') command = 'nautilus --new-window';
                        else if (appId === 'org.gnome.Terminal.desktop') command = 'gnome-terminal --window';
                        else if (appId === 'org.gnome.Console.desktop') command = 'kgx';
                        if (command) { GLib.spawn_command_line_async(command); } else { throw new Error("No suitable command found"); }
                    }
                },
                { name: 'fallback_launch', execute: (app) => app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT) }
            ];
            const tryNextMethod = (methodIndex) => {
                if (methodIndex >= launchMethods.length) { console.error("💥 All launch methods failed"); Main.notify('Error launching application', `Could not launch ${app.get_name()}`); return; }
                const method = launchMethods[methodIndex];
                try { method.execute(app); } catch (e) { setTimeout(() => tryNextMethod(methodIndex + 1), 10); }
            };
            tryNextMethod(0);
        }

        _updateFavoriteSelection(newIndex) {
            const oldIndex = this._lastSelectedIndex;
            if (oldIndex !== null && this._favoriteButtons[oldIndex]) this._favoriteButtons[oldIndex].remove_style_class_name('selected');
            if (newIndex !== null && this._favoriteButtons[newIndex]) this._favoriteButtons[newIndex].add_style_class_name('selected');
            this._lastSelectedIndex = newIndex;
        }

        _updateFavoritesUnit(favoriteAppIds, selectedIndex) {
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
                    button.connect('clicked', () => { this._selectedFavoriteIndexTimeline.define(Now, index); this._handleFavLaunch(); });
                    button.connect('enter-event', () => { this._selectedFavoriteIndexTimeline.define(Now, index); });

                    addTooltip(button, app.get_name()); // この行を追加

                    this._favoriteButtons[index] = button;
                    favoritesBox.add_child(button);
                }
                if (this.menu.numMenuItems > 0) this.menu.box.insert_child_at_index(this._favoritesContainer.actor, 0);
                else this.menu.addMenuItem(this._favoritesContainer);
                this._updateFavoriteSelection(selectedIndex);
            }
        }

        _sortWindowGroups(windowGroups, favoriteAppIds) {
            return _sortUsingCommonRules(windowGroups, favoriteAppIds, group => group.app.get_id());
        }

        _updateWindowsUnit(windowGroups, favoriteAppIds) {
            this._windowItemsMap.clear();
            this._windowsContainer.forEach(child => child.destroy());
            this._windowsContainer = [];
            this._separatorItem?.destroy();
            this._separatorItem = null;

            if (this._favoritesContainer && windowGroups && windowGroups.length > 0) {
                this._separatorItem = new PopupMenu.PopupSeparatorMenuItem();
                if (this.menu.box.contains(this._favoritesContainer.actor)) {
                    this.menu.addMenuItem(this._separatorItem, this.menu.box.get_children().indexOf(this._favoritesContainer.actor) + 1);
                } else {
                    this.menu.addMenuItem(this._separatorItem);
                }
            }
            if (windowGroups && windowGroups.length > 0) {
                const sortedGroups = this._sortWindowGroups([...windowGroups], favoriteAppIds);
                for (const group of sortedGroups) {
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
                    if (this._isAppLaunchable(group.app)) {
                        const isFavorite = favoriteAppIds.includes(group.app.get_id());
                        const starIcon = isFavorite ? 'starred-symbolic' : 'non-starred-symbolic';
                        const starButton = new St.Button({ style_class: 'favorite-star-button', child: new St.Icon({ icon_name: starIcon, style_class: 'popup-menu-icon' }) });
                        starButton.connect('clicked', () => { this._extension._toggleFavorite(group.app.get_id()); });
                        actionsContainer.add_child(starButton);
                    }
                    const groupCloseButton = new St.Button({ style_class: 'window-close-button', child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                    groupCloseButton.connect('clicked', () => headerItem.emit('custom-close'));
                    actionsContainer.add_child(groupCloseButton);
                    hbox.add_child(actionsContainer);
                    headerItem.connect('custom-activate', () => this._handleWindowActivate(headerItem, group, 'group'));
                    headerItem.connect('custom-close', () => this._handleWindowClose(headerItem, group, 'group'));
                    this.menu.addMenuItem(headerItem);
                    this._windowsContainer.push(headerItem);

                    const sortedWindows = group.windows.sort(([winA, tsA], [winB, tsB]) => {
                        const yDiff = winA.get_frame_rect().y - winB.get_frame_rect().y;
                        if (yDiff !== 0) return yDiff;
                        return tsA - tsB;
                    });

                    for (const [metaWindow, timestamp] of sortedWindows) {
                        const windowItem = new NonClosingPopupBaseMenuItem({
                            reactive: true,
                            can_focus: true,
                            style_class: 'window-list-item window-item'
                        });
                        windowItem._itemData = [metaWindow, timestamp];
                        windowItem._itemType = 'window';
                        const windowHbox = new St.BoxLayout({ x_expand: true, style_class: 'window-item-container' });
                        windowItem.add_child(windowHbox);

                        const titleLabel = new St.Label({ text: metaWindow.get_title() || '...', y_align: Clutter.ActorAlign.CENTER, style_class: 'window-item-title' });
                        windowHbox.add_child(titleLabel);

                        windowHbox.add_child(new St.Widget({ x_expand: true }));
                        const windowCloseButton = new St.Button({ style_class: 'window-close-button', child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                        windowCloseButton.connect('clicked', () => windowItem.emit('custom-close'));
                        windowHbox.add_child(windowCloseButton);
                        windowItem.connect('custom-activate', () => this._handleWindowActivate(windowItem, metaWindow, 'window'));
                        windowItem.connect('custom-close', () => this._handleWindowClose(windowItem, metaWindow, 'window'));
                        this.menu.addMenuItem(windowItem);
                        this._windowsContainer.push(windowItem);

                        const windowId = metaWindow.get_stable_sequence();
                        this._windowItemsMap.set(windowId, { item: windowItem, label: titleLabel });
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

        _handleWindowActivate(actor, item, itemType) {
            this._flashIcon('green');
            this._activateSelection(actor, item, itemType);
            if (this._closeOnListActivateTimeline.at(Now)) {
                this.menu.close();
            }
        }

        _handleWindowClose(actor, item, itemType) {
            this._flashIcon('red');
            this.toBeFocusedNewTimeline.define(Now, null);
            const allItems = this.menu._getMenuItems();
            const focusableItems = allItems.filter(i => i && i.reactive);
            const itemIndex = focusableItems.indexOf(actor);
            console.log(`[FocusDebug] _handleWindowClose: Setting focus intent for index: ${itemIndex}`);
            this.toBeFocusedRemoveTimeline.define(Now, itemIndex);
            this._closeSelection(actor, item, itemType);
            if (this._closeOnListCloseTimeline.at(Now)) {
                this.menu.close();
            }
        }

        _closeSelection(actor, item, itemType) {
            if (this._isDestroyed) return;
            if (itemType === 'group') {
                item.windows.forEach(([win, ts]) => win.delete(global.get_current_time()));
            }
            else {
                item.delete(global.get_current_time());
            }
        }

        _activateSelection(actor, item, itemType) {
            if (this._isDestroyed) return;
            if (itemType === 'group') {
                item.windows.forEach(([win, ts]) => Main.activateWindow(win));
            } else {
                Main.activateWindow(item);
            }
        }

        destroy() {
            if (this._isDestroyed) return;
            this._isDestroyed = true;

            for (const [win, id] of this._windowTitleConnections) {
                try {
                    if (win && !win.is_destroyed) win.disconnect(id);
                } catch (e) { /* ignore */ }
            }
            this._windowTitleConnections.clear();
            this._windowItemsMap.clear();

            super.destroy();
        }
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
        }
    }
);

// ★ メインクラス
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

        this._windowTimestamps = null;
        this.toBeFocusedNewTimeline = null;
        this.toBeFocusedRemoveTimeline = null;
        this.redrawTimeline = null;

        // ★★★ ここから追加 ★★★
        // フォーカス回復をトリガーするための新しいTimeline
        this.recoverFocusTimeline = null;
        // ★★★ 追加ここまで ★★★
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



    /**
     * 現在アクティブなメニューアイテムがあるかどうかを判定する関数
     * @returns {boolean} アクティブなアイテムがあればtrue、なければfalse
     */
    _hasActiveMenuItem() {
        try {
            // メニューボタンが存在し、かつメニューが開いていることを確認
            if (!this._appMenuButton || !this._appMenuButton.menu.isOpen) {
                console.log('[ActiveCheck] メニューが開いていないか、メニューボタンが存在しません');
                return false;
            }

            const menu = this._appMenuButton.menu;
            const menuBox = menu.box;

            if (!menuBox) {
                console.log('[ActiveCheck] メニューボックスが見つかりません');
                return false;
            }

            // 方法1: メニューのactive_itemプロパティをチェック
            if (menu.active_item) {
                // active_itemが設定されている場合、そのアイテムが有効かチェック
                const activeItem = menu.active_item;
                const isVisible = activeItem && activeItem.visible && activeItem.mapped;
                const canInteract = activeItem.reactive && activeItem.can_focus;
                const opacity = activeItem.get_paint_opacity();
                const isNotTransparent = opacity > 0;

                const isValidActive = isVisible && canInteract && isNotTransparent;

                console.log(`[ActiveCheck] active_item存在: ${!!activeItem}, 有効: ${isValidActive}`);

                if (isValidActive) {
                    return true;
                }
            }

            // 方法2: 子要素からキーフォーカスを持つアイテムを探す
            const children = menuBox.get_children();
            const focusedItem = children.find(child => {
                if (!child) return false;

                const hasKeyFocus = child.has_key_focus();
                const isVisible = child.visible && child.mapped;
                const canInteract = child.reactive && child.can_focus;
                const opacity = child.get_paint_opacity();
                const isNotTransparent = opacity > 0;

                return hasKeyFocus && isVisible && canInteract && isNotTransparent;
            });

            if (focusedItem) {
                console.log('[ActiveCheck] キーフォーカスを持つアイテムが見つかりました');
                return true;
            }

            // 方法3: ステージレベルでのフォーカス確認
            const stage = menuBox.get_stage();
            if (stage) {
                const keyFocusActor = stage.get_key_focus();
                if (keyFocusActor) {
                    // フォーカスされたアクターがメニューの子要素かチェック
                    const isMenuChild = children.some(child => child === keyFocusActor);
                    if (isMenuChild) {
                        console.log('[ActiveCheck] ステージレベルでメニュー内アイテムにフォーカスあり');
                        return true;
                    }
                }
            }

            console.log('[ActiveCheck] アクティブなアイテムが見つかりませんでした');
            return false;

        } catch (error) {
            console.error(`[ActiveCheck] エラーが発生しました: ${error.message}`);
            return false;
        }
    }




    // インデックス指定でメニューアイテムに確実にフォーカスする関数
    _focusMenuItemByIndex(targetIndex) {
        // メニューボタンが存在し、かつメニューが開いていることを確認
        if (!this._appMenuButton || !this._appMenuButton.menu.isOpen) {
            return;
        }

        const menu = this._appMenuButton.menu;
        const menuBox = menu.box;

        if (!menuBox) {
            return;
        }

        // フォーカス可能なアイテムを取得（動作実績のあるフィルタリング）
        const children = menuBox.get_children();
        const focusableItems = children.filter(child => {
            const isVisible = child && child.visible && child.mapped;
            const canInteract = child.reactive && child.can_focus;
            const opacity = child.get_paint_opacity();
            const isNotTransparent = opacity > 0;

            return isVisible && canInteract && isNotTransparent;
        });

        // インデックスの範囲チェック
        if (targetIndex < 0 || targetIndex >= focusableItems.length) {
            return;
        }

        const targetItem = focusableItems[targetIndex];

        try {
            // 動作実績のある複数のフォーカス方法を実行
            menu.active_item = targetItem;
            targetItem.grab_key_focus();

            // メニューのナビゲーション機能も使用
            if (menu.navigate_item) {
                menu.navigate_item(targetItem);
            }

            // 確実にフォーカスするため遅延チェックと追加設定
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                const hasKeyFocus = targetItem.has_key_focus();
                const isActive = menu.active_item === targetItem;

                if (!hasKeyFocus && !isActive) {
                    // 追加の方法を試行
                    const stage = targetItem.get_stage();
                    if (stage) {
                        stage.set_key_focus(targetItem);
                    }
                }

                return GLib.SOURCE_REMOVE;
            });

        } catch (error) {
            // エラーが発生しても静かに処理を継続
        }
    }
    // 使用例：
    // this._focusMenuItemByIndex(0, true); // インデックス0にフォーカスし、監視を開始
    // this._focusMenuItemByIndex(2, false); // インデックス2にフォーカスするが監視はしない
    // this.stopFocusMonitoring(); // 手動で監視を停止

    // targetWindowItemのインデックスを取得する関数
    _getMenuItemIndex(targetWindowItem) {
        // メニューボタンが存在し、かつメニューが開いていることを確認
        if (!this._appMenuButton || !this._appMenuButton.menu.isOpen || !targetWindowItem) {
            return -1;
        }

        const menu = this._appMenuButton.menu;
        const menuBox = menu.box;

        if (!menuBox) {
            return -1;
        }

        // フォーカス可能なアイテムを取得（_focusMenuItemByIndexと同じフィルタリング条件）
        const children = menuBox.get_children();
        const focusableItems = children.filter(child => {
            const isVisible = child && child.visible && child.mapped;
            const canInteract = child.reactive && child.can_focus;
            const opacity = child.get_paint_opacity();
            const isNotTransparent = opacity > 0;

            return isVisible && canInteract && isNotTransparent;
        });

        // targetWindowItemのインデックスを検索
        const targetIndex = focusableItems.findIndex(item => item === targetWindowItem);

        return targetIndex; // 見つからない場合は-1が返される
    }

    _applyFocusIntent() {
        const appToFocus = this.toBeFocusedNewTimeline.at(Now);
        const indexToFocus = this.toBeFocusedRemoveTimeline.at(Now);

        console.log(`[FocusDebug] _applyFocusIntent: Called. appToFocus: ${appToFocus?.get_id() || 'null'}, indexToFocus: ${indexToFocus}`);

        if (!appToFocus && indexToFocus === null) return;

        this.toBeFocusedNewTimeline.define(Now, null);
        this.toBeFocusedRemoveTimeline.define(Now, null);

        const focus = () => {

            if (appToFocus) {
                const allWindowItems = this._appMenuButton._windowsContainer.filter(item => item && item._itemType === 'window');
                let targetWindowItem = null;
                let latestTimestamp = -1;

                for (const item of allWindowItems) {
                    const [win, timestamp] = item._itemData;
                    const itemApp = this._windowModel._windowTracker.get_window_app(win);
                    if (itemApp && itemApp.get_id() === appToFocus.get_id()) {
                        console.log(`[FocusDebug] _applyFocusIntent: Found matching window with timestamp: ${timestamp}`);
                        if (timestamp > latestTimestamp) {
                            latestTimestamp = timestamp;
                            targetWindowItem = item;
                        }
                    }
                }
                if (targetWindowItem) {
                    console.log(`[FocusDebug] _applyFocusIntent: Attempting to focus target window item with latest timestamp: ${latestTimestamp}`);

                    const targetIndex = this._getMenuItemIndex(targetWindowItem);
                    if (targetIndex !== -1) {
                        this._focusMenuItemByIndex(targetIndex);
                    }

                } else {
                    console.log(`[FocusDebug] _applyFocusIntent: No target window found for app: ${appToFocus.get_id()}`);
                }

            } else if (indexToFocus !== null && indexToFocus >= 0) {
                // ★★★ ここからが修正箇所 ★★★
                const allItems = this._appMenuButton.menu._getMenuItems();
                const focusableItems = allItems.filter(item => item && item.reactive);
                // ★★★ 修正ここまで ★★★


                if (focusableItems.length > 0) {
                    if (indexToFocus > 0) {
                        const newFocusIndex = Math.min(indexToFocus - 1, focusableItems.length - 1);
                        console.log(`[FocusDebug] _applyFocusIntent: Attempting to focus item at new index: ${newFocusIndex}`);
                        this._focusMenuItemByIndex(newFocusIndex);
                    } else {
                        console.log(`[FocusDebug] _applyFocusIntent: Attempting to focus item at new index: 0`);
                        this._focusMenuItemByIndex(0);
                    }
                } else {
                    console.log(`[FocusDebug] _applyFocusIntent: No focusable items found after closing.`);
                }
            }
        };


        setTimeout(focus, 300); // Delay to ensure the menu is fully done before focusing

    }

    enable() {
        this._lifecycleTimeline = Timeline(true);
        this._favsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        const settings = this.getSettings();

        this._windowTimestamps = new Map();
        this.toBeFocusedNewTimeline = Timeline(null);
        this.toBeFocusedRemoveTimeline = Timeline(null);
        this.redrawTimeline = Timeline(null);

        // ★★★ ここから追加 ★★★
        // 新しいTimelineを初期化
        this.recoverFocusTimeline = Timeline(null);

        // recoverFocusTimeline が更新されたら（＝お願いが来たら）実行する処理を定義
        this.recoverFocusTimeline.map(() => {
            // メニューが開いている時だけ処理を実行
            if (this._appMenuButton && this._appMenuButton.menu.isOpen) {
                // アクティブなアイテムがないことを確認してからフォーカスを当てる
                if (!this._hasActiveMenuItem()) {
                    console.log("[FocusRecovery] No active item detected. Forcing focus to the first item.");
                    this._focusMenuItemByIndex(0);
                }
            }
        });
        // ★★★ 追加ここまで ★★★

        this.redrawTimeline.map(() => {
            console.log("[FocusDebug] Redraw completed, triggering focus intent application.");
            this._applyFocusIntent();
        });

        if (settings.get_boolean('hide-overview-at-startup')) {
            const hideOverview = () => {
                try {
                    if (Main.overview.visible) {
                        Main.overview.hide();
                        return true;
                    }
                } catch (e) { /* silent */ }
                return false;
            };

            if (!hideOverview()) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    hideOverview();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        this._lifecycleTimeline.bind(isEnabled => {
            if (isEnabled) {
                Main.wm.addKeybinding('open-popup-shortcut', settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, this._onOpenPopupShortcut.bind(this));
                for (let i = 0; i < 30; i++) {
                    Main.wm.addKeybinding(`shortcut-${i}`, settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, this._onFavoriteShortcut.bind(this, i));
                }

                this._windowModel = new WindowModel({
                    windowTimestamps: this._windowTimestamps
                });

                const mainIconPosTimeline = this._createStringSettingTimeline(settings, 'main-icon-position');
                const mainIconRankTimeline = this._createIntSettingTimeline(settings, 'main-icon-rank');
                const showIconListTimeline = this._createBooleanSettingTimeline(settings, 'show-window-icon-list');
                const dateMenuPosTimeline = this._createStringSettingTimeline(settings, 'date-menu-position');
                const dateMenuRankTimeline = this._createIntSettingTimeline(settings, 'date-menu-rank');

                this._dateTimeClockManager = new DateTimeClockManager();
                this._dateTimeClockManager.manage(dateMenuPosTimeline, dateMenuRankTimeline);

                const posAndRankTimeline = combineLatestWith((pos, rank) => ({ pos, rank }))(mainIconPosTimeline)(mainIconRankTimeline);
                const mainIconConfigTimeline = combineLatestWith((posAndRank, show) => ({ ...posAndRank, show }))(posAndRankTimeline)(showIconListTimeline);

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
                        toBeFocusedNewTimeline: this.toBeFocusedNewTimeline,
                        toBeFocusedRemoveTimeline: this.toBeFocusedRemoveTimeline,
                        redrawTimeline: this.redrawTimeline,
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
                Main.wm.removeKeybinding('open-popup-shortcut');
                for (let i = 0; i < 30; i++) { Main.wm.removeKeybinding(`shortcut-${i}`); }
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