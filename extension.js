import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// 同じディレクトリにあるtimeline.jsからTimelineライブラリをインポート
import { Timeline, Now } from './timeline.js';

// =====================================================================
// 【UIベースコード】からの忠実な移植セクション
// =====================================================================

const NonClosingPopupBaseMenuItem = GObject.registerClass({
    Signals: {
        'custom-activate': {},
    },
}, class NonClosingPopupBaseMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(params) {
        super._init(params);
        this.activate = (event) => {
            this.emit('custom-activate');
            return false;
        };
    }
});

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
            const groupedByApp = new Map();
            for (const metaWindow of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
                if (metaWindow.is_skip_taskbar()) continue;
                const app = this._windowTracker.get_window_app(metaWindow);
                if (!app) continue;
                const signalId = metaWindow.connect('notify::title', () => this.update());
                this._signalIds.set(metaWindow, signalId);
                const appId = app.get_id();
                if (!groupedByApp.has(appId)) groupedByApp.set(appId, { app, windows: [] });
                groupedByApp.get(appId).windows.push(metaWindow);
            }
            this.windowsTimeline.define(Now, Array.from(groupedByApp.values()));
        }

        _disconnectWindowSignals() {
            for (const [win, id] of this._signalIds) {
                try { if (win && !win.is_destroyed) win.disconnect(id); } catch (e) { /* ignore */ }
            }
            this._signalIds.clear();
        }

        destroy() {
            if (this._trackerChangedId) {
                this._windowTracker.disconnect(this._trackerChangedId);
                this._trackerChangedId = null;
            }
            this._disconnectWindowSignals();

            // ▼▼▼ エラー修正箇所 ▼▼▼
            // 親クラスのGObject.Objectはdestroy()を持たないため、この行を削除。
            // super.destroy(); 
            // ▲▲▲ エラー修正箇所 ▲▲▲
        }
    });


// =====================================================================
// TimelineアーキテクチャとUIの結合セクション
// =====================================================================

const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'Timeline Window List Menu');
            this.add_child(new St.Icon({
                icon_name: 'face-smile-symbolic',
                style_class: 'system-status-icon',
            }));
            this._windowItems = [];
        }

        redraw(windowGroups) {
            this._windowItems.forEach(item => item.destroy());
            this._windowItems = [];

            if (windowGroups.length === 0) {
                const placeholder = new PopupMenu.PopupMenuItem('No open windows');
                this.menu.addMenuItem(placeholder);
                this._windowItems.push(placeholder);
                return;
            }

            for (const group of windowGroups) {
                const headerItem = new NonClosingPopupBaseMenuItem({ reactive: true, can_focus: true });
                const hbox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
                hbox.add_child(new St.Icon({ gicon: group.app.get_icon(), style_class: 'popup-menu-icon' }));
                hbox.add_child(new St.Label({ text: group.app.get_name() }));
                headerItem.add_child(hbox);

                headerItem.connect('custom-activate', () => {
                    group.windows.forEach(win => win.activate(global.get_current_time()));
                });

                this.menu.addMenuItem(headerItem);
                this._windowItems.push(headerItem);

                for (const win of group.windows) {
                    const windowItem = new NonClosingPopupBaseMenuItem({ reactive: true, can_focus: true });
                    const windowLabel = new St.Label({ text: win.get_title() || '...' });
                    windowLabel.style = 'padding-left: 20px;';
                    windowItem.add_child(windowLabel);

                    windowItem.connect('custom-activate', () => {
                        win.activate(global.get_current_time());
                    });

                    this.menu.addMenuItem(windowItem);
                    this._windowItems.push(windowItem);
                }
            }
        }

        destroy() {
            this._windowItems.forEach(item => item.destroy());
            this._windowItems = [];
            super.destroy();
        }
    });


export default class MinimalTimelineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._appMenuButton = null;
        this._windowModel = null;
        this._lifecycleTimeline = null;
    }

    enable() {
        this._lifecycleTimeline = Timeline(true);

        this._lifecycleTimeline.bind(isEnabled => {
            if (isEnabled) {
                this._windowModel = new WindowModel();
                this._appMenuButton = new AppMenuButton();
                Main.panel.addToStatusArea(this.uuid, this._appMenuButton);

                const uiUpdateConnection = this._windowModel.windowsTimeline.map(
                    groups => {
                        if (this._appMenuButton && !this._appMenuButton.is_destroyed) {
                            this._appMenuButton.redraw(groups);
                        }
                    }
                );
            } else {
                this._appMenuButton?.destroy();
                this._appMenuButton = null;
                this._windowModel?.destroy();
                this._windowModel = null;
            }

            return Timeline(null);
        });
    }

    disable() {
        this._lifecycleTimeline?.define(Now, false);
        this._lifecycleTimeline = null;
        this._appMenuButton = null;
        this._windowModel = null;
    }
}