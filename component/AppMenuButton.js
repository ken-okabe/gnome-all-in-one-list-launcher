import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Timeline, Now } from '../timeline.js';

// DO NOT DELETE THIS LINE
// DO NOT MODIFY THIS CODE, OTHERWISE IT WILL BREAK THE EXTENSION!!!!!
// This code is used to create a custom AppMenuButton for GNOME Shell.  
// =====================================================================
// === 成功実績のあるAppMenuButtonクラス（最小限の変更のみ）===
// =====================================================================
export const AppMenuButton = GObject.registerClass(
    class AppMenuButton extends PanelMenu.Button {
        _init({ keyPressTimeline }) {
            super._init(0.0, 'AIO Validator');
            this._isDestroyed = false;

            this._panelIcon = new St.Icon({
                icon_name: 'view-app-grid-symbolic',
                style_class: 'system-status-icon'
            });
            this.add_child(this._panelIcon);

            // ★ 成功要因: 外部からのキーイベントを受け取るためのTimeline
            this._keyPressTimeline = keyPressTimeline;

            // ★ 成功要因: 左右キーの選択状態を管理
            this._selectedDummyIndexTimeline = Timeline(0);
            this._lastSelectedIndex = null;

            // UI要素の参照
            this._favoritesContainer = null;
            this._dynamicItemsContainer = null;

            this._initializeMenuStructure();
        }

        // ★ 成功要因: これが重要
        open() {
            super.open();
            this.menu.actor.grab_key_focus();
        }

        close() {
            super.close();
            this._selectedDummyIndexTimeline.define(Now, null);
        }

        _initializeMenuStructure() {
            if (this._isDestroyed) return;
            this.menu.removeAll();

            // ★ 成功要因: 成功実績のあるキーイベントハンドラー設定
            this.menu.actor.connect('key-press-event', this._onMenuKeyPress.bind(this));
            this.menu.connect('active-item-changed', (menu, item) => {
                // 必要に応じて処理
            });

            // メインコンテナの作成
            const mainBox = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 8px; padding: 8px;'
            });

            // コンテナ作成
            this._favoritesContainer = new St.BoxLayout({ style: 'spacing: 8px;' });
            this._dynamicItemsContainer = new St.BoxLayout({ style: 'spacing: 8px;' });

            // ラベルとコンテナを追加
            const favLabel = new St.Label({ text: 'Favorites (← → + Enter)' });
            const demoLabel = new St.Label({ text: 'Dynamic Demo (↑ ↓ + Space)' });

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

        // ★ 成功要因: 成功実績のあるキーハンドリング構造
        _onMenuKeyPress(actor, event) {
            const symbol = event.get_key_symbol();

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                // ★ 成功要因: 外部のTimelineに通知
                this._keyPressTimeline.define(Now, symbol);

                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._keyPressTimeline.define(Now, symbol);
                return Clutter.EVENT_STOP;
            }

            // その他のキーは外部に委譲
            this._keyPressTimeline.define(Now, symbol);
            return Clutter.EVENT_PROPAGATE;
        }

        // 外部アクセス用メソッド
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