import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Timeline, Now, createResource } from './timeline.js';

import { AppMenuButton } from './component/AppMenuButton.js';
import { manageFavorites } from './component/ui0/manageFavorites.js';
import { manageDynamicItems } from './component/ui1/manageDynamicItems.js';

const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

// =====================================================================
// === メイン拡張ロジック（リファレンス準拠の簡潔版）===
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

            log('Creating extension with proven key capture structure...');

            // ★ 成功要因: キーイベントの中央管理Timeline
            const keyPressTimeline = Timeline(null);

            // ★ 成功要因: 外部Timeline注入パターン
            const appMenuButton = new AppMenuButton({
                keyPressTimeline: keyPressTimeline,
            });

            // パネルに追加
            Main.panel.addToStatusArea('aio-validator-minimal', appMenuButton, 0, 'center');

            // パネルアイコン状態管理
            panelIcon = appMenuButton._panelIcon;
            appMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
                panelIcon.set_style(isOpen ? 'background-color: blue;' : 'background-color: red;');
            });

            // 外部モジュールとの連携
            const favoritesManager = manageFavorites(
                appMenuButton.getFavoritesContainer(),
                keyPressTimeline
            );

            const dynamicItemsManager = manageDynamicItems(
                appMenuButton.getDynamicItemsContainer()
            );

            log('Extension created successfully.');

            // クリーンアップ
            const cleanup = () => {
                log('Destroying extension...');
                favoritesManager.dispose();
                dynamicItemsManager.dispose();
                appMenuButton.destroy();
                panelIcon = null;
                log('Extension destroyed.');
            };

            return createResource(appMenuButton, cleanup);
        });

    // 標準extension interface
    this.enable = () => {
        lifecycleTimeline.define(Now, true);
    };

    this.disable = () => {
        lifecycleTimeline.define(Now, false);
    };
}