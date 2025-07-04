import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';

/**
 * Manages the entire lifecycle of the AppMenuButton.
 * It is now responsible for CREATING the button, not just managing a pre-made class.
 */
export default function manageAppMenuButton() {
    // 1. Create the UI instance here. This is the point of "birth".
    const appMenuButton = new PanelMenu.Button(0.5, 'FP AppMenu');
    appMenuButton.add_child(new St.Icon({ icon_name: 'view-app-grid-symbolic' }));

    // 2. Create its internal structure.
    const mainBox = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 8px;' });
    appMenuButton.menu.box.add_child(mainBox);

    // --- REMOVED: The side-effect of adding to the panel. ---
    // This is now handled by the main extension logic (the "assembler").
    // Main.panel.addToStatusArea(uuid, appMenuButton);

    // 4. Define its cleanup.
    const dispose = () => {
        appMenuButton.destroy();
    };

    // 5. Return the live instance AND its parts for other components to use.
    return {
        instance: appMenuButton,
        mainBox: mainBox, // Expose mainBox for favBarManager
        dispose: dispose,
    };
}