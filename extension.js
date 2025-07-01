import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
// Extensionクラスは継承しないため、インポートは不要
// import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Timeline, Now, createResource } from './timeline.js';

const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

function manageDynamicMenuItems(menu) {
    const initialItems = [{ id: 1, text: 'Static Item' }];
    const menuItemsData = Timeline(initialItems);

    menuItemsData.using(itemsData => {
        log(`USING: Data changed. Building UI for ${itemsData.length} items.`);
        const menuItems = itemsData.map(itemData => {
            const menuItem = new PopupMenu.PopupMenuItem(`[${itemData.id}] ${itemData.text}`);
            log(`  [+] Creating menu item for ID ${itemData.id}`);
            return menuItem;
        });
        menuItems.forEach(item => menu.addMenuItem(item));
        return createResource(menuItems, () => {
            log(`USING: Cleanup triggered. Destroying ${menuItems.length} items.`);
            menuItems.forEach(item => {
                item.destroy();
                log(`  [-] Destroyed a menu item.`);
            });
        });
    });

    let shouldAdd = true;
    let nextId = 2;
    const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        const currentItems = menuItemsData.at(Now);
        let newItems;
        if (shouldAdd) {
            log(`DEMO: --> Adding item ID ${nextId}...`);
            newItems = [...currentItems, { id: nextId, text: `Dynamic ${nextId}` }];
        } else {
            log(`DEMO: <-- Removing item ID ${nextId - 1}...`);
            newItems = currentItems.filter(item => item.id !== nextId - 1);
        }
        menuItemsData.define(Now, newItems);
        if (shouldAdd) { nextId++; }
        shouldAdd = !shouldAdd;
        return GLib.SOURCE_CONTINUE;
    });
    return timerId;
}

// ★★★★★ 核心部分 ★★★★★
// `class`ではなく、`function`をコンストラクタとしてエクスポートする
export default function AIOValidatorExtension(metadata) {
    // --- `this`を一切使わない、純粋なFPスタイルの実装をコンストラクタスコープ内に閉じる ---
    let panelMenuButton = null;
    let timerId = null;
    const lifecycle = Timeline(false);
    // `this.uuid` の代わりに `metadata.uuid` を使用
    const uuid = metadata.uuid;

    // 1. 最外殻のブリッジ
    lifecycle
        .distinctUntilChanged()
        .map(isEnabled => {
            if (isEnabled) {
                if (panelMenuButton === null) {
                    log('BRIDGE: Creating top-level UI...');
                    panelMenuButton = new PanelMenu.Button(0.5, 'FP Menu Button');
                    const icon = new St.Icon({
                        icon_name: 'system-run-symbolic',
                        style_class: 'system-status-icon',
                    });
                    panelMenuButton.add_child(icon);
                    Main.panel.addToStatusArea(uuid, panelMenuButton); // uuidを使用
                    log('BRIDGE: Top-level UI created.');
                    timerId = manageDynamicMenuItems(panelMenuButton.menu);
                }
            } else {
                if (panelMenuButton !== null) {
                    log('BRIDGE: Destroying top-level UI...');
                    if (timerId) {
                        GLib.source_remove(timerId);
                        timerId = null;
                        log('DEMO: Recurring timer stopped.');
                    }
                    panelMenuButton.destroy();
                    panelMenuButton = null;
                    log('BRIDGE: Top-level UI destroyed.');
                }
            }
        });

    // 2. `this`に依存しない、ロジック本体となる関数を定義
    const enableLogic = () => lifecycle.define(Now, true);
    const disableLogic = () => lifecycle.define(Now, false);

    // 3. `new`によって生成されるインスタンス(`this`)に、メソッドをアタッチする
    //    これは、外部のOOPシステムと我々のFPコアを接続するための、唯一の接点（アダプタ）である。
    this.enable = enableLogic;
    this.disable = disableLogic;
}