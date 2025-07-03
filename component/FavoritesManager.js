// component/FavoritesManager.js

import Shell from 'gi://Shell';
import { Timeline, Now, combineLatestWith } from '../timeline.js';

const log = (message) => {
    console.log(`[AIO-Validator/FavManager] ${message}`);
};

/**
 * @param {Timeline<Array<string>>} favoritesTimeline
 * @param {Timeline<boolean>} showOverviewButtonTimeline
 * @returns {{
 * favoritesData: Timeline<Array>,
 * launchAppTimeline: Timeline<string|null>,
 * selectedFavoriteIdTimeline: Timeline<string|null>,
 * handleFavLaunch: () => void,
 * destroy: () => void
 * }}
 */
export function createFavoritesManager(favoritesTimeline, showOverviewButtonTimeline) {
    log('Initializing...');

    const selectedFavoriteIdTimeline = Timeline(null);
    const launchAppTimeline = Timeline(null);

    const handleFavLaunch = () => {
        const appId = selectedFavoriteIdTimeline.at(Now);
        if (appId) launchAppTimeline.define(Now, appId);
    };

    const favoritesData = combineLatestWith(
        (favoriteAppIds, showOverview) => {
            const data = [];
            if (showOverview) {
                data.push({ type: 'overview' });
            }
            favoriteAppIds.forEach(appId => {
                const app = Shell.AppSystem.get_default().lookup_app(appId);
                if (app) {
                    data.push({
                        type: 'favorite',
                        appId: appId,
                        gicon: app.get_icon(),
                        name: app.get_name(),
                    });
                }
            });
            return data;
        }
    )(favoritesTimeline, showOverviewButtonTimeline);

    const destroy = () => {
        log('Destroying FavoritesManager...');
        if (favoritesData && typeof favoritesData.destroy === 'function') {
            favoritesData.destroy();
        }
    };

    return {
        favoritesData,
        launchAppTimeline,
        selectedFavoriteIdTimeline,
        handleFavLaunch,
        destroy
    };
}
