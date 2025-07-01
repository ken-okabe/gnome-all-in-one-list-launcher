import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Timeline, Now } from './timeline.js';

const log = (message) => {
    // console.log(`[AIO-Validator] ${message}`);
};

class AIOValidatorExtension extends Extension {
    constructor(metadata) {
        super(metadata);

        this._indicator = null;
        this._lifecycle = Timeline(false);

        // timeline.jsの思想の核心：
        // ライフサイクルの状態 (true/false) の変化を `map` を使って購読し、
        // 状態に応じて副作用（UIの生成/破棄）を命令的に実行する。
        // これにより、リアクティブなデータフローと命令的なUI管理が完全に同期する。
        this._lifecycle
            .distinctUntilChanged() // 重複した状態変更は無視する
            .map(isEnabled => {
                log(`Lifecycle state changed to: ${isEnabled}`);
                if (isEnabled) {
                    // --- 状態が `true` になった時の処理 ---
                    if (this._indicator === null) {
                        log('State is TRUE: Creating indicator...');
                        this._indicator = new PanelMenu.Button(0.5, 'AIO Validator');
                        const icon = new St.Icon({
                            icon_name: 'system-run-symbolic',
                            style_class: 'system-status-icon',
                        });
                        this._indicator.add_child(icon);
                        Main.panel.addToStatusArea(this.uuid, this._indicator);
                        log('Indicator created.');
                    }
                } else {
                    // --- 状態が `false` になった時の処理 ---
                    if (this._indicator !== null) {
                        log('State is FALSE: Destroying indicator...');
                        this._indicator.destroy();
                        this._indicator = null;
                        log('Indicator destroyed.');
                    }
                }
            });
    }

    enable() {
        // ライフサイクルの「真実のソース」に `true` を定義する。
        // これが `map` への唯一の入力となる。
        log('enable() called: Defining state to TRUE.');
        this._lifecycle.define(Now, true);
    }

    disable() {
        // ライフサイクルの「真実のソース」に `false` を定義する。
        log('disable() called: Defining state to FALSE.');
        this._lifecycle.define(Now, false);
    }
}

export default function (metadata) {
    return new AIOValidatorExtension(metadata);
}