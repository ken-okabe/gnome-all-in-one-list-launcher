import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';

/**
 * Manages the entire lifecycle of the panel icons container.
 * It is now responsible for CREATING the container, not just managing a pre-made class.
 */
export default function managePanelIcons() {
    // 1. Create the UI widget directly. This is the point of "birth".
    const iconsContainer = new St.BoxLayout({ style_class: 'panel-window-list', x_expand: true });

    // --- REMOVED: The side-effect of adding to the panel. ---
    // This is now handled by the main extension logic (the "assembler").
    // Main.panel.add_child(iconsContainer);

    // 2. Define its cleanup.
    const dispose = () => {
        iconsContainer.destroy();
    };

    // 3. Return the live instance and its dispose logic.
    return {
        instance: iconsContainer,
        dispose: dispose,
    };
}