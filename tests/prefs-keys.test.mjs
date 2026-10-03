import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

import {PrefsKeys} from '../src/lib/Prefs/PrefsKeys.js';

const schemaUrl = new URL('../src/schemas/', import.meta.url);
const schema = readFileSync(
    new URL('org.gnome.shell.extensions.just-perfection.gschema.xml', schemaUrl), 'utf8'
);
const schemaKeys = new Map(
    [...schema.matchAll(/<key type="([^"]+)" name="([^"]+)">([\s\S]*?)<\/key>/g)]
        .map(([, type, name, body]) => [name, {type, body}])
);
const pagesUrl = new URL('../src/data/ui/pages/', import.meta.url);
const widgets = new Map();
for (const filename of readdirSync(pagesUrl).filter(name => name.endsWith('.ui')))
{
    const page = readFileSync(new URL(filename, pagesUrl), 'utf8');
    for (const [, widgetType, id] of page.matchAll(/<object class="([^"]+)" id="([^"]+)"/g))
    {
        assert.ok(!widgets.has(id), `duplicate UI object: ${id}`);
        widgets.set(id, widgetType);
    }
}

const profileGroups = [
    [[true, false, false], [
        'panel', 'search', 'workspace', 'workspaces-in-app-grid', 'ripple-box',
        'window-picker-icon',
    ]],
    [[true, true, false], [
        'panel-in-overview', 'dash', 'osd', 'workspace-popup', 'background-menu',
        'window-preview-caption', 'window-preview-close-button', 'double-super-to-appgrid',
    ]],
    [[true, false, true], ['accessibility-menu', 'show-apps-button']],
    [[true, true, true], [
        'activities-button', 'clock-menu', 'keyboard-layout', 'quick-settings',
        'quick-settings-dark-mode', 'quick-settings-night-light', 'quick-settings-do-not-disturb',
        'quick-settings-backlight', 'quick-settings-airplane-mode', 'screen-sharing-indicator',
        'screen-recording-indicator', 'dash-separator', 'dash-app-running', 'world-clock',
        'weather', 'calendar', 'events-button', 'window-menu', 'window-menu-take-screenshot-button',
        'panel-notification-icon', 'power-icon', 'type-to-search', 'workspace-peek',
        'overlay-key', 'switcher-popup-delay',
    ]],
    [[false, true, true], ['window-demands-attention-focus', 'theme']],
    [[false, false, false], [
        'window-maximized-on-create', 'workspace-switcher-should-show', 'workspace-wrap-around',
        'workspace-thumbnail-to-main-view', 'accent-color-icon', 'invert-calendar-column-items',
    ]],
    [[1, 0, 0], ['startup-status']],
    [[0, 0, 22], ['controls-manager-spacing-size']],
    [[0, 0, 15], ['workspace-background-corner-size']],
    [[1, 1, 1], ['animation', 'notification-banner-position']],
    [[0, 1, 0], ['dash-icon-size']],
    [[0, 0, 0], [
        'top-panel-position', 'clock-menu-position', 'clock-menu-position-offset',
        'workspace-switcher-size', 'panel-size', 'panel-button-padding-size',
        'panel-indicator-padding-size', 'panel-icon-size', 'osd-position', 'looking-glass-width',
        'looking-glass-height', 'alt-tab-window-preview-size', 'alt-tab-small-icon-size',
        'alt-tab-icon-size', 'max-displayed-search-results',
    ]],
];
const expectedProfiles = new Map();
for (const [values, names] of profileGroups)
{
    for (const name of names)
    {
        assert.ok(!expectedProfiles.has(name), `duplicate profile fixture: ${name}`);
        expectedProfiles.set(name, Object.fromEntries(
            ['default', 'minimal', 'superminimal'].map((profile, index) => [profile, values[index]])
        ));
    }
}
expectedProfiles.set('support-notifier-type', {});

const expectedMaps = {
    'dash-icon-size': {'1': 16, '2': 22, '3': 24, '4': 32, '5': 40, '6': 48, '7': 56, '8': 64},
    'alt-tab-window-preview-size': {'0': 0, '1': 32, '2': 64, '3': 128, '4': 256, '5': 512},
    'alt-tab-small-icon-size': {'0': 0, '1': 32, '2': 64, '3': 128, '4': 256, '5': 512},
    'alt-tab-icon-size': {'0': 0, '1': 32, '2': 64, '3': 128, '4': 256, '5': 512},
};
const expectedNames = [...schemaKeys.keys()].filter(
    name => !['panel-corner-size', 'support-notifier-showed-version'].includes(name)
).sort();

test('profile fixtures cover every exposed schema key', () =>
{
    assert.deepEqual([...expectedProfiles.keys()].sort(), expectedNames);
});

for (const version of [45, 46, 47, 48, 49, 50, 51])
{
    test(`Shell ${version}: complete preference metadata contracts`, () =>
    {
        const keys = new PrefsKeys(version).keys;
        assert.deepEqual(Object.values(keys).map(key => key.name).sort(), expectedNames);
        const widgetIds = Object.values(keys).map(key => key.widgetId);
        assert.equal(new Set(widgetIds).size, expectedNames.length);

        for (const [id, key] of Object.entries(keys))
        {
            const label = `Shell ${version}, ${key.name}`;
            const definition = schemaKeys.get(key.name);
            const widgetType = definition.type === 'b' ? 'GtkSwitch'
                : key.name === 'clock-menu-position-offset' ? 'AdwSpinRow' : 'AdwActionRow';
            const widgetId = `${key.name.replaceAll('-', '_')}_`
                + (widgetType === 'GtkSwitch' ? 'switch' : 'row');
            assert.equal(id, key.name.replaceAll('-', '_'), label);
            assert.equal(key.id, id, label);
            assert.equal(key.widgetType, widgetType, label);
            assert.equal(key.widgetId, widgetId, label);
            assert.equal(widgets.get(widgetId),
                widgetType === 'AdwActionRow' ? 'AdwComboRow' : widgetType, label);
            assert.deepEqual(key.profiles, expectedProfiles.get(key.name), label);
            assert.deepEqual(key.maps, expectedMaps[key.name] ?? {}, label);

            const supported = key.name === 'accent-color-icon' ? version >= 47
                : key.name === 'quick-settings-do-not-disturb' ? version >= 49 : true;
            assert.equal(key.supported, supported, label);

            for (const value of Object.values(key.profiles))
            {
                assert.equal(typeof value, definition.type === 'b' ? 'boolean' : 'number', label);
            }
            if (definition.type === 'i')
            {
                const range = definition.body.match(/<range min="(\d+)" max="(\d+)"\/>/);
                assert.ok(range, `${label}: integer range exists`);
                const values = [
                    ...Object.values(key.maps),
                    ...Object.values(key.profiles).map(value => key.maps[value] ?? value),
                ];
                for (const value of values)
                {
                    assert.ok(Number.isInteger(value), label);
                    assert.ok(value >= Number(range[1]) && value <= Number(range[2]), label);
                }
            }
        }
    });
}

for (const [name, threshold] of [
    ['accent-color-icon', 47],
    ['quick-settings-do-not-disturb', 49],
])
{
    test(`${name}: support changes exactly at Shell ${threshold}`, () =>
    {
        const id = name.replaceAll('-', '_');
        for (const version of [threshold - 1, threshold - 0.1, threshold, threshold + 0.1])
        {
            assert.equal(new PrefsKeys(version).keys[id].supported, version >= threshold);
        }
    });
}

test('instances do not share keys, profiles, or maps', () =>
{
    const first = new PrefsKeys(45).keys;
    const second = new PrefsKeys(51).keys;
    for (const id of Object.keys(first))
    {
        assert.notEqual(first[id], second[id], id);
        assert.notEqual(first[id].profiles, second[id].profiles, id);
        assert.notEqual(first[id].maps, second[id].maps, id);
    }
    first.panel.profiles.default = false;
    first.dash_icon_size.maps['1'] = 999;
    delete first.panel;
    assert.equal(second.panel.profiles.default, true);
    assert.equal(second.dash_icon_size.maps['1'], 16);
    assert.deepEqual(new PrefsKeys(51).keys, second);
});
