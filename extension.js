import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Timeline, Now, createResource } from './timeline.js';
import { manageFavorites } from './component/ui0/manageFavorites.js';
import { manageDynamicItems } from './component/ui1/manageDynamicItems.js';

const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

// =====================================================================
// === 成功実績のあるAppMenuButtonクラス（キーキャプチャの核心部分）===
// =====================================================================
const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init({ keyPressTimeline }) {
            super._init(0.0, 'AIO Validator');
            this._isDestroyed = false;

            this._panelIcon = new St.Icon({ 
                icon_name: 'view-app-grid-symbolic', 
                style_class: 'system-status-icon' 
            });
            this.add_child(this._panelIcon);

            // 外部からのキーイベントを受け取るためのTimeline
            this._keyPressTimeline = keyPressTimeline;

            // 左右キーの選択状態を管理（成功実績のある構造を保持）
            this._selectedDummyIndexTimeline = Timeline(0);
            this._lastSelectedIndex = null;

            // UI要素の参照
            this._favoritesContainer = null;
            this._dynamicItemsContainer = null;

            this._initializeMenuStructure();
            this._setupKeyHandling();
        }

        // ★★★ 成功実績のある構造を完全保持 ★★★
        open() {
            super.open();
            this.menu.actor.grab_key_focus(); // これが重要
        }

        close() {
            super.close();
            this._selectedDummyIndexTimeline.define(Now, null);
        }

        _initializeMenuStructure() {
            if (this._isDestroyed) return;
            this.menu.removeAll();
            
            // ★★★ 成功実績のあるキーイベントハンドラー設定を完全保持 ★★★
            this.menu.actor.connect('key-press-event', this._onMenuKeyPress.bind(this));
            this.menu.connect('active-item-changed', (menu, item) => {
                // 必要に応じて処理
            });

            // メインコンテナの作成
            const mainBox = new St.BoxLayout({ 
                vertical: true, 
                style: 'spacing: 8px; padding: 8px;' 
            });
            
            // Favoritesセクションのコンテナ
            this._favoritesContainer = new St.BoxLayout({ 
                style: 'spacing: 8px;' 
            });
            
            // Dynamic Itemsセクションのコンテナ
            this._dynamicItemsContainer = new St.BoxLayout({ 
                style: 'spacing: 8px;' 
            });

            // ラベルとコンテナを追加
            const favLabel = new St.Label({ text: 'Favorites (← → + Enter)' });
            const demoLabel = new St.Label({ text: 'Focusable List Demo (↑ ↓ + Space)' });
            
            mainBox.add_child(favLabel);
            mainBox.add_child(this._favoritesContainer);
            mainBox.add_child(demoLabel);
            mainBox.add_child(this._dynamicItemsContainer);

            // メインボックスをメニューに追加
            const mainMenuItem = new PopupMenu.PopupBaseMenuItem({ 
                reactive: false, 
                can_focus: false 
            });
            mainMenuItem.add_child(mainBox);
            this.menu.addMenuItem(mainMenuItem);
        }

        // ★★★ 成功実績のあるキーハンドリング構造を完全保持 ★★★
        _onMenuKeyPress(actor, event) {
            const symbol = event.get_key_symbol();
            
            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                // 左右キーの処理（成功実績のある構造）
                const DUMMY_ITEM_COUNT = 7; // Favoritesの数
                let currentIndex = this._selectedDummyIndexTimeline.at(Now) ?? 0;
                
                const direction = (symbol === Clutter.KEY_Left) ? -1 : 1;
                const newIndex = (currentIndex + direction + DUMMY_ITEM_COUNT) % DUMMY_ITEM_COUNT;
                
                this._selectedDummyIndexTimeline.define(Now, newIndex);
                
                // 外部のFavoritesマネージャーにもキーイベントを通知
                this._keyPressTimeline.define(Now, symbol);
                
                return Clutter.EVENT_STOP;
            }
            
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                // Enterキーの処理
                this._keyPressTimeline.define(Now, symbol);
                return Clutter.EVENT_STOP;
            }
            
            // その他のキー（↑↓など）は外部に委譲
            this._keyPressTimeline.define(Now, symbol);
            return Clutter.EVENT_PROPAGATE;
        }

        _setupKeyHandling() {
            // 選択状態の変更を監視（成功実績のある構造を保持）
            this._selectedDummyIndexTimeline.map(selectedIndex => {
                if (this._isDestroyed) return;
                this._updateSelection(selectedIndex);
            });
        }

        _updateSelection(newSelectedIndex) {
            // 選択状態の更新（今後Favoritesマネージャーと連携）
            this._lastSelectedIndex = newSelectedIndex;
        }

        // 外部からコンテナを取得するためのメソッド
        getFavoritesContainer() {
            return this._favoritesContainer;
        }

        getDynamicItemsContainer() {
            return this._dynamicItemsContainer;
        }

        destroy() {
            if (this._isDestroyed) return;
            this._isDestroyed = true;
            super.destroy();
        }
    }
);

// =====================================================================
// === AppMenuButton管理関数（成功実績のある構造パターン）===
// =====================================================================
function manageAppMenuButton(keyPressTimeline) {
    log('APPMENU: Creating AppMenuButton management...');

    // 成功実績のあるAppMenuButtonを作成
    const appMenuButton = new AppMenuButton({
        keyPressTimeline: keyPressTimeline,
    });

    // パネルに追加
    Main.panel.addToStatusArea('aio-validator-hybrid', appMenuButton, 0, 'center');

    log('APPMENU: AppMenuButton created and added to panel.');

    // クリーンアップ関数を返す
    return {
        appMenuButton: appMenuButton,
        dispose: () => {
            log('APPMENU: Disposing AppMenuButton...');
            appMenuButton.destroy();
            log('APPMENU: AppMenuButton disposed.');
        }
    };
}

// =====================================================================
// === メイン拡張ロジック（理想的な構造を保持）===
// =====================================================================
export default function AIOValidatorExtension(metadata) {
    const lifecycleTimeline = Timeline(false);
    let panelIcon = null;

    lifecycleTimeline
        .distinctUntilChanged()
        .using(isEnabled => {
            if (!isEnabled) {
                return null;
            }

            log('BRIDGE: Creating hybrid extension...');

            // キーイベントの中央管理Timeline
            const keyPressTimeline = Timeline(null);

            // 成功実績のあるAppMenuButtonマネージャーを作成
            const appMenuManager = manageAppMenuButton(keyPressTimeline);
            const appMenuButton = appMenuManager.appMenuButton;

            // パネルアイコンの参照を保持
            panelIcon = appMenuButton._panelIcon;

            // メニューの開閉状態を監視
            appMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    panelIcon.set_style('background-color: blue;');
                } else {
                    panelIcon.set_style('background-color: red;');
                }
            });

            // 理想的なモジュール構造でFavoritesを管理
            const favoritesManager = manageFavorites(
                appMenuButton.getFavoritesContainer(), 
                keyPressTimeline
            );

            // 理想的なモジュール構造でDynamicItemsを管理
            const dynamicItemsManager = manageDynamicItems(
                appMenuButton.getDynamicItemsContainer()
            );

            log('BRIDGE: Hybrid extension created successfully.');

            // クリーンアップ関数
            const cleanup = () => {
                log('BRIDGE: Destroying hybrid extension...');
                favoritesManager.dispose();
                dynamicItemsManager.dispose();
                appMenuManager.dispose();
                panelIcon = null;
                log('BRIDGE: Hybrid extension destroyed.');
            };

            return createResource(appMenuButton, cleanup);
        });

    // 標準的なextension interface
    this.enable = () => {
        lifecycleTimeline.define(Now, true);
    };

    this.disable = () => {
        lifecycleTimeline.define(Now, false);
    };
}