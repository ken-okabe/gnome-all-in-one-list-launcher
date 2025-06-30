// prefs.js

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MAX_FAVORITES = 30;

// A helper structure for the icon list
const ICON_LIST = [
    { category: `General & Menu`, label: `Menu (Hamburger)`, value: `open-menu-symbolic` },
    { category: `General & Menu`, label: `Grid (9 Dots)`, value: `view-app-grid-symbolic` },
    { category: `General & Menu`, label: `Grid (4 Squares)`, value: `view-grid-symbolic` },
    { category: `General & Menu`, label: `View List`, value: `view-list-symbolic` },
    { category: `General & Menu`, label: `Arrow Down`, value: `go-down-symbolic` },
    { category: `General & Menu`, label: `Arrow Up`, value: `go-up-symbolic` },
    { category: `General & Menu`, label: `More (Ellipsis)`, value: `view-more-symbolic` },
    { category: `General & Menu`, label: `Drag Handle`, value: `drag-handle-symbolic` },
    { category: `System & Places`, label: `Preferences`, value: `preferences-system-symbolic` },
    { category: `System & Places`, label: `Home`, value: `user-home-symbolic` },
    { category: `System & Places`, label: `Computer`, value: `computer-symbolic` },
    { category: `System & Places`, label: `Start Here`, value: `start-here-symbolic` },
    { category: `System & Places`, label: `Terminal`, value: `utilities-terminal-symbolic` },
    { category: `System & Places`, label: `Security`, value: `security-high-symbolic` },
    { category: `System & Places`, label: `Hard Disk`, value: `drive-harddisk-symbolic` },
    { category: `System & Places`, label: `Trash`, value: `user-trash-full-symbolic` },
    { category: `System & Places`, label: `Folder (Open)`, value: `folder-open-symbolic` },
    { category: `Symbols & Status`, label: `Star (Filled)`, value: `starred-symbolic` },
    { category: `Symbols & Status`, label: `Star (Empty)`, value: `non-starred-symbolic` },
    { category: `Symbols & Status`, label: `Bookmark`, value: `bookmark-new-symbolic` },
    { category: `Symbols & Status`, label: `Information`, value: `info-symbolic` },
    { category: `Symbols & Status`, label: `Help`, value: `help-about-symbolic` },
    { category: `Symbols & Status`, label: `Warning`, value: `dialog-warning-symbolic` },
    { category: `Symbols & Status`, label: `Error`, value: `dialog-error-symbolic` },
    { category: `Symbols & Status`, label: `Process Completed`, value: `process-completed-symbolic` },
    { category: `Symbols & Status`, label: `Weather Clear`, value: `weather-clear-symbolic` },
    { category: `Symbols & Status`, label: `Weather Storm`, value: `weather-storm-symbolic` },
    { category: `Symbols & Status`, label: `Lightbulb`, value: `idea-symbolic` },
    { category: `Actions`, label: `Search`, value: `edit-find-symbolic` },
    { category: `Actions`, label: `Target / Locate`, value: `find-location-symbolic` },
    { category: `Actions`, label: `Refresh`, value: `view-refresh-symbolic` },
    { category: `Actions`, label: `Add`, value: `list-add-symbolic` },
    { category: `Actions`, label: `Remove`, value: `list-remove-symbolic` },
    { category: `Actions`, label: `Edit`, value: `document-edit-symbolic` },
    { category: `Actions`, label: `Save`, value: `document-save-symbolic` },
    { category: `Actions`, label: `Send`, value: `mail-send-symbolic` },
    { category: `Actions`, label: `Exit`, value: `application-exit-symbolic` },
    { category: `Actions`, label: `Zoom In`, value: `zoom-in-symbolic` },
    { category: `Actions`, label: `Zoom Out`, value: `zoom-out-symbolic` },
    { category: `Devices & Network`, label: `Speakers`, value: `audio-speakers-symbolic` },
    { category: `Devices & Network`, label: `Camera`, value: `camera-photo-symbolic` },
    { category: `Devices & Network`, label: `Brightness`, value: `display-brightness-symbolic` },
    { category: `Devices & Network`, label: `Network Wired`, value: `network-wired-symbolic` },
    { category: `Devices & Network`, label: `Network Wireless`, value: `network-wireless-symbolic` },
    { category: `Devices & Network`, label: `Bluetooth`, value: `bluetooth-active-symbolic` },
    { category: `Toggles & Checks`, label: `Checkbox`, value: `checkbox-checked-symbolic` },
    { category: `Toggles & Checks`, label: `Radio Button`, value: `radio-checked-symbolic` },
    { category: `Toggles & Checks`, label: `Toggle On`, value: `toggle-on-symbolic` },
    { category: `Toggles & Checks`, label: `Toggle Off`, value: `toggle-off-symbolic` },
    { category: `Toggles & Checks`, label: `Unavailable`, value: `action-unavailable-symbolic` },
    { category: `Toggles & Checks`, label: `Pointer`, value: `object-select-symbolic` },
];


const KeybindingDialog = GObject.registerClass(
    class KeybindingDialog extends Gtk.Dialog {
        _init(params) {
            super._init({
                ...params,
                title: _('Set Shortcut'),
                use_header_bar: 1,
                modal: true,
                resizable: false,
            });
            this.set_size_request(450, 250);

            this._currentAccelerator = '';

            const contentBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 12,
                margin_start: 24, margin_end: 24,
                margin_top: 24, margin_bottom: 24,
            });
            this.get_content_area().append(contentBox);

            this.descriptionLabel = new Gtk.Label({
                label: _('Press any key combination, or press Backspace to clear.'),
                wrap: true, wrap_mode: Gtk.WrapMode.WORD, xalign: 0,
            });
            contentBox.append(this.descriptionLabel);

            this.shortcutDisplayBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                halign: Gtk.Align.CENTER,
                valign: Gtk.Align.CENTER,
                css_classes: ['key-display-box'],
                hexpand: true, vexpand: true,
            });
            contentBox.append(this.shortcutDisplayBox);

            this.shortcutLabel = new Gtk.Label({
                label: _('Press keys to set shortcut'),
                css_classes: ['dim-label'],
                hexpand: true,
                xalign: 0.5,
            });
            this.shortcutDisplayBox.append(this.shortcutLabel);

            const clearButton = new Gtk.Button({
                icon_name: 'edit-clear-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: _('Clear Shortcut'),
                can_focus: false,
            });
            clearButton.connect('clicked', () => this._clearShortcut());
            this.shortcutDisplayBox.append(clearButton);

            this.cancelButton = this.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
            this.setButton = this.add_button(_('Set'), Gtk.ResponseType.OK);
            this.setButton.set_sensitive(false);
            this.setButton.get_style_context().add_class('suggested-action');

            this.keyController = new Gtk.EventControllerKey();
            this.add_controller(this.keyController);
            this.keyController.connect('key-pressed', this._onKeyPressed.bind(this));
        }

        _onKeyPressed(controller, keyval, keycode, state) {
            if (keyval === Gdk.KEY_BackSpace) {
                this._clearShortcut();
                return Gdk.EVENT_STOP;
            }

            if (this._isModifier(keyval)) {
                return Gdk.EVENT_STOP;
            }

            const mask = state & Gtk.accelerator_get_default_mod_mask();

            let isRestrictedAlone = false;
            if (mask === 0) {
                switch (true) {
                    case (keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z):
                    case (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z):
                    case (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9):
                    case (keyval === Gdk.KEY_space):
                    case (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter):
                    case (keyval === Gdk.KEY_Escape):
                    case (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_ISO_Left_Tab):
                    case (keyval === Gdk.KEY_Up):
                    case (keyval === Gdk.KEY_Down):
                    case (keyval === Gdk.KEY_Left):
                    case (keyval === Gdk.KEY_Right):
                    case (keyval === Gdk.KEY_Insert):
                    case (keyval === Gdk.KEY_Delete):
                        isRestrictedAlone = true;
                        break;
                }
            }

            const isCtrlSpace = (keyval === Gdk.KEY_space && mask === Gdk.ModifierType.CONTROL_MASK);

            if ((Gtk.accelerator_valid(keyval, mask) || isCtrlSpace) && !isRestrictedAlone) {
                const binding = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
                this._setShortcut(binding);
                this.setButton.set_sensitive(true);
                this.setButton.grab_focus();
            } else {
                this._clearShortcut();
            }

            return Gdk.EVENT_STOP;
        }

        _clearShortcut() {
            this._setShortcut('');
            this.setButton.set_sensitive(true);
            this.setButton.grab_focus();
        }

        _isModifier(keyval) {
            return keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
                keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R ||
                keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
                keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R;
        }

        _setShortcut(accelerator) {
            this._currentAccelerator = accelerator;
            if (accelerator) {
                const prettyString = accelerator
                    .replace(/</g, '')
                    .replace(/>/g, ' + ')
                    .replace(/_L$|_R$/, '')
                    .replace(/\s\+\s*$/, '');
                this.shortcutLabel.set_label(prettyString);
                this.shortcutLabel.get_style_context().remove_class('dim-label');
                this.shortcutLabel.get_style_context().add_class('key-label');
            } else {
                this.shortcutLabel.set_label(_('Press keys to set shortcut'));
                this.shortcutLabel.get_style_context().remove_class('key-label');
                this.shortcutLabel.get_style_context().add_class('dim-label');
            }
        }

        setTargetName(name) {
            if (name) {
                this.set_title(_('Set Shortcut for “%s”').format(name));
            }
        }

        setCurrentShortcut(accelerator) {
            if (accelerator) {
                this._setShortcut(accelerator);
                this.setButton.set_sensitive(true);
            } else {
                this._clearShortcut();
            }
        }

        get_shortcut() {
            return this._currentAccelerator;
        }
    }
);

export default class AllWindowsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings();
        this._favoritesSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        this._activeConnections = [];
        window.set_default_size(800, 1050);

        window.add(this._buildFavoritesPage());
        window.add(this._buildActionsPage());
        window.add(this._buildDisplayPage());
        window.add(this._buildAboutPage());

        window.connect('close-request', () => this._disconnectAll());
    }

    _disconnectAll() {
        this._activeConnections.forEach(({ source, id }) => {
            if (source && id) { try { source.disconnect(id); } catch (e) { } }
        });
        this._activeConnections = [];
    }

    _buildFavoritesPage() {
        const page = new Adw.PreferencesPage({ title: _('Favorites'), icon_name: 'starred-symbolic' });

        const mainShortcutGroup = new Adw.PreferencesGroup({ title: _('Main Action Shortcut') });
        page.add(mainShortcutGroup);

        this._createShortcutRow(mainShortcutGroup, _('Open Popup Menu'), 'main-shortcut');

        const actionValues = ['show-overview', 'close-popup'];
        const actionLabels = [_('Show Overview'), _('Close Popup Menu')];
        const shortcutActionRow = new Adw.ComboRow({
            title: _('Action on Second Press'),
            subtitle: _('Action when the shortcut is pressed again while the popup is open'),
            model: Gtk.StringList.new(actionLabels),
        });
        const currentAction = this._settings.get_string('main-shortcut-action');
        shortcutActionRow.set_selected(actionValues.indexOf(currentAction));
        shortcutActionRow.connect('notify::selected', () => {
            this._settings.set_string('main-shortcut-action', actionValues[shortcutActionRow.get_selected()]);
        });
        mainShortcutGroup.add(shortcutActionRow);

        // Add static info row for Escape key
        const escapeInfoRow = new Adw.ActionRow({
            title: _('Close Popup Menu / Overview'),
            subtitle: _('Press Escape key to close Popup menu and Overview.'),
            activatable: false
        });
        const escapeLabel = new Gtk.Label({
            label: '<b>Escape</b>',
            use_markup: true,
            css_classes: ['heading']
        });
        escapeInfoRow.add_suffix(escapeLabel);
        mainShortcutGroup.add(escapeInfoRow);

        const favoritesGroup = new Adw.PreferencesGroup({
            title: _('Favorite Apps and Shortcuts'),
            description: _('Reorder your favorite applications and assign global keyboard shortcuts here.') + '\n\n' +
                _('• Favorite App Launcher in Popup Menu') + '\n' + _('    Always tries to launch a new window or instance.') + '\n' +
                _('• Favorite Shortcut Keys Assigned Here') + '\n' + _('    Brings an open window into focus, or launches the app if it\'s not running.')
        });
        page.add(favoritesGroup);

        const availableKeysGroup = new Adw.PreferencesGroup({ title: _('Available Keys') });
        page.add(availableKeysGroup);

        const expanderRow = new Adw.ExpanderRow({
            title: _('Keyboard Shortcut Guidelines'),
            subtitle: _('View which keys can be used for shortcuts')
        });
        availableKeysGroup.add(expanderRow);
        this._addAvailableKeysContent(expanderRow);

        const scrolledWindow = new Gtk.ScrolledWindow({ vexpand: true, min_content_height: 400, hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.AUTOMATIC });
        favoritesGroup.add(scrolledWindow);
        const listBox = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list'] });
        scrolledWindow.set_child(listBox);

        const populateList = () => {
            while (listBox.get_row_at_index(0) !== null) {
                listBox.remove(listBox.get_row_at_index(0));
            }
            const favorites = this._favoritesSettings.get_strv('favorite-apps');
            const appInfos = new Map(Gio.AppInfo.get_all().map(app => [app.get_id(), app]));
            favorites.slice(0, MAX_FAVORITES).forEach((appId, index) => {
                const appInfo = appInfos.get(appId);
                if (!appInfo) return;
                const row = new Adw.ActionRow({ title: appInfo.get_display_name() });
                row.add_prefix(new Gtk.Image({ gicon: appInfo.get_icon(), pixel_size: 32, valign: Gtk.Align.CENTER }));
                const reorderButtonBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, valign: Gtk.Align.CENTER });
                const upButton = new Gtk.Button({ icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER, sensitive: index > 0, css_classes: ['flat'] });
                upButton.connect('clicked', () => this._moveFavoriteItem(index, index - 1));
                reorderButtonBox.append(upButton);
                const downButton = new Gtk.Button({ icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER, sensitive: index < favorites.length - 1, css_classes: ['flat'] });
                downButton.connect('clicked', () => this._moveFavoriteItem(index, index + 1));
                reorderButtonBox.append(downButton);
                row.add_prefix(reorderButtonBox);
                this._createShortcutRow(row, null, `shortcut-${index}`, appInfo.get_display_name());
                listBox.append(row);
            });
        };

        const favId = this._favoritesSettings.connect('changed::favorite-apps', populateList);
        this._activeConnections.push({ source: this._favoritesSettings, id: favId });
        for (let i = 0; i < MAX_FAVORITES; i++) {
            const shortcutId = this._settings.connect(`changed::shortcut-${i}`, populateList);
            this._activeConnections.push({ source: this._settings, id: shortcutId });
        }
        populateList();
        return page;
    }

    _addAvailableKeysContent(expanderRow) {
        const boxStyle = {
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_start: 12,
            margin_end: 12,
            margin_top: 8,
            margin_bottom: 8
        };

        const allowedBox = new Gtk.Box(boxStyle);
        allowedBox.append(new Gtk.Label({
            label: `<b>✅ ${_('Available Keys (can be used alone):')}</b>`,
            use_markup: true,
            xalign: 0,
            css_classes: ['heading']
        }));
        allowedBox.append(new Gtk.Label({
            label: `• ${_('Function Keys: F1, F2, F3, ... F12, F13-F35')}\n` +
                `• ${_('Navigation: Home, End, Page Up, Page Down')}\n` +
                `• ${_('System Keys: Print Screen, Scroll Lock, Pause, Menu')}\n` +
                `• ${_('Any key combination with modifiers (Ctrl, Alt, Super, Shift)')}`,
            xalign: 0,
            css_classes: ['body'],
            margin_start: 16
        }));
        expanderRow.add_row(new Adw.ActionRow({ child: allowedBox, activatable: false }));

        const restrictedBox = new Gtk.Box(boxStyle);
        restrictedBox.append(new Gtk.Label({
            label: `<b>❌ ${_('Restricted Keys (require modifier keys):')}</b>`,
            use_markup: true,
            xalign: 0,
            css_classes: ['heading']
        }));
        restrictedBox.append(new Gtk.Label({
            label: `• ${_('Letters: a-z, A-Z (to avoid conflicts with text input)')}\n` +
                `• ${_('Numbers: 0-9 (to avoid conflicts with text input)')}\n` +
                `• ${_('Basic UI Keys: Space, Enter, Escape, Tab')}\n` +
                `• ${_('Arrow Keys: Up, Down, Left, Right')}\n` +
                `• ${_('Edit Keys: Insert, Delete, Backspace')}\n\n` +
                `<i>${_('These keys can be used with Ctrl, Alt, Super, or Shift modifiers.')}</i>`,
            use_markup: true,
            xalign: 0,
            css_classes: ['body'],
            margin_start: 16
        }));
        expanderRow.add_row(new Adw.ActionRow({ child: restrictedBox, activatable: false }));
    }

    _moveFavoriteItem(oldIndex, newIndex) {
        const oldFavorites = this._favoritesSettings.get_strv('favorite-apps');
        const oldShortcuts = Array.from({ length: MAX_FAVORITES }, (_, i) => this._settings.get_strv(`shortcut-${i}`));
        const shortcutMap = new Map(oldFavorites.map((appId, i) => [appId, oldShortcuts[i]]));
        const [movedItem] = oldFavorites.splice(oldIndex, 1);
        oldFavorites.splice(newIndex, 0, movedItem);
        const newShortcuts = oldFavorites.map(appId => shortcutMap.get(appId) || []);
        this._favoritesSettings.set_strv('favorite-apps', oldFavorites);
        newShortcuts.forEach((sc, i) => this._settings.set_strv(`shortcut-${i}`, sc));
    }

    _buildActionsPage() {
        const page = new Adw.PreferencesPage({ title: _('Actions'), icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic' });

        const favGroup = new Adw.PreferencesGroup({ title: _('Favorites Bar (In Popup Menu)') });
        page.add(favGroup);

        const favNavRow = new Adw.ActionRow({ title: _('Navigate Left / Right') });
        favNavRow.add_suffix(new Gtk.Label({ label: 'Left / Right', css_classes: ['heading'] }));
        favGroup.add(favNavRow);

        const favLaunchRow = new Adw.ActionRow({ title: _('Launch New Instance') });
        favLaunchRow.add_suffix(new Gtk.Label({ label: 'Enter (Return)', css_classes: ['heading'] }));
        favGroup.add(favLaunchRow);

        const winGroup = new Adw.PreferencesGroup({ title: _('Window List (In Popup Menu)') });
        page.add(winGroup);

        const winNavRow = new Adw.ActionRow({ title: _('Navigate Up / Down') });
        winNavRow.add_suffix(new Gtk.Label({ label: 'Up / Down', css_classes: ['heading'] }));
        winGroup.add(winNavRow);

        const winActivateRow = new Adw.ActionRow({ title: _('Activate Instance') });
        winActivateRow.add_suffix(new Gtk.Label({ label: 'Space', css_classes: ['heading'] }));
        winGroup.add(winActivateRow);

        const winCloseRow = new Adw.ActionRow({ title: _('Close Instance') });
        winCloseRow.add_suffix(new Gtk.Label({ label: 'Backspace', css_classes: ['heading'] }));
        winGroup.add(winCloseRow);

        const closeOptionsGroup = new Adw.PreferencesGroup({ title: _('Automatic Closing Options') });
        page.add(closeOptionsGroup);

        const closeOnFavRow = new Adw.SwitchRow({
            title: _('Close after Favorite Launch'),
            subtitle: _('Closes the popup after launching an app from the favorites bar.')
        });
        this._settings.bind('close-on-fav-launch', closeOnFavRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        closeOptionsGroup.add(closeOnFavRow);

        const closeOnActivateRow = new Adw.SwitchRow({
            title: _('Close after Window Activation'),
            subtitle: _('Closes the popup after activating a window from the list.')
        });
        this._settings.bind('close-on-list-activate', closeOnActivateRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        closeOptionsGroup.add(closeOnActivateRow);

        const closeOnCloseRow = new Adw.SwitchRow({
            title: _('Close after Window Close'),
            subtitle: _('Closes the popup after closing a window from the list.')
        });
        this._settings.bind('close-on-list-close', closeOnCloseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        closeOptionsGroup.add(closeOnCloseRow);

        return page;
    }

    _createShortcutRow(parent, title, settingKey, targetName = null) {
        const row = title ? new Adw.ActionRow({ title }) : parent;
        if (title) parent.add(row);

        const shortcutAndEditBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
        });

        const shortcutLabel = new Gtk.Label({ css_classes: ['dim-label'], hexpand: true, xalign: 1 });
        shortcutAndEditBox.append(shortcutLabel);

        const updateLabel = () => {
            const shortcut = this._settings.get_strv(settingKey)[0] || _('Unassigned');
            shortcutLabel.set_label(shortcut);
        };
        const id = this._settings.connect(`changed::${settingKey}`, updateLabel);
        this._activeConnections.push({ source: this._settings, id });
        updateLabel();

        const editButton = new Gtk.Button({ icon_name: 'edit-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'] });
        shortcutAndEditBox.append(editButton);
        editButton.connect('clicked', () => {
            const currentShortcut = this._settings.get_strv(settingKey)[0];
            const dialog = new KeybindingDialog({ transient_for: this._window });
            dialog.setTargetName(targetName || title);
            dialog.setCurrentShortcut(currentShortcut || '');
            dialog.connect('response', (dlg, response) => {
                if (response === Gtk.ResponseType.OK) {
                    const newShortcut = dlg.get_shortcut();
                    this._settings.set_strv(settingKey, newShortcut ? [newShortcut] : []);
                }
                dlg.destroy();
            });
            dialog.show();
        });

        row.add_suffix(shortcutAndEditBox);
    }

    _buildDisplayPage() {
        const page = new Adw.PreferencesPage({ title: _('Display'), icon_name: 'video-display-symbolic' });

        // Group for Panel Item Positions
        const displayGroup = new Adw.PreferencesGroup({ title: _('Panel Item Positions') });
        page.add(displayGroup);

        const positions = ['left', 'center', 'right'];
        const indicatorPosRow = new Adw.ComboRow({
            title: _('Main Icon Group Position'),
            subtitle: _('Position of the main icon and the window icon list'),
            model: Gtk.StringList.new(positions),
        });
        indicatorPosRow.set_selected(positions.indexOf(this._settings.get_string('main-icon-position')));
        indicatorPosRow.connect('notify::selected', () => {
            this._settings.set_string('main-icon-position', positions[indicatorPosRow.get_selected()]);
        });
        displayGroup.add(indicatorPosRow);

        const indicatorRankRow = new Adw.SpinRow({
            title: _('Main Icon Group Rank'),
            subtitle: _('Adjusts the order within the panel section. Lower numbers appear first.'),
            adjustment: new Gtk.Adjustment({ lower: -100, upper: 100, step_increment: 1 })
        });
        this._settings.bind('main-icon-rank', indicatorRankRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(indicatorRankRow);

        const dateMenuPosRow = new Adw.ComboRow({
            title: _('Date/Time Menu Position'),
            subtitle: _('Move the clock to the left, center, or right section of the panel'),
            model: Gtk.StringList.new(positions),
        });
        dateMenuPosRow.set_selected(positions.indexOf(this._settings.get_string('date-menu-position')));
        dateMenuPosRow.connect('notify::selected', () => {
            this._settings.set_string('date-menu-position', positions[dateMenuPosRow.get_selected()]);
        });
        displayGroup.add(dateMenuPosRow);

        const dateMenuRankRow = new Adw.SpinRow({
            title: _('Date/Time Menu Rank'),
            subtitle: _('Adjusts the order within the panel section.'),
            adjustment: new Gtk.Adjustment({ lower: -100, upper: 100, step_increment: 1 })
        });
        this._settings.bind('date-menu-rank', dateMenuRankRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(dateMenuRankRow);

        // New Group for Icons
        const iconsGroup = new Adw.PreferencesGroup({ title: _('Icons') });
        page.add(iconsGroup);

        // 1. Main Panel Icon Selector
        const iconModelLabels = ICON_LIST.map(item => `${item.category}: ${item.label}`);
        const mainIconRow = new Adw.ComboRow({
            title: _('Main Panel Icon'),
            subtitle: _('Choose an icon for the main button on the panel'),
            model: Gtk.StringList.new(iconModelLabels),
        });
        const currentIconValue = this._settings.get_string('main-panel-icon');
        const currentIconIndex = ICON_LIST.findIndex(item => item.value === currentIconValue);
        mainIconRow.set_selected(currentIconIndex > -1 ? currentIconIndex : 0);
        mainIconRow.connect('notify::selected', () => {
            const selected = ICON_LIST[mainIconRow.get_selected()];
            if (selected) {
                this._settings.set_string('main-panel-icon', selected.value);
            }
        });
        iconsGroup.add(mainIconRow);

        // 2. Show Window Icon List on Panel (Moved)
        const showWindowIconListRow = new Adw.SwitchRow({
            title: _('Show Window Icon List on Panel'),
            subtitle: _('Displays open window icons next to the main indicator')
        });
        this._settings.bind('show-window-icon-list', showWindowIconListRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        iconsGroup.add(showWindowIconListRow);

        // 3. Show Overview Button in Popup (New)
        const showOverviewButtonRow = new Adw.SwitchRow({
            title: _('Show Overview Button in Popup'),
            subtitle: _('Displays a button to open the Activities Overview in the popup menu')
        });
        this._settings.bind('show-overview-button', showOverviewButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        iconsGroup.add(showOverviewButtonRow);

        // Group for Other Options
        const otherOptionsGroup = new Adw.PreferencesGroup({ title: _('Other Options') });
        page.add(otherOptionsGroup);

        // ★★★ ここから追加 ★★★
        const hideActivitiesSwitch = new Adw.SwitchRow({
            title: 'Hide Activities Button',
            subtitle: 'Hides the default "Activities" button in the top left corner',
        });
        otherOptionsGroup.add(hideActivitiesSwitch);

        this._settings.bind(
            'hide-activities-button',
            hideActivitiesSwitch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        // ★★★ 追加ここまで ★★★

        const forceHideOverviewRow = new Adw.SwitchRow({
            title: _('Hide Overview at Start-up'),
            subtitle: _('Prevents the Activities Overview from showing automatically on login')
        });
        this._settings.bind('hide-overview-at-startup', forceHideOverviewRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        otherOptionsGroup.add(forceHideOverviewRow);

        return page;
    }

    _buildAboutPage() {
        const page = new Adw.PreferencesPage({ title: _('About'), icon_name: 'help-about-symbolic' });
        const infoGroup = new Adw.PreferencesGroup({ title: _('Information') });
        page.add(infoGroup);
        infoGroup.add(new Adw.ActionRow({ title: this.metadata.name, subtitle: `${_('Version')} ${this.metadata.version}` }));
        infoGroup.add(new Adw.ActionRow({ title: _('Description'), subtitle: this.metadata.description, subtitle_lines: 4 }));
        const linksGroup = new Adw.PreferencesGroup({ title: _('Links') });
        page.add(linksGroup);
        const issuesRow = new Adw.ActionRow({ title: _('Report an Issue'), subtitle: _('Report bugs or request features') });
        issuesRow.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
        issuesRow.activatable = true;
        issuesRow.connect('activated', () => Gtk.show_uri(this._window, "https://github.com/ken-okabe/all-in-one-list-launcher-for-gnome-shell/issues", Gdk.CURRENT_TIME));
        linksGroup.add(issuesRow);
        return page;
    }
}