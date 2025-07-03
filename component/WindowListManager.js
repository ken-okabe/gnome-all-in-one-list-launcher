// component/WindowListManager.js

import { combineLatestWith } from '../timeline.js';

const log = (message) => {
    console.log(`[AIO-Validator/WListManager] ${message}`);
};

function _sortWindowGroups(groups, favoriteAppIds) {
    const favoriteOrder = new Map(favoriteAppIds.map((id, index) => [id, index]));
    const originalOrder = new Map(groups.map((item, index) => [item, index]));
    groups.sort((a, b) => {
        const appIdA = a.app.get_id();
        const appIdB = b.app.get_id();
        const favIndexA = favoriteOrder.get(appIdA);
        const favIndexB = favoriteOrder.get(appIdB);
        const aIsFav = favIndexA !== undefined;
        const bIsFav = favIndexB !== undefined;
        if (aIsFav && !bIsFav) return -1;
        if (!aIsFav && bIsFav) return 1;
        if (aIsFav && bIsFav) return favIndexA - favIndexB;
        return originalOrder.get(a) - originalOrder.get(b);
    });
    return groups;
}

/**
 * @param {Timeline<Array>} windowsTimeline
 * @param {Timeline<Array<string>>} favoritesTimeline
 * @returns {{windowListData: Timeline<Array>, destroy: () => void}}
 */
export function createWindowListManager(windowsTimeline, favoritesTimeline) {
    log('Initializing...');
    const combinedTimeline = combineLatestWith(
        (windowGroups, favoriteAppIds) => ({ windowGroups, favoriteAppIds })
    )(windowsTimeline, favoritesTimeline);

    const windowListData = combinedTimeline.map(({ windowGroups, favoriteAppIds }) => {
        if (!windowGroups || windowGroups.length === 0) {
            return [{ type: 'no-windows', text: 'No open windows' }];
        }

        const sortedGroups = _sortWindowGroups([...windowGroups], favoriteAppIds);
        const listData = [];
        for (const group of sortedGroups) {
            listData.push({
                type: 'group-header',
                app: group.app,
                gicon: group.app.get_icon(),
                name: group.app.get_name(),
            });

            const sortedWindows = group.windows.sort(([winA], [winB]) => {
                return winA.get_frame_rect().y - winB.get_frame_rect().y;
            });

            for (const [metaWindow] of sortedWindows) {
                listData.push({
                    type: 'window-item',
                    metaWindow: metaWindow,
                    title: metaWindow.get_title() || '...',
                });
            }
        }
        return listData;
    });

    const destroy = () => {
        log('Destroying WindowListManager...');
        // combinedTimelineはwindowListDataに変換され、そのライフサイクルは
        // windowListDataに引き継がれる。windowListDataを破棄すればOK。
        if (windowListData && typeof windowListData.destroy === 'function') {
            windowListData.destroy();
        }
    };

    return { windowListData, destroy };
}
