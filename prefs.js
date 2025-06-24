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

const KeybindingDialog = GObject.registerClass(class KeybindingDialog extends Gtk.Dialog {
    _init(params) {
        super._init({
            ...params,
            title: _('Set Shortcut'),
            use_header_bar: 1,
            modal: true,
            resizable: false
        });
        this.set_size_request(400, 200);

        const cancelButton = this.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        cancelButton.set_focusable(false);

        this.setButton = this.add_button(_('Set'), Gtk.ResponseType.OK);
        this.setButton.set_focusable(false);
        this.setButton.set_sensitive(false);
        // ★ 修正点: Setボタンを青色にする (推奨アクション)
        this.setButton.add_css_class('suggested-action');

        const contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_start: 24, margin_end: 24,
            margin_top: 24, margin_bottom: 24
        });
        this.get_content_area().append(contentBox);

        this.descriptionLabel = new Gtk.Label({
            label: _('Press any key combination.'),
            wrap: true, wrap_mode: Gtk.WrapMode.WORD, xalign: 0, vexpand: true
        });
        contentBox.append(this.descriptionLabel);

        this.shortcutDisplayBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.CENTER,
            css_classes: ['key-display-box']
        });
        contentBox.append(this.shortcutDisplayBox);

        this.keyIllustrationLabel = new Gtk.Label({
            label: _('Press keys to set shortcut'),
            css_classes: ['dim-label']
        });
        this.shortcutDisplayBox.append(this.keyIllustrationLabel);

        this.clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            visible: false,
            focusable: false
        });
        this.clearButton.connect('clicked', () => this._clearShortcut());
        this.shortcutDisplayBox.append(this.clearButton);


        this.keyController = new Gtk.EventControllerKey;
        this.add_controller(this.keyController);

        this.keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            // ★ 修正点: ハードコードされたキーをダイアログで設定できないように保護する
            switch (keyval) {
                case Gdk.KEY_Return:
                case Gdk.KEY_KP_Enter:
                    // Enterキーは 'Set' ボタンのクリックとして扱う
                    if (this.setButton.is_sensitive()) {
                        this.response(Gtk.ResponseType.OK);
                    }
                    return Gdk.EVENT_STOP;
                case Gdk.KEY_space:
                    // Spaceキーは無視する
                    return Gdk.EVENT_STOP;
                case Gdk.KEY_BackSpace:
                    // Backspaceキーはショートカットのクリアとして扱う
                    this._clearShortcut();
                    return Gdk.EVENT_STOP;
            }

            const mask = state & Gtk.accelerator_get_default_mod_mask();

            if (this._isBindingValid({ mask, keycode, keyval })) {
                const binding = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
                this._setShortcutDisplay(binding);
                this.emittedShortcut = binding;
                this.setButton.set_sensitive(true);
            }
            return Gdk.EVENT_STOP;
        });

        this.emittedShortcut = null;
    }

    _clearShortcut() {
        this._setShortcutDisplay('');
        this.emittedShortcut = '';
        this.setButton.set_sensitive(true);
    }

    setTargetName(name) { this.descriptionLabel.set_label(`${_('Enter new shortcut to change')} ${name}`); }

    setCurrentShortcut(shortcut) {
        this._setShortcutDisplay(shortcut);
        if (shortcut) {
            this.setButton.set_sensitive(true);
            this.emittedShortcut = shortcut;
        } else {
            this.setButton.set_sensitive(false);
            this.emittedShortcut = null;
        }
    }

    _setShortcutDisplay(shortcutString) {
        while (this.shortcutDisplayBox.get_first_child() !== this.clearButton) {
            this.shortcutDisplayBox.remove(this.shortcutDisplayBox.get_first_child());
        }

        if (shortcutString) {
            if (this.keyIllustrationLabel.get_parent()) {
                this.shortcutDisplayBox.remove(this.keyIllustrationLabel);
            }
            const displayText = shortcutString.replace(/</g, '').replace(/>/g, ' + ').replace(/\s+\+\s*$/, '');
            const label = new Gtk.Label({ label: displayText, css_classes: ['key-label'] });
            this.shortcutDisplayBox.insert_child_after(label, null);
            this.clearButton.set_visible(true);
        } else {
            let child;
            while ((child = this.shortcutDisplayBox.get_first_child()) && child !== this.clearButton) {
                this.shortcutDisplayBox.remove(child);
            }
            this.shortcutDisplayBox.insert_child_after(this.keyIllustrationLabel, null);
            this.clearButton.set_visible(false);
        }
    }

    _isBindingValid({ mask, keycode, keyval }) {
        if ((mask === 0 || mask === Gdk.ModifierType.SHIFT_MASK) && keycode !== 0) {
            if (keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z || keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z || keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9)
                return false;
        }
        return Gtk.accelerator_valid(keyval, mask) || (keyval === Gdk.KEY_Tab && mask !== 0);
    }

    get_shortcut() { return this.emittedShortcut; }
});

export default class AllWindowsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings();
        this._favoritesSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        this._activeConnections = [];
        window.set_default_size(1050, 850);

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
        // in _buildFavoritesPage()
        const page = new Adw.PreferencesPage({ title: _('Favorites'), icon_name: 'starred-symbolic' }); const description = _('Reorder your favorite applications and assign global keyboard shortcuts here.') + '\n\n' +
            _('• Favorite App (in popup):') + ' ' + _('Always tries to launch a new window or instance.') + '\n' +
            _('• Window List & Favorite Shortcut:') + ' ' + _('Brings an open window into focus, or launches the app if it’s not running.');
        const favoritesGroup = new Adw.PreferencesGroup({ title: _('Favorite Applications & Global Shortcuts'), description });
        page.add(favoritesGroup);
        const scrolledWindow = new Gtk.ScrolledWindow({ vexpand: true, min_content_height: 400, hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.AUTOMATIC });
        favoritesGroup.add(scrolledWindow);
        const listBox = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list'] });
        scrolledWindow.set_child(listBox);

        const populateList = () => {
            let child;
            while ((child = listBox.get_row_at_index(0))) listBox.remove(child);
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
                const shortcutAndEditBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true, halign: Gtk.Align.END });
                const shortcutKey = `shortcut-${index}`;
                const currentShortcut = this._settings.get_strv(shortcutKey)[0] || _('Unassigned');
                const shortcutLabel = new Gtk.Label({ label: currentShortcut, css_classes: ['dim-label'], hexpand: true, xalign: 1 });
                shortcutAndEditBox.append(shortcutLabel);
                const editButton = new Gtk.Button({ icon_name: 'edit-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Set custom shortcut'), css_classes: ['flat'] });
                editButton.connect('clicked', () => {
                    const dialog = new KeybindingDialog({ transient_for: this._window });
                    dialog.setTargetName(appInfo.get_display_name());
                    dialog.setCurrentShortcut(currentShortcut === _('Unassigned') ? '' : currentShortcut);
                    dialog.connect('response', (dlg, response) => {
                        if (response === Gtk.ResponseType.OK) {
                            const newShortcut = dlg.get_shortcut();
                            this._settings.set_strv(shortcutKey, newShortcut ? [newShortcut] : []);
                        }
                        dlg.destroy();
                    });
                    dialog.show();
                });
                shortcutAndEditBox.append(editButton);
                row.add_suffix(shortcutAndEditBox);
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

    // ★ 修正点: ページ全体の構造を新しい仕様に合わせて作り直す
    _buildActionsPage() {
        const page = new Adw.PreferencesPage({ title: _('Actions'), icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic' });

        // --- Global Shortcuts (設定可能) ---
        const globalGroup = new Adw.PreferencesGroup({ title: _('Global Shortcuts') });
        page.add(globalGroup);
        this._createShortcutRow(globalGroup, _('Open Popup Menu'), 'open-popup-shortcut');

        // --- Favorites Bar (ハードコード) ---
        const favGroup = new Adw.PreferencesGroup({ title: _('Favorites Bar') });
        page.add(favGroup);

        const favNavRow = new Adw.ActionRow({ title: _('Navigate Left / Right') });
        favNavRow.add_suffix(new Gtk.Label({ label: 'Left / Right', css_classes: ['heading'] }));
        favGroup.add(favNavRow);

        const favLaunchRow = new Adw.ActionRow({ title: _('Launch New Instance') });
        favLaunchRow.add_suffix(new Gtk.Label({ label: 'Enter (Return)', css_classes: ['heading'] }));
        favGroup.add(favLaunchRow);

        // --- Window List (ハードコード) ---
        const winGroup = new Adw.PreferencesGroup({ title: _('Window List') });
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

        return page;
    }

    // このヘルパー関数は変更なし
    _createShortcutRow(group, title, settingKey) {
        const row = new Adw.ActionRow({ title });
        group.add(row);
        const shortcutLabel = new Gtk.Label({ css_classes: ['dim-label'] });
        row.add_suffix(shortcutLabel);
        const updateLabel = () => {
            const shortcut = this._settings.get_strv(settingKey)[0] || _('Unassigned');
            shortcutLabel.set_label(shortcut);
        };
        const id = this._settings.connect(`changed::${settingKey}`, updateLabel);
        this._activeConnections.push({ source: this._settings, id });
        updateLabel();
        const editButton = new Gtk.Button({ icon_name: 'edit-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'] });
        row.add_suffix(editButton);
        editButton.connect('clicked', () => {
            const currentShortcut = this._settings.get_strv(settingKey)[0];
            const dialog = new KeybindingDialog({ transient_for: this._window });
            dialog.setTargetName(title);
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
    }

    _buildDisplayPage() {
        // in _buildDisplayPage()
        const page = new Adw.PreferencesPage({ title: _('Display'), icon_name: 'video-display-symbolic' }); const displayGroup = new Adw.PreferencesGroup({ title: _('Panel Item Positions') });
        page.add(displayGroup);

        const indicatorPosRow = new Adw.ComboRow({
            title: _('Main Icon Group Position'),
            subtitle: _('Position of the main icon and the window icon list'),
            model: Gtk.StringList.new(['left', 'center', 'right']),
            selected: ['left', 'center', 'right'].indexOf(this._settings.get_string('main-icon-position'))
        });
        indicatorPosRow.connect('notify::selected', () => {
            this._settings.set_string('main-icon-position', ['left', 'center', 'right'][indicatorPosRow.get_selected()]);
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
            model: Gtk.StringList.new(['left', 'center', 'right']),
            selected: ['left', 'center', 'right'].indexOf(this._settings.get_string('date-menu-position'))
        });
        dateMenuPosRow.connect('notify::selected', () => {
            this._settings.set_string('date-menu-position', ['left', 'center', 'right'][dateMenuPosRow.get_selected()]);
        });
        displayGroup.add(dateMenuPosRow);

        const dateMenuRankRow = new Adw.SpinRow({
            title: _('Date/Time Menu Rank'),
            subtitle: _('Adjusts the order within the panel section.'),
            adjustment: new Gtk.Adjustment({ lower: -100, upper: 100, step_increment: 1 })
        });
        this._settings.bind('date-menu-rank', dateMenuRankRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(dateMenuRankRow);

        const otherOptionsGroup = new Adw.PreferencesGroup({ title: _('Other Options') });
        page.add(otherOptionsGroup);

        const showWindowIconListRow = new Adw.SwitchRow({
            title: _('Show Window Icon List on Panel'),
            subtitle: _('Displays open window icons next to the main indicator')
        });
        this._settings.bind('show-window-icon-list', showWindowIconListRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        otherOptionsGroup.add(showWindowIconListRow);

        const forceHideOverviewRow = new Adw.SwitchRow({
            title: _('Force to Hide Overview at Start-up'),
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