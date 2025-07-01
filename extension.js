import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
// Extensionクラスはもう不要
// import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Timeline, Now } from './timeline.js';

const log = (message) => {
    // console.log(`[AIO-Validator] ${message}`);
};

// ★★★★★ 修正の核心部分 ★★★★★
// GNOME Shellが呼び出すエントリーポイント。これがファクトリ関数となる。
export default function () {

    // --- 状態管理 ---
    // `this`のプロパティではなく、クロージャで管理されるローカル変数。
    // `enable`と`disable`はこのスコープを共有するため、永続的にアクセスできる。
    let indicator = null;
    const lifecycle = Timeline(false);

    // --- 副作用の定義 ---
    // 状態の変化を監視し、UIを同期させる永続的な購読
    lifecycle
        .distinctUntilChanged()
        .map(isEnabled => {
            log(`Lifecycle state changed to: ${isEnabled}`);
            if (isEnabled) {
                if (indicator === null) {
                    log('State is TRUE: Creating indicator...');
                    indicator = new PanelMenu.Button(0.5, 'AIO Validator');
                    const icon = new St.Icon({
                        icon_name: 'system-run-symbolic',
                        style_class: 'system-status-icon',
                    });
                    indicator.add_child(icon);
                    // `this.uuid`は使えないが、通常はmetadataから取得・保持する
                    // ここでは固定文字列で代替
                    Main.panel.addToStatusArea('aio-validator-uuid', indicator);
                    log('Indicator created.');
                }
            } else {
                if (indicator !== null) {
                    log('State is FALSE: Destroying indicator...');
                    indicator.destroy();
                    indicator = null;
                    log('Indicator destroyed.');
                }
            }
        });

    // --- GNOME Shellに渡すAPI ---
    // `this`に依存しない、ただの関数。
    function enable() {
        log('enable() called: Defining state to TRUE.');
        lifecycle.define(Now, true);
    }

    function disable() {
        log('disable() called: Defining state to FALSE.');
        lifecycle.define(Now, false);
    }

    // `enable`と`disable`メソッドを持つオブジェクトを返す。
    // これがGNOME Shellの要求する拡張機能のインターフェースとなる。
    return {
        enable,
        disable,
    };
}