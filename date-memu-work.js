// =====================================================================
// === extension.js (全リファクタリング統合 最終版) ===
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

import { Timeline, Now, combineLatestWith, createResource } from './timeline.js';

// =====================================================================
// === ヘルパー/UIクラス定義 (ここから) ===
// =====================================================================

class TooltipManager {
    constructor() {
        this.tooltips = new Map();
        this.currentTooltip = null;
        this.showTimeout = null;
        this.hideTimeout = null;
        this.graceTimeout = null;
        this.isGracePeriod = false;

        this.onLeave = this._onLeave.bind(this);
        this.onEnter = this._onEnter.bind(this);
    }
    add(actor, text, options) {
        if (!actor || this.tooltips.has(actor)) { return; }
        const tooltip = new ImprovedTooltip(actor, text, options);
        this.tooltips.set(actor, tooltip);
        actor.connect('destroy', () => this.remove(actor));
        actor.connect('enter-event', this.onEnter);
        actor.connect('leave-event', this.onLeave);
    }
    remove(actor) {
        if (this.tooltips.has(actor)) {
            if (this.currentTooltip && this.currentTooltip.actor === actor) { this._hide(); }
            actor.disconnect('enter-event', this.onEnter);
            actor.disconnect('leave-event', this.onLeave);
            this.tooltips.get(actor).destroy();
            this.tooltips.delete(actor);
        }
    }
    _onEnter(actor) {
        if (this.graceTimeout) {
            GLib.source_remove(this.graceTimeout);
            this.graceTimeout = null;
        }
        this.isGracePeriod = false;
        if (this.currentTooltip && this.currentTooltip.actor !== actor) { this._hide(true); }
        const tooltip = this.tooltips.get(actor);
        if (tooltip && tooltip !== this.currentTooltip) { this._show(tooltip); }
    }
    _onLeave(actor, event) {
        const related = event.get_related();
        if (related && actor.contains(related)) { return; }
        if (this.currentTooltip && this.currentTooltip.actor === actor) {
            this.isGracePeriod = true;
            this.graceTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                if (this.isGracePeriod) { this._hide(); }
                this.isGracePeriod = false;
                this.graceTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }
    _show(tooltip) {
        if (this.showTimeout) { GLib.source_remove(this.showTimeout); }
        this.showTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (this.currentTooltip) { this._hide(true); }
            this.currentTooltip = tooltip;
            this.currentTooltip.show();
            this.showTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }
    _hide(immediate = false) {
        if (this.showTimeout) {
            GLib.source_remove(this.showTimeout);
            this.showTimeout = null;
        }
        if (this.currentTooltip) {
            this.currentTooltip.hide();
            this.currentTooltip = null;
        }
    }
    destroy() {
        for (const actor of this.tooltips.keys()) { this.remove(actor); }
    }
}
const globalTooltipManager = new TooltipManager();

const ImprovedTooltip = GObject.registerClass(
    class ImprovedTooltip extends St.Label {
        _init(actor, text, options = {}) {
            super._init({ text: text, style_class: 'tooltip', opacity: 0, });
            this.actor = actor;
            this.options = options;
            Main.layoutManager.addChrome(this, { affectsStruts: false });
            this.hide();
        }
        show() {
            if (this.visible) return;
            this.visible = true;
            this.opacity = 0;
            this.set_text(this.options.text || this.text);
            const [actorX, actorY] = this.actor.get_transformed_position();
            const actorWidth = this.actor.get_width();
            const actorHeight = this.actor.get_height();
            const tooltipWidth = this.get_width();
            const tooltipHeight = this.get_height();
            const monitor = Main.layoutManager.primaryMonitor;
            let x, y;
            const position = this.options.position || 'bottom';
            switch (position) {
                case 'top': x = actorX + (actorWidth / 2) - (tooltipWidth / 2); y = actorY - tooltipHeight - 10; break;
                case 'bottom': x = actorX + (actorWidth / 2) - (tooltipWidth / 2); y = actorY + actorHeight + 10; break;
                case 'left': x = actorX - tooltipWidth - 10; y = actorY + (actorHeight / 2) - (tooltipHeight / 2); break;
                case 'right': x = actorX + actorWidth + 10; y = actorY + (actorHeight / 2) - (tooltipHeight / 2); break;
            }
            x = Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - tooltipWidth));
            y = Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - tooltipHeight));
            this.set_position(Math.round(x), Math.round(y));
            this.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD, });
        }
        hide() {
            this.ease({
                opacity: 0, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => { this.visible = false; },
            });
        }
    }
);

function addTooltip(actor, text, options = {}) { globalTooltipManager.add(actor, text, options); }
function cleanupAllTooltips() { globalTooltipManager.destroy(); }

function _sortUsingCommonRules(items, favoriteAppIds, getAppId) {
    const favSet = new Set(favoriteAppIds);
    items.sort((a, b) => {
        const idA = getAppId(a);
        const idB = getAppId(b);
        const isFavA = favSet.has(idA);
        const isFavB = favSet.has(idB);
        if (isFavA && !isFavB) return -1;
        if (!isFavA && isFavB) return 1;
        if (isFavA && isFavB) { return favoriteAppIds.indexOf(idA) - favoriteAppIds.indexOf(idB); }
        return (a.get_name() || '').localeCompare(b.get_name() || '');
    });
    return items;
}

const NonClosingPopupBaseMenuItem = GObject.registerClass({
    Signals: { 'item-activated': {} },
}, class NonClosingPopupBaseMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(params = {}) {
        super._init(params);
        this.connect('activate', (actor, event) => { this.emit('item-activated'); });
    }
});

const RunningAppsIconList = GObject.registerClass(
    class RunningAppsIconList extends St.BoxLayout {
        _init(params) {
            super._init({ style_class: 'running-apps-icon-list' });
            this._windowsTimeline = params.windowsTimeline;
            this._favoritesTimeline = params.favoritesTimeline;
            this._iconSize = 24;
            this._icons = new Map();
            this._windowsTimeline.bind(this._updateRunningApps.bind(this));
            this._favoritesTimeline.bind(this._updateRunningApps.bind(this));
        }
        _updateRunningApps() {
            const windows = this._windowsTimeline.at(Now) || [];
            const favorites = this._favoritesTimeline.at(Now) || [];
            const runningApps = new Map();
            windows.forEach(win => {
                const app = Shell.AppSystem.get_default().lookup_app_for_window(win);
                if (app && !runningApps.has(app.get_id())) { runningApps.set(app.get_id(), app); }
            });
            const sortedApps = _sortUsingCommonRules([...runningApps.values()], favorites, app => app.get_id());
            const sortedAppIds = sortedApps.map(app => app.get_id());
            const currentAppIds = [...this._icons.keys()];
            currentAppIds.filter(id => !sortedAppIds.includes(id)).forEach(id => {
                this._icons.get(id).destroy();
                this._icons.delete(id);
            });
            sortedApps.forEach((app, index) => {
                const appId = app.get_id();
                if (!this._icons.has(appId)) {
                    const icon = app.create_icon_texture(this._iconSize);
                    this._icons.set(appId, icon);
                    addTooltip(icon, app.get_name());
                    this.insert_child_at_index(icon, index);
                } else {
                    const icon = this._icons.get(appId);
                    if (this.get_child_at_index(index) !== icon) {
                        this.remove_child(icon);
                        this.insert_child_at_index(icon, index);
                    }
                }
            });
        }
    }
);

const RunningAppsIndicator = GObject.registerClass(
    class RunningAppsIndicator extends PanelMenu.Button {
        _init(params) {
            super._init(0.5, 'RunningAppsIndicator');
            this.iconList = new RunningAppsIconList(params);
            this.add_child(this.iconList);
        }
    }
);

const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init(params) {
            super._init(0.5, 'AppMenuButton');
            this.menu.actor.add_style_class_name('app-menu');
            this._buildUI(params);
        }
        _buildUI(params) {
            const {
                windowsTimeline, favoritesTimeline, toBeFocusedNewTimeline,
                toBeFocusedIndexCloseTimeline, toBeFocusedIndexActivateTimeline,
                redrawTimeline, closeOnFavLaunchTimeline, closeOnListActivateTimeline,
                closeOnListCloseTimeline, mainShortcutActionTimeline, mainPanelIconTimeline,
                showOverviewButtonTimeline, extension, settings
            } = params;
            this.mainPanelIconTimeline = mainPanelIconTimeline;
            this.mainPanelIconTimeline.bind(iconType => {
                if (this.icon) this.icon.destroy();
                const iconName = iconType === 'view-app-grid-symbolic' ? 'view-app-grid-symbolic' : 'start-here-symbolic';
                this.icon = new St.Icon({ icon_name: iconName, style_class: 'system-status-icon' });
                this.add_child(this.icon);
            }).run();
            this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) { redrawTimeline.define(Now, Date.now()); }
            });
            const combinedTimeline = combineLatestWith((
                windows, favorites, redraw, toBeFocusedNew, toBeFocusedIndexClose,
                toBeFocusedIndexActivate, closeOnFavLaunch, closeOnListActivate,
                closeOnListClose, mainShortcutAction, showOverviewButton
            ) => ({
                windows, favorites, redraw, toBeFocusedNew, toBeFocusedIndexClose,
                toBeFocusedIndexActivate, closeOnFavLaunch, closeOnListActivate,
                closeOnListClose, mainShortcutAction, showOverviewButton
            }))(
                windowsTimeline, favoritesTimeline, redrawTimeline, toBeFocusedNewTimeline,
                toBeFocusedIndexCloseTimeline, toBeFocusedIndexActivateTimeline,
                closeOnFavLaunchTimeline, closeOnListActivateTimeline, closeOnListCloseTimeline,
                mainShortcutActionTimeline, showOverviewButtonTimeline
            );
            combinedTimeline.bind(data => {
                this.menu.removeAll();
                this._populateMenu(data, extension, settings);
            }).run();
        }
        _populateMenu(data, extension, settings) {
            const { windows, favorites, showOverviewButton } = data;
            const favApps = new Map(favorites.map(id => [id, Shell.AppSystem.get_default().lookup_app(id)]).filter(([id, app]) => app));
            const runningApps = new Map(windows.map(win => [
                Shell.AppSystem.get_default().lookup_app_for_window(win).get_id(),
                Shell.AppSystem.get_default().lookup_app_for_window(win)
            ]));
            if (showOverviewButton) {
                const overviewItem = new PopupMenu.PopupMenuItem('Overview');
                overviewItem.connect('activate', () => Main.overview.toggle());
                this.menu.addMenuItem(overviewItem);
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            const section = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(section);
            const favSection = this._createAppSection('Favorites', favApps, data, extension);
            section.actor.add_child(favSection);
            const runningSection = this._createAppSection('Running', runningApps, data, extension);
            section.actor.add_child(runningSection);
        }
        _createAppSection(title, apps, data, extension) {
            const section = new St.BoxLayout({ vertical: true, style_class: 'app-section' });
            const label = new St.Label({ text: title, style_class: 'app-section-title' });
            section.add_child(label);
            const sortedApps = _sortUsingCommonRules([...apps.values()], data.favorites, app => app.get_id());
            sortedApps.forEach(app => {
                const item = new NonClosingPopupBaseMenuItem();
                const icon = app.create_icon_texture(24);
                const name = new St.Label({ text: app.get_name() });
                item.add_child(icon);
                item.add_child(name);
                section.add_child(item);
                item.connect('item-activated', () => {
                    const windows = app.get_windows();
                    if (windows.length > 0) {
                        Main.activateWindow(windows[0]);
                    } else {
                        app.launch(0, -1, Shell.AppLaunchGpu.DEFAULT);
                    }
                    if (data.closeOnFavLaunch) this.menu.close();
                });
                const favToggle = new St.Button({ style_class: 'fav-toggle-button' });
                const favIcon = new St.Icon({
                    icon_name: data.favorites.includes(app.get_id()) ? 'starred-symbolic' : 'non-starred-symbolic',
                    style_class: 'system-status-icon'
                });
                favToggle.set_child(favIcon);
                item.add_child(favToggle);
                favToggle.connect('clicked', () => extension._toggleFavorite(app.get_id()));
            });
            return section;
        }
    }
);

// =====================================================================
// === ヘルパー/UIクラス定義 (ここまで) ===
// =====================================================================


// =====================================================================
// === メインクラス: MinimalTimelineExtension ===
// =====================================================================
export default class MinimalTimelineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._lifecycleTimeline = null;
        this._mainLifecycleManager = null;
        this._favsSettings = null;
        this._gsettingsDisconnectFuncs = [];
        this.toBeFocusedNewTimeline = null;
        this.toBeFocusedIndexCloseTimeline = null;
        this.toBeFocusedIndexActivateTimeline = null;
        this.redrawTimeline = null;
        this.recoverFocusTimeline = null;
    }

    enable() {
        log('[AIO-LIFECYCLE] Extension enabling...');
        this._lifecycleTimeline = Timeline(true);
        this._initializeMainLifecycle();
        log('[AIO-LIFECYCLE] Main lifecycle initialized.');
    }

    disable() {
        log('[AIO-LIFECYCLE] Extension disabling...');
        this._lifecycleTimeline?.define(Now, false);
        this._lifecycleTimeline = null;
        log('[AIO-LIFECYCLE] Extension disabled. All resources should be cleaned up.');
    }
    _initializeMainLifecycle() {
        const settings = this.getSettings();
        this._favsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

        this._mainLifecycleManager = this._lifecycleTimeline.using(isEnabled => {
            if (!isEnabled) {
                log('[AIO-LIFECYCLE] Top-level .using(): isEnabled is false. Cleanup will be triggered automatically.');
                return null;
            }

            log('[AIO-LIFECYCLE] Top-level .using(): isEnabled is true. Starting setup...');

            // =================================================
            // 副作用管理 ゾーン
            // =================================================

            // --- 1. ウィンドウリストの監視 ---
            const windowsTimeline = Timeline([]);
            const windowTimestamps = new Map();
            const signalConnections = [];
            const connectSignal = (source, signalName, callback) => {
                if (!source) return;
                const handlerId = source.connect(signalName, callback);
                signalConnections.push([source, handlerId]);
            };
            const _updateWindowList = () => {
                const workspace = global.workspace_manager.get_active_workspace();
                let windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);
                windows = windows.filter(win => {
                    try {
                        return win && !win.is_override_redirect() && win.get_compositor_private() && win.get_window_type() !== Meta.WindowType.DESKTOP && !win.is_skip_taskbar();
                    } catch (e) { return false; }
                });
                windows.forEach(win => {
                    if (!windowTimestamps.has(win.get_id())) { windowTimestamps.set(win.get_id(), Date.now()); }
                });
                windows.sort((a, b) => (windowTimestamps.get(b.get_id()) || 0) - (windowTimestamps.get(a.get_id()) || 0));
                windowsTimeline.define(Now, windows);
            };
            _updateWindowList();
            connectSignal(Shell.AppSystem.get_default(), 'app-state-changed', _updateWindowList);
            connectSignal(global.window_manager, 'switch-workspace', _updateWindowList);
            connectSignal(global.window_manager, 'map', _updateWindowList);
            connectSignal(global.window_manager, 'destroy', _updateWindowList);
            connectSignal(Main.overview, 'showing', _updateWindowList);
            connectSignal(Main.overview, 'hiding', _updateWindowList);
            log('[AIO-LIFECYCLE] Window-related signals connected.');

            // --- 2. キーバインド設定 ---
            const keybindingNames = ['main-shortcut', ...Array.from({ length: 30 }, (_, i) => `shortcut-${i}`)];
            const keybindingCallbacks = [this._onOpenPopupShortcut.bind(this), ...Array.from({ length: 30 }, (_, i) => this._onFavoriteShortcut.bind(this, i))];
            keybindingNames.forEach((name, i) => { Main.wm.addKeybinding(name, settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, keybindingCallbacks[i]); });
            log('[AIO-LIFECYCLE] Keybindings registered.');

            // --- 3. 時計の位置管理 (修正版) ---
            const dateMenu = Main.panel.statusArea.dateMenu;
            let originalDateMenuParent = null;
            let originalDateMenuIndex = -1;

            if (dateMenu) {
                // 元の位置を保存
                originalDateMenuParent = dateMenu.container.get_parent();
                if (originalDateMenuParent) {
                    const children = originalDateMenuParent.get_children();
                    originalDateMenuIndex = children.indexOf(dateMenu.container);
                }

                const dateMenuPosTimeline = this._createStringSettingTimeline(settings, 'date-menu-position').timeline;
                const dateMenuRankTimeline = this._createIntSettingTimeline(settings, 'date-menu-rank').timeline;

                const dateMenuCombinedTimeline = combineLatestWith((pos, rank) => ({ pos, rank }))(dateMenuPosTimeline)(dateMenuRankTimeline);
                dateMenuCombinedTimeline.bind(({ pos, rank }) => {
                    // 現在のparentから削除
                    const currentParent = dateMenu.container.get_parent();
                    if (currentParent) {
                        currentParent.remove_child(dateMenu.container);
                    }

                    // 新しい位置に配置（addToStatusAreaは使わない）
                    let targetBox;
                    switch (pos) {
                        case 'left':
                            targetBox = Main.panel._leftBox;
                            break;
                        case 'right':
                            targetBox = Main.panel._rightBox;
                            break;
                        case 'center':
                        default:
                            targetBox = Main.panel._centerBox;
                            break;
                    }

                    if (targetBox) {
                        const numChildren = targetBox.get_n_children();
                        const insertIndex = Math.min(rank, numChildren);
                        targetBox.insert_child_at_index(dateMenu.container, insertIndex);
                    }
                });
                log('[AIO-LIFECYCLE] DateMenu position management started.');
            }

            // --- 4. Activitiesボタン管理 (旧 ActivitiesButtonManager) ---
            const activitiesButton = Main.panel.statusArea.activities;
            const originalActivitiesButtonVisible = activitiesButton?.visible;
            if (activitiesButton) {
                const hideTimeline = this._createBooleanSettingTimeline(settings, 'hide-activities-button').timeline;
                hideTimeline.bind(hide => {
                    if (activitiesButton) {
                        activitiesButton.visible = !hide;
                    }
                });
                log('[AIO-LIFECYCLE] ActivitiesButton visibility management started.');
            }

            // --- 5. メインUIのライフサイクル管理 ---
            this.toBeFocusedNewTimeline = Timeline(null);
            this.toBeFocusedIndexCloseTimeline = Timeline(null);
            this.toBeFocusedIndexActivateTimeline = Timeline(null);
            this.redrawTimeline = Timeline(null);
            this.recoverFocusTimeline = Timeline(null);

            const mainIconPosTimeline = this._createStringSettingTimeline(settings, 'main-icon-position').timeline;
            const mainIconRankTimeline = this._createIntSettingTimeline(settings, 'main-icon-rank').timeline;
            const showIconListTimeline = this._createBooleanSettingTimeline(settings, 'show-window-icon-list').timeline;

            this._createMainIconLifecycle(mainIconPosTimeline, mainIconRankTimeline, showIconListTimeline, settings, windowsTimeline);

            // =================================================
            // クリーンアップ関数
            // =================================================
            const cleanup = () => {
                log('[AIO-LIFECYCLE] Top-level cleanup started...');
                for (const [source, handlerId] of signalConnections) { try { source.disconnect(handlerId); } catch (e) { } }
                log('[AIO-LIFECYCLE] Window-related signals disconnected.');
                keybindingNames.forEach(name => Main.wm.removeKeybinding(name));
                log('[AIO-LIFECYCLE] Keybindings removed.');

                // dateMenuの位置を元に戻す
                if (dateMenu && originalDateMenuParent) {
                    const currentParent = dateMenu.container.get_parent();
                    if (currentParent && currentParent !== originalDateMenuParent) {
                        currentParent.remove_child(dateMenu.container);
                        if (originalDateMenuIndex >= 0) {
                            originalDateMenuParent.insert_child_at_index(dateMenu.container, originalDateMenuIndex);
                        } else {
                            originalDateMenuParent.add_child(dateMenu.container);
                        }
                    }
                    log('[AIO-LIFECYCLE] DateMenu position restored.');
                }

                if (activitiesButton) { activitiesButton.visible = originalActivitiesButtonVisible; }
                log('[AIO-LIFECYCLE] ActivitiesButton visibility restored.');
                this._gsettingsDisconnectFuncs.forEach(disconnect => disconnect());
                this._gsettingsDisconnectFuncs = [];
                log('[AIO-LIFECYCLE] GSettings connections disconnected.');
                cleanupAllTooltips();
                this._favsSettings = null;
                log('[AIO-LIFECYCLE] Top-level cleanup finished.');
            };

            return createResource({ /* dummy */ }, cleanup);
        });
    }
    _createGenericSettingTimeline(settings, key, getter) {
        const timeline = Timeline(getter(key));
        const connectionId = settings.connect(`changed::${key}`, () => {
            timeline.define(Now, getter(key));
        });
        const disconnect = () => { try { if (settings && connectionId) settings.disconnect(connectionId); } catch (e) { } };
        this._gsettingsDisconnectFuncs.push(disconnect);
        return { timeline, disconnect };
    }

    _createStrvSettingTimeline(settings, key) { return this._createGenericSettingTimeline(settings, key, settings.get_strv.bind(settings)); }
    _createBooleanSettingTimeline(settings, key) { return this._createGenericSettingTimeline(settings, key, settings.get_boolean.bind(settings)); }
    _createStringSettingTimeline(settings, key) { return this._createGenericSettingTimeline(settings, key, settings.get_string.bind(settings)); }
    _createIntSettingTimeline(settings, key) { return this._createGenericSettingTimeline(settings, key, settings.get_int.bind(settings)); }

    _createMainIconLifecycle(posTimeline, rankTimeline, showListTimeline, settings, windowsTimeline) {
        log('[AIO-LIFECYCLE] Initializing Main Icon Lifecycle...');

        // 3つのタイムラインを段階的に組み合わせる
        const posRankTimeline = combineLatestWith((pos, rank) => ({ pos, rank }))(posTimeline)(rankTimeline);
        const configTimeline = combineLatestWith((posRank, show) => ({ ...posRank, show }))(posRankTimeline)(showListTimeline);

        configTimeline.bind(({ pos, rank, show }) => {
            log(`[AIO-LIFECYCLE] CONFIG_CHANGED -> pos: ${pos}, rank: ${rank}, showList: ${show}`);
            log('[AIO-LIFECYCLE] bind: Automatically destroying previous UI components (if any)...');
            log('[AIO-LIFECYCLE] bind: Creating new UI components...');

            const { timeline: favoritesTimeline } = this._createStrvSettingTimeline(this._favsSettings, 'favorite-apps');
            const { timeline: showOverviewButtonTimeline } = this._createBooleanSettingTimeline(settings, 'show-overview-button');
            const { timeline: closeOnFavLaunchTimeline } = this._createBooleanSettingTimeline(settings, 'close-on-fav-launch');
            const { timeline: closeOnListActivateTimeline } = this._createBooleanSettingTimeline(settings, 'close-on-list-activate');
            const { timeline: closeOnListCloseTimeline } = this._createBooleanSettingTimeline(settings, 'close-on-list-close');
            const { timeline: mainShortcutActionTimeline } = this._createStringSettingTimeline(settings, 'main-shortcut-action');
            const { timeline: mainPanelIconTimeline } = this._createStringSettingTimeline(settings, 'main-panel-icon');

            const appMenuButton = new AppMenuButton({
                windowsTimeline, favoritesTimeline, toBeFocusedNewTimeline: this.toBeFocusedNewTimeline,
                toBeFocusedIndexCloseTimeline: this.toBeFocusedIndexCloseTimeline, toBeFocusedIndexActivateTimeline: this.toBeFocusedIndexActivateTimeline,
                redrawTimeline: this.redrawTimeline, closeOnFavLaunchTimeline, closeOnListActivateTimeline, closeOnListCloseTimeline,
                mainShortcutActionTimeline, mainPanelIconTimeline, showOverviewButtonTimeline, extension: this, settings,
            });
            log(`[AIO-LIFECYCLE] bind: AppMenuButton created. Adding to panel at -> pos: ${pos}, rank: ${rank}`);
            Main.panel.addToStatusArea(`${this.uuid}-AppMenuButton`, appMenuButton, rank, pos);

            const runningAppsIndicator = new RunningAppsIndicator({ windowsTimeline, favoritesTimeline });
            runningAppsIndicator.visible = show;
            log(`[AIO-LIFECYCLE] bind: RunningAppsIndicator created. visibility: ${show}. Adding to panel at -> pos: ${pos}, rank: ${rank + 1}`);
            Main.panel.addToStatusArea(`${this.uuid}-RunningAppsIndicator`, runningAppsIndicator, rank + 1, pos);

            const managedResources = { appMenuButton, runningAppsIndicator };
            log('[AIO-LIFECYCLE] bind: New UI components created and added to panel.');

            return createResource(managedResources, () => {
                log('[AIO-LIFECYCLE] Cleanup for UI components starting...');
                try {
                    if (appMenuButton) appMenuButton.destroy();
                    if (runningAppsIndicator) runningAppsIndicator.destroy();
                    log('[AIO-LIFECYCLE] UI components destroyed successfully.');
                } catch (e) {
                    logError(e, '[AIO-LIFECYCLE] Error during UI component cleanup');
                }
            });
        });
    }

    _onOpenPopupShortcut() {
        // このアクセス方法は、bindの戻り値がTimeline(resource)であるため、
        // 直接のアクセスはできない。イベントバスのような仕組みを検討する必要がある
        // が、まずは一旦、直接参照を試みる。
        const mainLifecycleData = this._mainLifecycleManager?.at(Now);
        const appMenuButton = mainLifecycleData?.appMenuButton; // ここは修正が必要になる可能性

        if (appMenuButton) {
            appMenuButton.menu.toggle();
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