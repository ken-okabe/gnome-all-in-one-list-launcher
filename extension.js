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
                    log('DEBUG: Extension disabled. Setting icon to red.');
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
            
            const keyPressTimeline = Timeline(null);
            
            panelMenuButton.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    log('DEBUG: Menu opened. Setting icon to blue.');
                    panelIcon.set_style('background-color: blue;');
                } else {
                    log('DEBUG: Menu closed. Setting icon to red.');
                    panelIcon.set_style('background-color: red;');
                }
            });

            // シンプルなキーハンドラに戻す
            panelMenuButton.menu.box.connect('key-press-event', (actor, event) => {
                const keySymbol = event.get_key_symbol();
                log(`DEBUG: KeyPress Caught at menu.box: ${Clutter.keysym_to_string(keySymbol)}`);
                keyPressTimeline.define(Now, keySymbol);
                return Clutter.EVENT_PROPAGATE;
            });

            const favoritesManager = manageFavorites(favBox, keyPressTimeline);
            const dynamicItemsManager = manageDynamicItems(demoBox);

            Main.panel.addToStatusArea(metadata.uuid, panelMenuButton);
            log('BRIDGE: Top-level UI created.');

            const cleanup = () => {
                log('BRIDGE: Destroying top-level UI...');
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