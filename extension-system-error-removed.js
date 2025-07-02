import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Timeline, Now, createResource } from './timeline.js';

const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

// =====================================================================
// === フェーズ2：動的な実体（コンテンツ）の管理ロジック ===
// =====================================================================

/**
 * Favorites（お気に入り）の動的リストを管理する
 * @param {St.BoxLayout} container - アイコンが注入される親コンテナ
 * @returns {{dispose: function}} - リアクティブな接続を破棄するためのdispose関数を持つオブジェクト
 */
function manageFavorites(container) {
    const favoritesData = Timeline([
        { id: 'firefox', icon: 'firefox-symbolic' },
        { id: 'terminal', icon: 'utilities-terminal-symbolic' },
    ]);

    const subscription = favoritesData.using(favs => {
        log(`FAV: Building UI for ${favs.length} favorite items.`);
        const icons = favs.map(fav => {
            const icon = new St.Icon({
                icon_name: fav.icon,
                style_class: 'popup-menu-icon',
                icon_size: 32,
            });
            container.add_child(icon);
            return icon;
        });
        return createResource(icons, () => {
            log(`FAV: Destroying ${icons.length} favorite items.`);
            icons.forEach(icon => icon.destroy());
        });
    });

    // ★★★ 修正点1: 明示的にdisposeメソッドを持つオブジェクトを返す ★★★
    return {
        dispose: () => {
            // usingが返すオブジェクトには、内部的にdispose関数がアタッチされている
            if (subscription && typeof subscription.dispose === 'function') {
                subscription.dispose();
            }
        }
    };
}

/**
 * Running Apps（起動中アプリ）の動的リストを管理する
 * @param {St.BoxLayout} container - アイコンが注入される親コンテナ
 * @returns {{dispose: function}} - リアクティブな接続とタイマーを破棄するためのdispose関数を持つオブジェクト
 */
function manageRunningApps(container) {
    const runningAppsData = Timeline([
        { id: 'gedit', icon: 'gedit-symbolic' },
    ]);

    const subscription = runningAppsData.using(apps => {
        log(`RUNNING: Building UI for ${apps.length} running items.`);
        const icons = apps.map(app => {
            const icon = new St.Icon({
                icon_name: app.icon,
                style_class: 'popup-menu-icon',
                icon_size: 24,
            });
            container.add_child(icon);
            return icon;
        });
        return createResource(icons, () => {
            log(`RUNNING: Destroying ${apps.length} running items.`);
            icons.forEach(icon => icon.destroy());
        });
    });

    const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        log('DEMO: Changing running apps data...');
        runningAppsData.define(Now, [
            { id: 'gedit', icon: 'gedit-symbolic' },
            { id: 'nautilus', icon: 'nautilus-symbolic' },
        ]);
        return GLib.SOURCE_REMOVE;
    });

    return {
        dispose: () => {
            if (subscription && typeof subscription.dispose === 'function') {
                subscription.dispose();
            }
            if (timerId > 0 && GLib.Source.remove(timerId)) {
                log('DEMO: Timer removed.');
            }
        }
    };
}


// =====================================================================
// === メインの拡張機能ロジック ===
// =====================================================================

export default function AIOValidatorExtension(metadata) {
    const lifecycle = Timeline(false);
    const uuid = metadata.uuid;

    lifecycle
        .distinctUntilChanged()
        .using(isEnabled => {
            if (!isEnabled) {
                return null;
            }

            log('BRIDGE: Creating top-level UI and static containers...');
            const panelMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
            const icon = new St.Icon({ icon_name: 'view-app-grid-symbolic' });
            panelMenuButton.add_child(icon);

            const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
            panelMenuButton.menu.box.add_child(mainBox);

            const favLabel = new St.Label({ text: 'Favorites' });
            const favBox = new St.BoxLayout({ style: 'spacing: 8px;' });
            mainBox.add_child(favLabel);
            mainBox.add_child(favBox);

            const runningLabel = new St.Label({ text: 'Running' });
            const runningBox = new St.BoxLayout({ style: 'spacing: 8px;' });
            mainBox.add_child(runningLabel);
            mainBox.add_child(runningBox);

            const favsSubscription = manageFavorites(favBox);
            const runningAppsSubscription = manageRunningApps(runningBox);

            Main.panel.addToStatusArea(uuid, panelMenuButton);
            log('BRIDGE: Top-level UI created.');

            const cleanup = () => {
                log('BRIDGE: Destroying top-level UI and all subscriptions...');
                favsSubscription.dispose();
                runningAppsSubscription.dispose();
                panelMenuButton.destroy();
                log('BRIDGE: Top-level UI and subscriptions destroyed.');
            };

            return createResource(panelMenuButton, cleanup);
        });

    this.enable = () => lifecycle.define(Now, true);
    this.disable = () => lifecycle.define(Now, false);
}
