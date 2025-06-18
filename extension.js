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

// --- View 2 (WindowIconList) ---
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
            this._redraw();
        }
        _redraw() {
            this.container.destroy_all_children();
            const sortedApps = this._model.getData();
            for (const group of sortedApps) {
                for (const win of group.windows) {
                    const button = this._createIconButton(group.app, win);
                    this.container.add_child(button);
                }
            }
        }
        _createIconButton(app, metaWindow) {
            const icon = new St.Icon({ gicon: app.get_icon(), icon_size: this._iconSize });
            const button = new St.Button({ child: icon, style_class: 'panel-button', track_hover: true, reactive: true });
            button.connect('clicked', () => { metaWindow.activate(global.get_current_time()); });
            return button;
        }
        destroy() {
            if (this._updatedConnection) this._model.disconnect(this._updatedConnection);
            this.wrapperButton.destroy();
        }
    });

// --- View 1 (AppMenuButton) ---
const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init(params) {
            super._init(0.0, 'All Windows Menu');
            this._model = params.model;
            this._extension = params.extension;

            this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            this._settingsChangedId = this._settings.connect('changed::favorite-apps', () => this._redraw());

            this.add_child(new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'system-status-icon' }));
            this.menu.actor.add_style_class_name('compact-window-list');

            this._updatedConnection = this._model.connect('updated', () => this._redraw());
            this._redraw();
        }

        _redraw() {
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
                    const button = new St.Button({ child: icon, style_class: 'popup-menu-item', track_hover: true, can_focus: true, accessible_name: app.get_name() });

                    const normalStyle = 'background-color: transparent; padding: 4px; border-radius: 4px;';
                    const hoverStyle = 'background-color: rgba(255, 255, 255, 0.1); padding: 4px; border-radius: 4px;';
                    button.set_style(normalStyle);

                    button.connect('enter-event', () => button.set_style(hoverStyle));
                    button.connect('leave-event', () => button.set_style(normalStyle));
                    button.connect('clicked', () => {
                        app.activate();
                        this.menu.close();
                    });
                    favoritesBox.add_child(button);
                }

                const settingsIcon = new St.Icon({ icon_name: 'preferences-system-symbolic', icon_size: 16, style_class: 'popup-menu-icon' });
                const settingsButton = new St.Button({ child: settingsIcon, style_class: 'popup-menu-item', accessible_name: _("Settings"), style: 'padding: 4px; border-radius: 4px;' });
                settingsButton.connect('clicked', () => {
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
                        group.windows.forEach(metaWindow => metaWindow.activate(global.get_current_time()));
                        this.menu.close();
                    });

                    const rightButtonBox = new St.BoxLayout({ style: 'spacing: 4px;' });

                    // isAppLaunchableのチェックを統合
                    if (isAppLaunchable(group.app)) {
                        const favoriteIconName = isFavorite ? 'starred-symbolic' : 'non-starred-symbolic';
                        const favoriteTooltip = isFavorite ? _("Remove from favorites") : _("Add to favorites");
                        const favoriteIcon = new St.Icon({ icon_name: favoriteIconName, icon_size: 16, style_class: 'popup-menu-icon' });
                        const favoriteButton = new St.Button({ child: favoriteIcon, style_class: 'popup-menu-item', accessible_name: favoriteTooltip, style: 'padding: 4px; border-radius: 4px;' });
                        favoriteButton.connect('clicked', () => { this._toggleFavorite(appId); });
                        rightButtonBox.add_child(favoriteButton);
                    }

                    mainBox.add_child(appInfoButton);
                    mainBox.add_child(rightButtonBox);

                    appHeader.add_child(mainBox);
                    this.menu.addMenuItem(appHeader);

                    for (const metaWindow of group.windows) {
                        const item = new PopupMenu.PopupMenuItem(ellipsizedWindowTitle(metaWindow));
                        item.actor.style = 'padding-left: 38px;';
                        item.connect('activate', () => metaWindow.activate(global.get_current_time()));
                        this.menu.addMenuItem(item);
                    }

                    // Add separator line after each group (also added after the last group, but it's acceptable)
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