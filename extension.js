import GLib from 'gi://GLib';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// --- Improved Custom Tooltip Class and Helper ---
const Tooltip = GObject.registerClass(
    class Tooltip extends St.Label {
        _init() {
            super._init({
                style_class: 'tooltip',
                style: `
                    background-color: rgba(0, 0, 0, 0.8);
                    color: white;
                    padding: 6px 10px;
                    border-radius: 5px;
                    font-size: 14px;
                    font-weight: 500;
                    opacity: 0;
                    pointer-events: none;
                    z-index: 1000;
                `,
                visible: false
            });
            Main.uiGroup.add_child(this);
            this._isDestroyed = false;
            this._isVisible = false;
        }

        showTooltip(text, sourceActor) {
            if (this._isDestroyed) return;

            this.set_text(text);
            this.visible = true; // Make visible first to get correct dimensions

            // Force a layout to get accurate dimensions
            this.get_theme_node().get_content_box(this.get_allocation_box());

            // Position tooltip near the source actor
            const [stageX, stageY] = sourceActor.get_transformed_position();
            const [actorWidth, actorHeight] = sourceActor.get_size();
            const [tooltipWidth, tooltipHeight] = this.get_size();

            // Check if the source actor is in the top panel
            const isInTopPanel = this._isActorInTopPanel(sourceActor);

            // Center horizontally above/below the source actor
            const x = Math.max(0, Math.min(
                stageX + actorWidth / 2 - tooltipWidth / 2,
                global.stage.width - tooltipWidth
            ));

            let y;
            if (isInTopPanel) {
                // Position tooltip below the panel icon with some spacing
                y = Math.min(
                    stageY + actorHeight + 8,
                    global.stage.height - tooltipHeight
                );
            } else {
                // Position tooltip above the source actor (original behavior for popup menu items)
                y = Math.max(0, stageY - tooltipHeight - 5);
            }

            this.set_position(x, y);
            this._isVisible = true;

            this.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        }

        _isActorInTopPanel(actor) {
            // Check if the actor is a child of the top panel
            let parent = actor.get_parent();
            while (parent) {
                if (parent === Main.panel) {
                    return true;
                }
                // Also check if it's in any of the panel's boxes
                if (parent === Main.panel._leftBox ||
                    parent === Main.panel._centerBox ||
                    parent === Main.panel._rightBox) {
                    return true;
                }
                parent = parent.get_parent();
            }
            return false;
        }

        hideTooltip() {
            if (this._isDestroyed || !this._isVisible) return;

            this._isVisible = false;
            this.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._isDestroyed && !this._isVisible) {
                        this.visible = false;
                    }
                }
            });
        }

        destroy() {
            if (this._isDestroyed) return;

            this._isDestroyed = true;
            this._isVisible = false;

            // Stop any ongoing animations
            this.remove_all_transitions();

            // Hide immediately
            this.visible = false;
            this.opacity = 0;

            // Remove from UI group
            if (this.get_parent()) {
                this.get_parent().remove_child(this);
            }

            super.destroy();
        }
    });

function addTooltip(actor, text, delay = 500) {
    let tooltip = null;
    let showTimeout = null;
    let hideTimeout = null;
    let isHovering = false;

    const enterHandler = actor.connect('enter-event', () => {
        isHovering = true;

        // Clear any existing hide timeout
        if (hideTimeout) {
            GLib.source_remove(hideTimeout);
            hideTimeout = null;
        }

        // Clear any existing show timeout
        if (showTimeout) {
            GLib.source_remove(showTimeout);
            showTimeout = null;
        }

        showTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            if (isHovering && !tooltip) {
                tooltip = new Tooltip();
            }
            if (tooltip && !tooltip._isDestroyed && isHovering) {
                tooltip.showTooltip(text, actor);
            }
            showTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    });

    const leaveHandler = actor.connect('leave-event', () => {
        isHovering = false;

        // Clear any pending show timeout
        if (showTimeout) {
            GLib.source_remove(showTimeout);
            showTimeout = null;
        }

        if (tooltip && !tooltip._isDestroyed) {
            // Hide immediately, no delay
            tooltip.hideTooltip();

            // Clean up tooltip after a short delay
            hideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                if (tooltip && !tooltip._isDestroyed) {
                    tooltip.destroy();
                    tooltip = null;
                }
                hideTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    });

    // Enhanced cleanup function
    actor._tooltipCleanup = () => {
        isHovering = false;

        // Disconnect signal handlers
        if (enterHandler) {
            try {
                actor.disconnect(enterHandler);
            } catch (e) {
                // Actor might already be destroyed
            }
        }
        if (leaveHandler) {
            try {
                actor.disconnect(leaveHandler);
            } catch (e) {
                // Actor might already be destroyed
            }
        }

        // Clear timeouts
        if (showTimeout) {
            GLib.source_remove(showTimeout);
            showTimeout = null;
        }
        if (hideTimeout) {
            GLib.source_remove(hideTimeout);
            hideTimeout = null;
        }

        // Destroy tooltip immediately
        if (tooltip) {
            tooltip.destroy();
            tooltip = null;
        }

        // Remove cleanup function reference
        delete actor._tooltipCleanup;
    };
}

// --- Model ---
const WindowModel = GObject.registerClass({
    Signals: { 'updated': {} },
}, class WindowModel extends GObject.Object {
    _init() {
        super._init();
        this._windowTracker = Shell.WindowTracker.get_default();
        this._data = [];
        this._windowSignalIds = new Map();
        this._restackedId = global.display.connect('restacked', () => this.update());

        // Load favorite settings and monitor changes
        this._favoritesSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        this._favoritesChangedId = this._favoritesSettings.connect('changed::favorite-apps', () => this.update());

        this.update();
    }
    getData() { return this._data; }
    update() {
        for (const [win, signalId] of this._windowSignalIds) {
            if (win && signalId > 0 && win.get_compositor_private()) {
                win.disconnect(signalId);
            }
        }
        this._windowSignalIds.clear();
        const groupedByApp = new Map();
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
        for (const metaWindow of windows) {
            if (metaWindow.is_skip_taskbar()) continue;
            const app = this._windowTracker.get_window_app(metaWindow);
            if (!app) continue;
            const signalId = metaWindow.connect('notify::title', () => this.update());
            this._windowSignalIds.set(metaWindow, signalId);
            const appId = app.get_id();
            if (!groupedByApp.has(appId)) groupedByApp.set(appId, { app: app, windows: [] });
            groupedByApp.get(appId).windows.push(metaWindow);
        }

        const favorites = this._favoritesSettings.get_strv('favorite-apps');

        this._data = Array.from(groupedByApp.values()).sort((a, b) => {
            const appIdA = a.app.get_id();
            const appIdB = b.app.get_id();

            const isFavoriteA = favorites.includes(appIdA);
            const isFavoriteB = favorites.includes(appIdB);

            // 1. If both are favorites, prioritize the order in the favorites list
            if (isFavoriteA && isFavoriteB) {
                const indexA = favorites.indexOf(appIdA);
                const indexB = favorites.indexOf(appIdB);
                return indexA - indexB;
            }

            // 2. If only one is a favorite, prioritize the favorite
            if (isFavoriteA) return -1; // a is favorite, so a comes first
            if (isFavoriteB) return 1;  // b is favorite, so b comes first

            // 3. If neither is a favorite, sort alphabetically
            return a.app.get_name().localeCompare(b.app.get_name());
        });
        this.emit('updated');
    }
    destroy() {
        if (this._restackedId) global.display.disconnect(this._restackedId);
        for (const [win, signalId] of this._windowSignalIds) {
            if (win && signalId > 0 && win.get_compositor_private()) win.disconnect(signalId);
        }
        this._windowSignalIds.clear();

        // Disconnect favorite settings
        if (this._favoritesSettings && this._favoritesChangedId) {
            this._favoritesSettings.disconnect(this._favoritesChangedId);
            this._favoritesSettings = null;
        }
    }
});

// --- View 2 (WindowIconList) - Fixed Version ---
const WindowIconList = GObject.registerClass(
    class WindowIconList extends GObject.Object {
        _init(params) {
            super._init();
            this._model = params.model;
            this._iconSize = params.iconSize || 24;
            this.wrapperButton = new PanelMenu.Button(0.0, 'Window-Icon-List-Wrapper');
            this.wrapperButton.remove_style_class_name('panel-button');
            this.container = new St.BoxLayout({ name: 'WindowIconListContainer' });
            this.wrapperButton.add_child(this.container);
            this._updatedConnection = this._model.connect('updated', () => this._redraw());
            this._iconButtons = []; // Track all icon buttons for cleanup
            this._redraw();
        }

        _redraw() {
            // Clean up existing tooltips before destroying children
            this._cleanupTooltips();
            this.container.destroy_all_children();
            this._iconButtons = []; // Reset the tracking array

            const sortedApps = this._model.getData();
            for (const group of sortedApps) {
                for (const win of group.windows) {
                    const button = this._createIconButton(group.app, win);
                    this.container.add_child(button);
                    this._iconButtons.push(button); // Track this button
                }
            }
        }

        _createIconButton(app, metaWindow) {
            const icon = new St.Icon({ gicon: app.get_icon(), icon_size: this._iconSize });
            const button = new St.Button({
                child: icon,
                style_class: 'panel-button',
                track_hover: true,
                reactive: true
            });

            // Add custom tooltip with app name - 迅速に表示（遅延なし）
            addTooltip(button, app.get_name(), 0);

            button.connect('clicked', () => { metaWindow.activate(global.get_current_time()); });
            return button;
        }

        _cleanupTooltips() {
            // Clean up tooltips from all tracked buttons
            this._iconButtons.forEach(button => {
                if (button && button._tooltipCleanup) {
                    button._tooltipCleanup();
                }
            });
        }

        destroy() {
            // Clean up tooltips before destroying
            this._cleanupTooltips();

            if (this._updatedConnection) {
                this._model.disconnect(this._updatedConnection);
                this._updatedConnection = null;
            }

            // Clear the tracking array
            this._iconButtons = [];

            if (this.wrapperButton) {
                this.wrapperButton.destroy();
                this.wrapperButton = null;
            }
        }
    });

// --- View 1 (AppMenuButton) ---
const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init(params) {
            super._init(0.0, 'All Windows Menu');
            this._model = params.model;
            this._extension = params.extension;
            this._tooltipActors = []; // ツールチップを持つアクターを追跡

            this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            this._settingsChangedId = this._settings.connect('changed::favorite-apps', () => this._redraw());

            this.add_child(new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'system-status-icon' }));
            this.menu.actor.add_style_class_name('compact-window-list');

            // メニューが閉じられた時のクリーンアップ
            this._menuClosedId = this.menu.connect('menu-closed', () => {
                this._cleanupAllTooltips();
            });

            this._updatedConnection = this._model.connect('updated', () => this._redraw());
            this._redraw();
        }

        _cleanupAllTooltips() {
            // 全てのツールチップアクターをクリーンアップ
            this._tooltipActors.forEach(actor => {
                if (actor && actor._tooltipCleanup) {
                    actor._tooltipCleanup();
                }
            });
            this._tooltipActors = [];
        }

        _addTooltipActor(actor) {
            // ツールチップを持つアクターを追跡リストに追加
            this._tooltipActors.push(actor);
        }

        _redraw() {
            // 既存のツールチップをクリーンアップ
            this._cleanupAllTooltips();

            this.menu.removeAll();
            const favorites = this._settings.get_strv('favorite-apps');
            const sortedApps = this._model.getData();

            const listItemStyle = 'min-height: 36px; padding: 0 8px;';
            const separatorStyle = 'padding: 0; margin: 0; height: 1px; background-color: rgba(192, 192, 192, 0.2);';

            if (favorites.length > 0) {
                const favoritesItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'popup-menu-item' });
                favoritesItem.actor.set_style(listItemStyle);

                const mainBox = new St.BoxLayout({ x_expand: true, style: 'spacing: 6px;', y_align: Clutter.ActorAlign.CENTER });
                const favoritesBox = new St.BoxLayout({ x_expand: true, style: 'spacing: 6px;' });

                for (const appId of favorites) {
                    const app = Shell.AppSystem.get_default().lookup_app(appId);
                    if (!app) continue;

                    const icon = new St.Icon({ gicon: app.get_icon(), icon_size: 28 });
                    const button = new St.Button({
                        child: icon,
                        style_class: 'popup-menu-item',
                        track_hover: true,
                        can_focus: true,
                        accessible_name: app.get_name()
                    });

                    const normalStyle = 'background-color: transparent; padding: 4px; border-radius: 4px;';
                    const hoverStyle = 'background-color: rgba(255, 255, 255, 0.1); padding: 4px; border-radius: 4px;';
                    button.set_style(normalStyle);

                    // ツールチップを追加し、追跡リストに登録
                    addTooltip(button, app.get_name(), 0);
                    this._addTooltipActor(button);

                    button.connect('enter-event', () => button.set_style(hoverStyle));
                    button.connect('leave-event', () => button.set_style(normalStyle));

                    button.connect('clicked', () => {
                        this._cleanupAllTooltips(); // クリック時にツールチップをクリーンアップ
                        try {
                            app.launch(0, [], null);
                            this.menu.close();
                        } catch (error) {
                            try {
                                const context = global.create_app_launch_context(
                                    global.get_current_time(),
                                    global.workspace_manager.get_active_workspace().index
                                );
                                app.launch(0, [], context);
                                this.menu.close();
                            } catch (contextError) {
                                console.error(`[AllWindows] Fallback to activate()`);
                                app.activate();
                                this.menu.close();
                            }
                        }
                    });

                    favoritesBox.add_child(button);
                }

                const settingsIcon = new St.Icon({ icon_name: 'preferences-system-symbolic', icon_size: 16, style_class: 'popup-menu-icon' });
                const settingsButton = new St.Button({ child: settingsIcon, style_class: 'popup-menu-item', accessible_name: _("Settings"), style: 'padding: 4px; border-radius: 4px;' });
                settingsButton.connect('clicked', () => {
                    this._cleanupAllTooltips();
                    this._extension.openPreferences();
                    this.menu.close();
                });

                mainBox.add_child(favoritesBox);
                mainBox.add_child(settingsButton);

                favoritesItem.add_child(mainBox);
                this.menu.addMenuItem(favoritesItem);
            }

            if (sortedApps.length > 0) {
                if (favorites.length > 0) {
                    const separator = new PopupMenu.PopupSeparatorMenuItem();
                    separator.actor.set_style(separatorStyle);
                    this.menu.addMenuItem(separator);
                }

                for (const group of sortedApps) {
                    if (group.windows.length === 0) continue;

                    const appId = group.app.get_id();
                    const isFavorite = favorites.includes(appId);

                    const appHeader = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'popup-menu-item' });
                    appHeader.actor.set_style(listItemStyle);

                    const mainBox = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;', y_align: Clutter.ActorAlign.CENTER });
                    const appInfoBox = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
                    appInfoBox.add_child(group.app.create_icon_texture(24));
                    appInfoBox.add_child(new St.Label({ text: group.app.get_name(), y_align: Clutter.ActorAlign.CENTER }));

                    const appInfoButton = new St.Button({ child: appInfoBox, x_expand: true, style_class: 'popup-menu-item' });

                    appInfoButton.connect('clicked', () => {
                        this._cleanupAllTooltips();
                        group.windows.forEach(metaWindow => metaWindow.activate(global.get_current_time()));
                        this.menu.close();
                    });

                    const rightButtonBox = new St.BoxLayout({ style: 'spacing: 4px;' });

                    if (isAppLaunchable(group.app)) {
                        const favoriteIconName = isFavorite ? 'starred-symbolic' : 'non-starred-symbolic';
                        const favoriteTooltip = isFavorite ? _("Remove from favorites") : _("Add to favorites");
                        const favoriteIcon = new St.Icon({ icon_name: favoriteIconName, icon_size: 16, style_class: 'popup-menu-icon' });
                        const favoriteButton = new St.Button({ child: favoriteIcon, style_class: 'popup-menu-item', accessible_name: favoriteTooltip, style: 'padding: 4px; border-radius: 4px;' });

                        // お気に入りボタンにもツールチップを追加し、追跡
                        addTooltip(favoriteButton, favoriteTooltip, 0);
                        this._addTooltipActor(favoriteButton);

                        favoriteButton.connect('clicked', () => {
                            this._cleanupAllTooltips();
                            this._toggleFavorite(appId);
                        });
                        rightButtonBox.add_child(favoriteButton);
                    }

                    mainBox.add_child(appInfoButton);
                    mainBox.add_child(rightButtonBox);

                    appHeader.add_child(mainBox);
                    this.menu.addMenuItem(appHeader);

                    for (const metaWindow of group.windows) {
                        const item = new PopupMenu.PopupBaseMenuItem({
                            reactive: true,
                            style_class: 'popup-menu-item'
                        });
                        item.actor.style = 'padding-left: 38px;';

                        const contentBox = new St.BoxLayout({
                            x_expand: true,
                            y_align: Clutter.ActorAlign.CENTER
                        });
                        item.add_child(contentBox);

                        // Main clickable area (title)
                        const titleBox = new St.BoxLayout({
                            x_expand: true,
                            y_align: Clutter.ActorAlign.CENTER,
                            reactive: true,
                            track_hover: true,
                            style_class: 'window-title-area'
                        });

                        const titleLabel = new St.Label({
                            text: ellipsizedWindowTitle(metaWindow),
                            y_align: Clutter.ActorAlign.CENTER,
                            x_expand: true
                        });
                        titleBox.add_child(titleLabel);

                        // Close button (initially hidden)
                        const closeIcon = new St.Icon({
                            icon_name: 'window-close-symbolic',
                            icon_size: 14,
                            style_class: 'popup-menu-icon',
                            opacity: 0
                        });

                        const closeButton = new St.Button({
                            child: closeIcon,
                            style_class: 'window-close-button',
                            accessible_name: _("Close Window"),
                            style: `
                        padding: 3px 5px; 
                        border-radius: 3px; 
                        margin-left: 4px;
                        min-width: 18px;
                        transition-duration: 150ms;
                        background-color: transparent;
                    `,
                            opacity: 0,
                            reactive: true,
                            track_hover: true
                        });

                        // Add hover effects for smooth appearance
                        const showCloseButton = () => {
                            closeButton.ease({
                                opacity: 255,
                                duration: 150,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD
                            });
                            closeIcon.ease({
                                opacity: 255,
                                duration: 150,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD
                            });
                        };

                        const hideCloseButton = () => {
                            closeButton.ease({
                                opacity: 0,
                                duration: 150,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD
                            });
                            closeIcon.ease({
                                opacity: 0,
                                duration: 150,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD
                            });
                        };

                        // Close button hover effects (red tint)
                        closeButton.connect('enter-event', () => {
                            showCloseButton();
                            closeButton.set_style(`
                        padding: 3px 5px; 
                        border-radius: 3px; 
                        margin-left: 4px;
                        min-width: 18px;
                        transition-duration: 150ms;
                        background-color: rgba(255, 100, 100, 0.2);
                    `);
                            closeIcon.set_style('color: #ff6666;');
                            return Clutter.EVENT_STOP;
                        });

                        closeButton.connect('leave-event', () => {
                            closeButton.set_style(`
                        padding: 3px 5px; 
                        border-radius: 3px; 
                        margin-left: 4px;
                        min-width: 18px;
                        transition-duration: 150ms;
                        background-color: transparent;
                    `);
                            closeIcon.set_style('color: inherit;');
                            return Clutter.EVENT_PROPAGATE;
                        });

                        // Hover events for the entire item
                        item.connect('enter-event', showCloseButton);
                        item.connect('leave-event', hideCloseButton);

                        // Title click activation
                        titleBox.connect('button-press-event', (actor, event) => {
                            if (event.get_button() === 1) {
                                this._cleanupAllTooltips();
                                metaWindow.activate(global.get_current_time());
                                this.menu.close();
                                return Clutter.EVENT_STOP;
                            }
                            return Clutter.EVENT_PROPAGATE;
                        });

                        // Close button functionality
                        closeButton.connect('clicked', (actor, event) => {
                            this._cleanupAllTooltips();
                            metaWindow.delete(global.get_current_time());
                            this.menu.close();
                            return Clutter.EVENT_STOP;
                        });

                        closeButton.connect('enter-event', () => {
                            showCloseButton();
                            closeButton.set_style(`
                        padding: 3px 5px; 
                        border-radius: 3px; 
                        margin-left: 4px;
                        min-width: 18px;
                        transition-duration: 150ms;
                        background-color: rgba(255, 100, 100, 0.2);
                    `);
                            closeIcon.set_style('color: #ff6666;');
                            return Clutter.EVENT_STOP;
                        });

                        contentBox.add_child(titleBox);
                        contentBox.add_child(closeButton);
                        this.menu.addMenuItem(item);
                    }

                    // Add separator line after each group
                    const separator = new PopupMenu.PopupSeparatorMenuItem();
                    separator.actor.set_style(separatorStyle);
                    this.menu.addMenuItem(separator);
                }
            }

            if (this.menu.isEmpty()) {
                this.menu.addMenuItem(new PopupMenu.PopupMenuItem(_("No open windows or favorites"), { reactive: false }));
            }
        }

        _toggleFavorite(appId) {
            let favorites = this._settings.get_strv('favorite-apps');
            if (favorites.includes(appId)) {
                favorites.splice(favorites.indexOf(appId), 1);
            } else {
                favorites.push(appId);
            }
            this._settings.set_strv('favorite-apps', favorites);
        }

        destroy() {
            // すべてのツールチップをクリーンアップ
            this._cleanupAllTooltips();

            if (this._menuClosedId) {
                this.menu.disconnect(this._menuClosedId);
                this._menuClosedId = null;
            }

            if (this._settings && this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settings = null;
            }
            if (this._updatedConnection) {
                this._model.disconnect(this._updatedConnection);
                this._updatedConnection = null;
            }
            super.destroy();
        }
    });
// --- Helper functions ---
function ellipsizeString(s, l) { if (s.length > l) return s.substring(0, l) + '...'; return s; }
function ellipsizedWindowTitle(metaWindow) { return ellipsizeString(metaWindow.get_title() || "-", 100); }
function isAppLaunchable(app) {
    if (!app) return false;
    const appId = app.get_id();
    if (!appId) return false;
    try {
        const systemApp = Shell.AppSystem.get_default().lookup_app(appId);
        if (!systemApp) return false;
        const appInfo = systemApp.get_app_info();
        if (!appInfo) return false;
        return appInfo.should_show();
    } catch (e) {
        console.error(`[AllWindows] Error checking if app is launchable: ${e}`);
        return false;
    }
}


// --- Main extension ---
export default class AllWindowsExtension extends Extension {
    _settings;
    _model;
    _appMenuButton;
    _windowIconList;
    _settingsChangedId;
    _startupCompleteId;

    enable() {
        this._initMembers();

        this._settings = this.getSettings();
        const indicatorPos = this._settings.get_string('indicator-position');
        const dateMenuPos = this._settings.get_string('date-menu-position');

        this._initUI();
        this._addIndicatorsToPanel(indicatorPos);
        this._moveDateMenu(dateMenuPos);
        this._applyOverviewSetting();
        this._connectSettingsChanges();
    }

    disable() {
        this._moveDateMenu('center');
        this._destroyUI();
        this._disconnectSettingsChanges();
        this._initMembers();
    }

    _initMembers() {
        this._settings = null;
        this._model = null;
        this._appMenuButton = null;
        this._windowIconList = null;
        this._settingsChangedId = null;
        this._startupCompleteId = null;
    }

    _initUI() {
        this._model = new WindowModel();
        this._appMenuButton = new AppMenuButton({ model: this._model, extension: this });
        this._windowIconList = new WindowIconList({ model: this._model, iconSize: 24 });
    }

    _addIndicatorsToPanel(position) {
        Main.panel.addToStatusArea(this.uuid + '-AppMenuButton', this._appMenuButton, 0, position);
        Main.panel.addToStatusArea(this.uuid + '-WindowIconList', this._windowIconList.wrapperButton, 1, position);
    }

    _destroyUI() {
        if (this._appMenuButton) this._appMenuButton.destroy();
        if (this._windowIconList) this._windowIconList.destroy();
        if (this._model) this._model.destroy();
    }

    _moveDateMenu(position) {
        const panel = Main.panel;
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (!dateMenu) return;

        // Remove the clock from the current parent
        if (dateMenu.container.get_parent()) {
            dateMenu.container.get_parent().remove_child(dateMenu.container);
        }

        switch (position) {
            case 'left':
                panel._leftBox.insert_child_at_index(dateMenu.container, 0);
                break;

            case 'right':
                const rightBoxChildren = panel._rightBox.get_children();

                if (rightBoxChildren.length > 0) {
                    panel._rightBox.insert_child_below(dateMenu.container, rightBoxChildren[rightBoxChildren.length - 1]);
                } else {
                    panel._rightBox.add_child(dateMenu.container);
                }
                break;

            case 'center':
            default:
                panel._centerBox.insert_child_at_index(dateMenu.container, 0);
                break;
        }
    }
    _applyOverviewSetting() {
        if (!this._settings.get_boolean('show-overview-at-startup') && Main.layoutManager._startingUp) {
            this._startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
                Main.overview.hide();
                if (this._startupCompleteId) {
                    Main.layoutManager.disconnect(this._startupCompleteId);
                }
            });
        }
    }

    _connectSettingsChanges() {
        this._settingsChangedId = this._settings.connect('changed', () => this._restart());
    }

    _disconnectSettingsChanges() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
        }
        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
        }
    }

    _restart() {
        this.disable();
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.enable();
            return GLib.SOURCE_REMOVE;
        });
    }
}