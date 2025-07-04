// import GLib from 'gi://GLib';
// import St from 'gi://St';
// import Clutter from 'gi://Clutter';

// import * as Main from 'resource:///org/gnome/shell/ui/main.js';
// import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// import { Timeline, Now, createResource } from './timeline.js';
// import { manageFavorites } from './component/ui0/manageFavorites.js';
// import { manageDynamicItems } from './component/ui1/manageDynamicItems.js';

// const log = (message) => {
//     console.log(`[AIO-Validator] ${message}`);
// };

// export default function AIOValidatorExtension(metadata) {
//     const lifecycleTimeline = Timeline(false);
//     let panelIcon = null;

//     lifecycleTimeline
//         .distinctUntilChanged()
//         .using(isEnabled => {
//             if (!isEnabled) {
//                 if (panelIcon) {
//                     panelIcon.set_style('background-color: red;');
//                 }
//                 return null;
//             }

//             log('BRIDGE: Creating top-level UI...');
//             const panelMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
//             panelIcon = new St.Icon({ icon_name: 'view-app-grid-symbolic' });
//             panelMenuButton.add_child(panelIcon);
//             panelIcon.set_style('background-color: red;');

//             const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
//             panelMenuButton.menu.box.add_child(mainBox);

//             const favLabel = new St.Label({ text: 'Favorites (← → + Enter)' });
//             const favBox = new St.BoxLayout({ style: 'spacing: 8px;' });
//             mainBox.add_child(favLabel);
//             mainBox.add_child(favBox);

//             const demoLabel = new St.Label({ text: 'Focusable List Demo (↑ ↓ + Space)' });
//             const demoBox = new St.BoxLayout({ style: 'spacing: 8px;' });
//             mainBox.add_child(demoLabel);
//             mainBox.add_child(demoBox);

//             const keyPressTimeline = Timeline(null);

//             panelMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
//                 if (isOpen) {
//                     panelIcon.set_style('background-color: blue;');
//                 } else {
//                     panelIcon.set_style('background-color: red;');
//                 }
//             });
//             // メニューボタン自体でキーイベントを捕捉
//             // Left/Right のみ global.stage で処理（条件付き）
//             global.stage.connect('key-press-event', (actor, event) => {
//                 if (panelMenuButton.menu.isOpen) {
//                     const symbol = event.get_key_symbol();
//                     if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
//                         // Left/Right のみの処理

//                         console.log(`DEBUG: KeyPress Caught at global.stage: ${symbol}`);
//                         return handleLeftRight(symbol);
//                     }
//                 }
//                 return Clutter.EVENT_PROPAGATE;
//             });

//             // メニューの大元である menu.actor に接続する
//             panelMenuButton.menu.actor.connect('key-press-event', (actor, event) => {

//                 const symbol = event.get_key_symbol();

//                 log(`DEBUG: KeyPress Caught at menu.actor: ${symbol}`);

//                 keyPressTimeline.define(Now, symbol);



//                 if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {

//                     console.log("ENTER key pressed, ignoring...");
//                     return Clutter.EVENT_STOP;
//                 }
//                 return Clutter.EVENT_PROPAGATE;
//             });
//             const favoritesManager = manageFavorites(favBox, keyPressTimeline);
//             const dynamicItemsManager = manageDynamicItems(demoBox);

//             Main.panel.addToStatusArea(metadata.uuid, panelMenuButton);
//             log('BRIDGE: Top-level UI created.');

//             const cleanup = () => {
//                 log('BRIDGE: Destroying top-level UI...');
//                 favoritesManager.dispose();
//                 dynamicItemsManager.dispose();
//                 panelMenuButton.destroy();
//                 panelIcon = null;
//                 log('BRIDGE: Top-level UI destroyed.');
//             };

//             return createResource(panelMenuButton, cleanup);
//         });

//     this.enable = () => lifecycleTimeline.define(Now, true);
//     this.disable = () => lifecycleTimeline.define(Now, false);
// }



import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Timeline, Now, createResource } from './timeline.js';
import { manageFavorites } from './component/ui0/manageFavorites.js';
import { manageDynamicItems } from './component/ui1/manageDynamicItems.js';

const log = (message) => {
    console.log(`[AIO-Validator] ${message}`);
};

export default function AIOValidatorExtension(metadata) {
    const lifecycleTimeline = Timeline(false);
    let panelIcon = null;

    lifecycleTimeline
        .distinctUntilChanged()
        .using(isEnabled => {
            if (!isEnabled) {
                if (panelIcon) {
                    panelIcon.set_style('background-color: red;');
                }
                return null;
            }

            log('BRIDGE: Creating top-level UI...');
            const panelMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
            panelIcon = new St.Icon({ icon_name: 'view-app-grid-symbolic' });
            panelMenuButton.add_child(panelIcon);
            panelIcon.set_style('background-color: red;');

            const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
            panelMenuButton.menu.box.add_child(mainBox);

            const favLabel = new St.Label({ text: 'Favorites (← → + Enter)' });
            const favBox = new St.BoxLayout({ style: 'spacing: 8px;' });
            mainBox.add_child(favLabel);
            mainBox.add_child(favBox);

            const demoLabel = new St.Label({ text: 'Focusable List Demo (↑ ↓ + Space)' });
            const demoBox = new St.BoxLayout({ style: 'spacing: 8px;' });
            mainBox.add_child(demoLabel);
            mainBox.add_child(demoBox);

            // キー状態を視覚的に表示するためのラベル
            const keyStatusLabel = new St.Label({
                text: 'Key Status: Ready',
                style: 'font-weight: bold; color: #ffffff; background-color: #333333; padding: 4px; border-radius: 4px;'
            });
            mainBox.add_child(keyStatusLabel);

            const keyPressTimeline = Timeline(null);

            // キーイベントハンドラー関数
            let globalKeyHandler = null;
            let menuActorKeyHandler = null;

            const handleLeftRight = (symbol) => {
                const direction = symbol === Clutter.KEY_Left ? 'LEFT' : 'RIGHT';
                log(`Handling ${direction} key press`);

                // 視覚的フィードバック
                if (direction === 'LEFT') {
                    keyStatusLabel.set_text('Key Status: ← LEFT pressed');
                    keyStatusLabel.set_style('font-weight: bold; color: #ffffff; background-color: #0066cc; padding: 4px; border-radius: 4px;');
                    panelIcon.set_style('background-color: #0066cc;');
                } else {
                    keyStatusLabel.set_text('Key Status: → RIGHT pressed');
                    keyStatusLabel.set_style('font-weight: bold; color: #ffffff; background-color: #cc6600; padding: 4px; border-radius: 4px;');
                    panelIcon.set_style('background-color: #cc6600;');
                }

                // 少し遅延してから元の状態に戻す
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    keyStatusLabel.set_text('Key Status: Ready');
                    keyStatusLabel.set_style('font-weight: bold; color: #ffffff; background-color: #333333; padding: 4px; border-radius: 4px;');
                    if (panelMenuButton.menu.isOpen) {
                        panelIcon.set_style('background-color: blue;');
                    }
                    return GLib.SOURCE_REMOVE;
                });

                keyPressTimeline.define(Now, symbol);
                return Clutter.EVENT_STOP;
            };

            panelMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    panelIcon.set_style('background-color: blue;');
                    keyStatusLabel.set_text('Key Status: Menu Open - Ready for keys');

                    // メニューが開いたときにキーハンドラーを設定
                    if (!globalKeyHandler) {
                        globalKeyHandler = global.stage.connect('key-press-event', (actor, event) => {
                            if (panelMenuButton.menu.isOpen) {
                                const symbol = event.get_key_symbol();
                                if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                                    log(`Global stage caught: ${symbol}`);
                                    return handleLeftRight(symbol);
                                }
                            }
                            return Clutter.EVENT_PROPAGATE;
                        });
                    }

                    if (!menuActorKeyHandler) {
                        menuActorKeyHandler = panelMenuButton.menu.actor.connect('key-press-event', (actor, event) => {
                            const symbol = event.get_key_symbol();
                            log(`Menu actor caught: ${symbol}`);

                            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                                return handleLeftRight(symbol);
                            }

                            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                                log("ENTER key pressed, ignoring...");
                                return Clutter.EVENT_STOP;
                            }

                            return Clutter.EVENT_PROPAGATE;
                        });
                    }
                } else {
                    panelIcon.set_style('background-color: red;');
                    keyStatusLabel.set_text('Key Status: Menu Closed');

                    // メニューが閉じたときにキーハンドラーを削除
                    if (globalKeyHandler) {
                        global.stage.disconnect(globalKeyHandler);
                        globalKeyHandler = null;
                    }

                    if (menuActorKeyHandler) {
                        panelMenuButton.menu.actor.disconnect(menuActorKeyHandler);
                        menuActorKeyHandler = null;
                    }
                }
            });

            // メニューにフォーカスを確実に設定
            panelMenuButton.menu.actor.set_can_focus(true);
            panelMenuButton.menu.actor.set_reactive(true);

            // メニューが開いたときにフォーカスを設定
            panelMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    // フォーカスを設定するために少し遅延
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        panelMenuButton.menu.actor.grab_key_focus();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });

            const favoritesManager = manageFavorites(favBox, keyPressTimeline);
            const dynamicItemsManager = manageDynamicItems(demoBox);

            Main.panel.addToStatusArea(metadata.uuid, panelMenuButton);
            log('BRIDGE: Top-level UI created.');

            const cleanup = () => {
                log('BRIDGE: Destroying top-level UI...');

                // キーハンドラーをクリーンアップ
                if (globalKeyHandler) {
                    global.stage.disconnect(globalKeyHandler);
                    globalKeyHandler = null;
                }
                if (menuActorKeyHandler) {
                    panelMenuButton.menu.actor.disconnect(menuActorKeyHandler);
                    menuActorKeyHandler = null;
                }

                favoritesManager.dispose();
                dynamicItemsManager.dispose();
                panelMenuButton.destroy();
                panelIcon = null;
                log('BRIDGE: Top-level UI destroyed.');
            };

            return createResource(panelMenuButton, cleanup);
        });

    this.enable = () => lifecycleTimeline.define(Now, true);
    this.disable = () => lifecycleTimeline.define(Now, false);
}