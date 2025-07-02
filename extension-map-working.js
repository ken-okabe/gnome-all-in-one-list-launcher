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
 */
function manageFavorites(container) {
    // データソース：本来はGNOMEのAPIから取得する。ここでは固定のモックデータを使用。
    const favoritesData = Timeline([
        { id: 'firefox', icon: 'firefox-symbolic' },
        { id: 'terminal', icon: 'utilities-terminal-symbolic' },
    ]);

    // usingを使い、データとUIのライフサイクルを完全に同期させる
    favoritesData.using(favs => {
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
}

/**
 * Running Apps（起動中アプリ）の動的リストを管理する
 * @param {St.BoxLayout} container - アイコンが注入される親コンテナ
 */
function manageRunningApps(container) {
    // データソース：本来はウィンドウ監視から取得する。ここでは3秒ごとに変化するモックデータを使用。
    const runningAppsData = Timeline([
        { id: 'gedit', icon: 'gedit-symbolic' },
    ]);

    runningAppsData.using(apps => {
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
            log(`RUNNING: Destroying ${icons.length} running items.`);
            icons.forEach(icon => icon.destroy());
        });
    });

    // デモ用：3秒後にデータを変更し、UIが自動追従することを証明
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        log('DEMO: Changing running apps data...');
        runningAppsData.define(Now, [
            { id: 'gedit', icon: 'gedit-symbolic' },
            { id: 'nautilus', icon: 'nautilus-symbolic' },
        ]);
        return GLib.SOURCE_REMOVE;
    });
}


// =====================================================================
// === メインの拡張機能ロジック ===
// =====================================================================

export default function AIOValidatorExtension(metadata) {
    let panelMenuButton = null;
    const lifecycle = Timeline(false);
    const uuid = metadata.uuid;

    // --- フェーズ1：静的な器（コンテナ）の構築 ---
    // 最外殻のブリッジ。拡張機能の有効/無効と、トップレベルUIの存在を同期させる。
    lifecycle
        .distinctUntilChanged()
        .map(isEnabled => {
            if (isEnabled) {
                if (panelMenuButton === null) {
                    log('BRIDGE: Creating top-level UI and static containers...');

                    // 1. トップレベルのボタンを生成
                    panelMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
                    const icon = new St.Icon({ icon_name: 'view-app-grid-symbolic' });
                    panelMenuButton.add_child(icon);

                    // 2. メインのレイアウトコンテナを生成
                    const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
                    panelMenuButton.menu.box.add_child(mainBox);

                    // 3. Favorites用のコンテナを生成
                    const favLabel = new St.Label({ text: 'Favorites' });
                    const favBox = new St.BoxLayout({ style: 'spacing: 8px;' });
                    mainBox.add_child(favLabel);
                    mainBox.add_child(favBox);

                    // 4. Running Apps用のコンテナを生成
                    const runningLabel = new St.Label({ text: 'Running' });
                    const runningBox = new St.BoxLayout({ style: 'spacing: 8px;' });
                    mainBox.add_child(runningLabel);
                    mainBox.add_child(runningBox);

                    // --- フェーズ2：動的な実体（コンテンツ）の注入 ---
                    // 静的な器の中に、動的なコンテンツ管理ロジックを注入する
                    manageFavorites(favBox);
                    manageRunningApps(runningBox);

                    // 5. トップパネルへ追加
                    Main.panel.addToStatusArea(uuid, panelMenuButton);
                    log('BRIDGE: Top-level UI created.');
                }
            } else {
                if (panelMenuButton !== null) {
                    log('BRIDGE: Destroying top-level UI...');
                    panelMenuButton.destroy();
                    panelMenuButton = null;
                    log('BRIDGE: Top-level UI destroyed.');
                }
            }
        });

    this.enable = () => lifecycle.define(Now, true);
    this.disable = () => lifecycle.define(Now, false);
}