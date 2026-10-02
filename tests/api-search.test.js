import assert from 'node:assert/strict';
import {test} from 'node:test';

import {API} from '../src/lib/API.js';

const noSearch = 'just-perfection-api-no-search';
const typeToSearch = 'just-perfection-api-type-to-search';
const appGrid = 2;

function createFixture(shellVersion)
{
    const classes = new Set();
    const parentAnimations = [];
    const entryAnimations = [];
    const connections = new Map();
    const disconnected = [];
    let nextSignal = 1;
    const parent = {
        height: -1,
        ease(options)
        {
            parentAnimations.push(options);
        },
    };
    const entry = {
        height: 32,
        opacity: 255,
        visible: true,
        get_parent()
        {
            return parent;
        },
        show()
        {
            this.visible = true;
        },
        hide()
        {
            this.visible = false;
        },
        ease(options)
        {
            entryAnimations.push(options);
        },
    };
    const controller = {
        searchActive: false,
        connect(signal, callback)
        {
            assert.equal(signal, 'notify::search-active');
            const id = nextSignal++;
            connections.set(id, callback);
            return id;
        },
        disconnect(id)
        {
            assert.ok(connections.delete(id));
            disconnected.push(id);
        },
    };
    const layout = {
        _computeWorkspacesBoxForState(state, box, searchHeight, ...args)
        {
            assert.equal(this, layout);
            box.searchHeight = searchHeight;
            box.args = args;
            return box;
        },
    };
    const originalStartSearch = function () {};
    class SearchController
    {
    }
    SearchController.prototype.startSearch = originalStartSearch;
    const api = new API({
        Main: {
            layoutManager: {
                uiGroup: {
                    add_style_class_name(name)
                    {
                        classes.add(name);
                    },
                    remove_style_class_name(name)
                    {
                        classes.delete(name);
                    },
                    has_style_class_name(name)
                    {
                        return classes.has(name);
                    },
                },
            },
            overview: {
                searchEntry: entry,
                dash: {showAppsButton: {}},
                _overview: {
                    _controls: {layout_manager: layout},
                    controls: {_searchController: controller},
                },
            },
        },
        Clutter: {AnimationMode: {EASE: 1}},
        OverviewControls: {ControlsState: {APP_GRID: appGrid}},
        SearchController: {SearchController},
    }, shellVersion);

    function emitSearch(active)
    {
        controller.searchActive = active;
        for (const callback of connections.values()) {
            callback();
        }
    }

    return {
        api, classes, entry, parent, parentAnimations, entryAnimations, layout,
        connections, disconnected, SearchController, originalStartSearch, emitSearch,
    };
}

for (const shellVersion of [45, 46, 47, 48, 49, 50, 51]) {
    test(`Shell ${shellVersion}: hide/show updates persistent visibility and animation`, () => {
        const fixture = createFixture(shellVersion);
        const {api, classes, entry, parent, parentAnimations, entryAnimations} = fixture;

        api.searchEntryHide(false);
        assert.equal(entry.visible, false);
        assert.equal(api._searchEntryVisibility, false);
        assert.ok(classes.has(noSearch));

        api.searchEntryShow(false);
        assert.equal(entry.visible, true);
        assert.equal(api._searchEntryVisibility, true);
        assert.equal(classes.has(noSearch), false);
        assert.equal(parent.height, 0);
        assert.equal(entry.opacity, 0);
        assert.equal(parentAnimations.length, 1);
        const animation = parentAnimations[0];
        assert.equal(animation.height, entry.height);
        assert.equal(animation.opacity, 255);
        assert.equal(animation.duration, 90);
        assert.equal(animation.mode, 1);

        animation.onStopped();
        assert.equal(parent.height, -1);
        assert.deepEqual(entryAnimations, [{opacity: 255, mode: 1, duration: 300}]);
    });

    test(`Shell ${shellVersion}: showing an already visible entry is a no-op`, () => {
        const {api, entry, parentAnimations} = createFixture(shellVersion);
        api.searchEntryShow(false);
        assert.equal(entry.visible, true);
        assert.equal(api._searchEntryVisibility, true);
        assert.equal(parentAnimations.length, 0);
    });

    test(`Shell ${shellVersion}: temporary hide/show preserves the configured visibility`, () => {
        const {api, entry} = createFixture(shellVersion);
        api.searchEntryHide(true);
        assert.equal(entry.visible, false);
        assert.equal(api._searchEntryVisibility, true);
        api.searchEntryShow(true);
        assert.equal(entry.visible, true);
        assert.equal(api._searchEntryVisibility, true);

        api.searchEntryHide(false);
        api.searchEntryShow(true);
        assert.equal(entry.visible, true);
        assert.equal(api._searchEntryVisibility, false);
        api.searchEntryHide(true);
        assert.equal(entry.visible, false);
        assert.equal(api._searchEntryVisibility, false);
    });

    test(`Shell ${shellVersion}: type-to-search temporarily reveals a hidden entry`, () => {
        const {api, entry, classes, emitSearch} = createFixture(shellVersion);
        api.searchEntryHide(false);
        api.startSearchEnable();

        emitSearch(true);
        assert.equal(entry.visible, true);
        assert.equal(api._searchEntryVisibility, false);
        assert.ok(classes.has(typeToSearch));
        assert.equal(classes.has(noSearch), false);

        emitSearch(false);
        assert.equal(entry.visible, false);
        assert.equal(api._searchEntryVisibility, false);
        assert.equal(classes.has(typeToSearch), false);
        assert.ok(classes.has(noSearch));
    });

    test(`Shell ${shellVersion}: search signals leave a configured visible entry alone`, () => {
        const {api, entry, classes, emitSearch, parentAnimations} = createFixture(shellVersion);
        api.startSearchEnable();
        emitSearch(true);
        emitSearch(false);
        assert.equal(entry.visible, true);
        assert.equal(api._searchEntryVisibility, true);
        assert.equal(classes.size, 0);
        assert.equal(parentAnimations.length, 0);
    });

    test(`Shell ${shellVersion}: search signals and startSearch override are reversible`, () => {
        const fixture = createFixture(shellVersion);
        const {api, connections, disconnected, SearchController, originalStartSearch} = fixture;
        api.startSearchEnable();
        api.startSearchEnable();
        assert.equal(connections.size, 1);
        api.startSearchDisable();
        assert.equal(connections.size, 0);
        assert.equal(disconnected.length, 1);
        assert.notEqual(SearchController.prototype.startSearch, originalStartSearch);
        api.startSearchDisable();
        assert.equal(disconnected.length, 1);

        api.startSearchEnable();
        assert.equal(connections.size, 1);
        assert.equal(SearchController.prototype.startSearch, originalStartSearch);
        api.startSearchDisable();
        assert.equal(connections.size, 0);
        assert.equal(disconnected.length, 2);
    });

    test(`Shell ${shellVersion}: app-grid spacing follows configured visibility`, () => {
        const {api, layout} = createFixture(shellVersion);
        api.searchEntryHide(false);
        const hiddenBox = {};
        assert.equal(
            layout._computeWorkspacesBoxForState(appGrid, hiddenBox, 32, 'extra'),
            hiddenBox
        );
        assert.equal(hiddenBox.searchHeight, 40);
        assert.deepEqual(hiddenBox.args, ['extra']);
        assert.equal(layout._computeWorkspacesBoxForState(1, {}, 32).searchHeight, 32);

        api.searchEntryShow(true);
        assert.equal(layout._computeWorkspacesBoxForState(appGrid, {}, 32).searchHeight, 40);
        api.searchEntryHide(true);
        api.searchEntryShow(false);
        assert.equal(layout._computeWorkspacesBoxForState(appGrid, {}, 32).searchHeight, 32);
    });
}
