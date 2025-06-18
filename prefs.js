import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AllWindowsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._favoritesSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

        const page = new Adw.PreferencesPage({
            title: _('All Windows Settings'),
            icon_name: 'applications-system-symbolic',
        });
        window.add(page);

        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display Settings'),
        });
        page.add(displayGroup);

        // Fix: Indicator Position setting
        const indicatorPosRow = new Adw.ComboRow({
            title: _('Indicator Position'),
            model: Gtk.StringList.new(['left', 'center', 'right']),
        });
        displayGroup.add(indicatorPosRow);

        // Correct binding method
        const indicatorPos = this._settings.get_string('indicator-position');
        const indicatorIndex = ['left', 'center', 'right'].indexOf(indicatorPos);
        indicatorPosRow.set_selected(indicatorIndex >= 0 ? indicatorIndex : 1); // Default is center

        indicatorPosRow.connect('notify::selected', () => {
            const selectedIndex = indicatorPosRow.get_selected();
            const positions = ['left', 'center', 'right'];
            this._settings.set_string('indicator-position', positions[selectedIndex]);
        });

        // Fix: Date Menu Position setting
        const dateMenuPosRow = new Adw.ComboRow({
            title: _('Date/Time Menu Position'),
            model: Gtk.StringList.new(['left', 'center', 'right']),
        });
        displayGroup.add(dateMenuPosRow);

        const dateMenuPos = this._settings.get_string('date-menu-position');
        const dateMenuIndex = ['left', 'center', 'right'].indexOf(dateMenuPos);
        dateMenuPosRow.set_selected(dateMenuIndex >= 0 ? dateMenuIndex : 2); // Default is right

        dateMenuPosRow.connect('notify::selected', () => {
            const selectedIndex = dateMenuPosRow.get_selected();
            const positions = ['left', 'center', 'right'];
            this._settings.set_string('date-menu-position', positions[selectedIndex]);
        });

        const showOverviewRow = new Adw.SwitchRow({
            title: _('Show overview at start-up'),
        });
        displayGroup.add(showOverviewRow);
        this._settings.bind('show-overview-at-startup', showOverviewRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const favoritesGroup = new Adw.PreferencesGroup({
            title: _('Favorites Order'),
            description: _('Use the arrow buttons to reorder applications.'),
        });
        page.add(favoritesGroup);

        this._listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        favoritesGroup.add(this._listBox);

        this._favoritesSettings.connect('changed::favorite-apps', () => this._populateList());
        this._populateList();

        window.connect('close-request', () => {
            this._settings = null;
            this._favoritesSettings = null;
        });
    }

    _populateList() {
        // Fix: Replace old get_children() with GTK4-compliant remove() loop
        let child;
        while ((child = this._listBox.get_row_at_index(0))) {
            this._listBox.remove(child);
        }

        const favorites = this._favoritesSettings.get_strv('favorite-apps');
        const appInfos = new Map(
            Gio.AppInfo.get_all().map(app => [app.get_id(), app])
        );

        favorites.forEach((appId, index) => {
            const appInfo = appInfos.get(appId);
            if (!appInfo) return;

            const row = new Adw.ActionRow({
                title: appInfo.get_display_name(),
            });

            row.add_prefix(new Gtk.Image({
                gicon: appInfo.get_icon(),
                pixel_size: 32,
            }));

            const upButton = new Gtk.Button({
                icon_name: 'go-up-symbolic',
                valign: Gtk.Align.CENTER,
                sensitive: index > 0,
            });
            upButton.connect('clicked', () => this._moveItem(index, index - 1));
            row.add_suffix(upButton);

            const downButton = new Gtk.Button({
                icon_name: 'go-down-symbolic',
                valign: Gtk.Align.CENTER,
                sensitive: index < favorites.length - 1,
            });
            downButton.connect('clicked', () => this._moveItem(index, index + 1));
            row.add_suffix(downButton);

            this._listBox.append(row);
        });
    }

    _moveItem(oldIndex, newIndex) {
        const favorites = this._favoritesSettings.get_strv('favorite-apps');
        const newFavorites = [...favorites];

        const [movedItem] = newFavorites.splice(oldIndex, 1);
        newFavorites.splice(newIndex, 0, movedItem);

        this._favoritesSettings.set_strv('favorite-apps', newFavorites);
    }
}