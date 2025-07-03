// extension.js

import St from 'gi://St';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GObject from 'gi://GObject';

import { Timeline, Now, createResource, combineLatestWith } from './timeline.js';
import { createWindowModelManager } from './component/WMManager.js';
import { createWindowListManager } from './component/WindowListManager.js';
import { createFavoritesManager } from './component/FavoritesManager.js';

const log = (message) => { console.log(`[AIO-Validator] ${message}`); };

const NonClosingPopupBaseMenuItem = GObject.registerClass({
    Signals: { 'custom-activate': {}, 'custom-close': {} },
}, class NonClosingPopupBaseMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(params) { super._init(params); }
    activate(event) { this.emit('custom-activate'); }
    vfunc_button_press_event(buttonEvent) {
        if (buttonEvent.get_button() === 1) { this.activate(buttonEvent); return Clutter.EVENT_STOP; }
        return Clutter.EVENT_PROPAGATE;
    }
});

function createDataSource(schema, key, getter) {
    const settings = new Gio.Settings({ schema_id: schema });
    const timeline = Timeline(getter(settings, key));
    const connectionId = settings.connect(`changed::${key}`, () => {
        timeline.define(Now, getter(settings, key));
    });
    const destroy = () => {
        if (settings && connectionId) {
            try { settings.disconnect(connectionId); } catch (e) {}
        }
    };
    return { timeline, destroy };
}

export default class AIOValidatorExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._lifecycleTimeline = Timeline(false);
        this._mainSubscription = null;
    }

    enable() {
        log('Extension enabling...');
        if (!this._mainSubscription) {
            this._mainSubscription = this._lifecycleTimeline.distinctUntilChanged().using(isEnabled => {
                if (!isEnabled) {
                    log('BRIDGE: Lifecycle ended. Cleanup will be triggered.');
                    return null;
                }
                log('BRIDGE: Lifecycle enabled. Starting setup...');

                const disposables = [];

                const panelMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
                panelMenuButton.add_child(new St.Icon({ icon_name: 'view-app-grid-symbolic' }));
                panelMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
                    if (isOpen) menu.actor.grab_key_focus();
                });
                const indicatorRole = `${this.uuid}-Indicator`;
                Main.panel.addToStatusArea(indicatorRole, panelMenuButton);
                log('BRIDGE: Top-level UI created.');

                const favoritesContainer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                const separator = new PopupMenu.PopupSeparatorMenuItem();
                const windowListContainer = new St.BoxLayout({ vertical: true, style_class: 'aio-window-list-container' });
                panelMenuButton.menu.addMenuItem(favoritesContainer);
                panelMenuButton.menu.addMenuItem(separator);
                panelMenuButton.menu.box.add_child(windowListContainer);

                const settings = this.getSettings();
                const favsDataSource = createDataSource('org.gnome.shell', 'favorite-apps', (s, k) => s.get_strv(k));
                disposables.push(favsDataSource);
                const showOverviewDataSource = createDataSource(this.metadata['get-settings-schema'](), 'show-overview-button', (s, k) => s.get_boolean(k));
                disposables.push(showOverviewDataSource);

                const wmManager = createWindowModelManager();
                disposables.push(wmManager);
                const favsManager = createFavoritesManager(favsDataSource.timeline, showOverviewDataSource.timeline);
                disposables.push(favsManager);
                const winListManager = createWindowListManager(wmManager.windowsTimeline, favsDataSource.timeline);
                disposables.push(winListManager);

                const favsSubscription = favsManager.favoritesData.using(data => {
                    favoritesContainer.destroy_all_children();
                    const box = new St.BoxLayout({ style_class: 'aio-favorites-bar-container' });
                    favoritesContainer.add_child(box);
                    const group = new St.BoxLayout({ style_class: 'aio-favorites-group' });
                    box.add_child(group);

                    data.forEach(itemData => {
                        if (itemData.type === 'overview') {
                            const button = new St.Button({ child: new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'aio-favorite-icon' }), style_class: 'aio-favorite-button' });
                            button.connect('clicked', () => {
                                Main.overview.show();
                                panelMenuButton.menu.close();
                            });
                            group.add_child(button);
                            group.add_child(new St.Widget({ style_class: 'aio-favorites-separator' }));
                        } else if (itemData.type === 'favorite') {
                            const button = new St.Button({ child: new St.Icon({ gicon: itemData.gicon, style_class: 'aio-favorite-icon' }), style_class: 'aio-favorite-button' });
                            button._appId = itemData.appId;
                            button.connect('clicked', () => {
                                favsManager.selectedFavoriteIdTimeline.define(Now, itemData.appId);
                                favsManager.handleFavLaunch();
                            });
                            button.connect('enter-event', () => favsManager.selectedFavoriteIdTimeline.define(Now, itemData.appId));
                            group.add_child(button);
                        }
                    });
                    return createResource(box, () => {});
                });
                disposables.push({destroy: () => favsSubscription.destroy()});

                const selectionSubscription = favsManager.selectedFavoriteIdTimeline.map(selectedId => {
                    if (!favoritesContainer.get_first_child()) return;
                    const group = favoritesContainer.get_first_child().get_first_child();
                    if (!group) return;
                    group.get_children().forEach(button => {
                        button.remove_style_class_name('selected');
                        if (button._appId === selectedId) button.add_style_class_name('selected');
                    });
                });
                disposables.push({destroy: () => selectionSubscription.destroy()});

                const winListSubscription = winListManager.windowListData.using(data => {
                    windowListContainer.destroy_all_children();
                    data.forEach(itemData => {
                        if (itemData.type === 'no-windows') {
                            windowListContainer.add_child(new PopupMenu.PopupMenuItem(itemData.text, { reactive: false }));
                        } else if (itemData.type === 'group-header') {
                            const headerItem = new NonClosingPopupBaseMenuItem({ reactive: true, can_focus: true, style_class: 'aio-window-list-item aio-window-list-group-header' });
                            const hbox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
                            headerItem.add_child(hbox);
                            hbox.add_child(new St.Icon({ gicon: itemData.gicon, icon_size: 20 }));
                            hbox.add_child(new St.Label({ text: itemData.name, y_align: Clutter.ActorAlign.CENTER }));
                            hbox.add_child(new St.Widget({ x_expand: true }));
                            const closeBtn = new St.Button({ child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                            closeBtn.connect('clicked', () => headerItem.emit('custom-close'));
                            headerItem.connect('custom-close', () => itemData.app.get_windows().forEach(w => w.delete(global.get_current_time())));
                            headerItem.connect('custom-activate', () => itemData.app.activate());
                            hbox.add_child(closeBtn);
                            windowListContainer.add_child(headerItem);
                        } else if (itemData.type === 'window-item') {
                            const windowItem = new NonClosingPopupBaseMenuItem({ reactive: true, can_focus: true, style_class: 'aio-window-list-item aio-window-list-window-item' });
                            const hbox = new St.BoxLayout({ x_expand: true });
                            windowItem.add_child(hbox);
                            hbox.add_child(new St.Label({ text: itemData.title }));
                            hbox.add_child(new St.Widget({ x_expand: true }));
                            const closeBtn = new St.Button({ child: new St.Icon({ icon_name: 'window-close-symbolic' }) });
                            closeBtn.connect('clicked', () => windowItem.emit('custom-close'));
                            windowItem.connect('custom-close', () => itemData.metaWindow.delete(global.get_current_time()));
                            windowItem.connect('custom-activate', () => Main.activateWindow(itemData.metaWindow));
                            hbox.add_child(closeBtn);
                            windowListContainer.add_child(windowItem);
                        }
                    });
                    return createResource(windowListContainer, () => {});
                });
                disposables.push({destroy: () => winListSubscription.destroy()});

                const keyPressHandlerId = panelMenuButton.menu.actor.connect('key-press-event', (actor, event) => {
                    const symbol = event.get_key_symbol();
                    if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                        const favs = favsDataSource.timeline.at(Now);
                        if (favs.length > 0) {
                            const currentId = favsManager.selectedFavoriteIdTimeline.at(Now);
                            let currentIndex = favs.indexOf(currentId);
                            if (currentIndex === -1) currentIndex = 0;
                            const direction = (symbol === Clutter.KEY_Left) ? -1 : 1;
                            const newIndex = (currentIndex + direction + favs.length) % favs.length;
                            favsManager.selectedFavoriteIdTimeline.define(Now, favs[newIndex]);
                        }
                        return Clutter.EVENT_STOP;
                    }
                    if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                        favsManager.handleFavLaunch();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
                
                const launchSubscription = favsManager.launchAppTimeline.map(appId => {
                    if (appId) {
                        log(`BRIDGE: Launching app: ${appId}`);
                        const app = Shell.AppSystem.get_default().lookup_app(appId);
                        if (app) app.activate();
                    }
                });
                disposables.push({destroy: () => launchSubscription.destroy()});

                const cleanup = () => {
                    log('BRIDGE: Destroying top-level UI and all managers...');
                    if (panelMenuButton.menu.actor && !panelMenuButton.menu.actor.is_destroyed && keyPressHandlerId) {
                        try { panelMenuButton.menu.actor.disconnect(keyPressHandlerId); } catch (e) {}
                    }
                    disposables.reverse().forEach(d => {
                        if (d && typeof d.destroy === 'function') {
                            try { d.destroy(); } catch(e) {}
                        }
                    });
                    panelMenuButton.destroy();
                    log('BRIDGE: Top-level UI and all managers destroyed.');
                };
                return createResource(panelMenuButton, cleanup);
            });
        }
        this._lifecycleTimeline.define(Now, true);
    }

    disable() {
        this._lifecycleTimeline?.define(Now, false);
        log('Extension disabling...');
    }
}
