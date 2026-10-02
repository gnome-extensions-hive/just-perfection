import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {API} from '../src/lib/API.js';
import {Manager} from '../src/lib/Manager.js';

const schema = readFileSync(new URL(
    '../src/schemas/org.gnome.shell.extensions.just-perfection.gschema.xml',
    import.meta.url
), 'utf8');
const defaults = new Map();
const ranges = new Map();

for (const match of schema.matchAll(/<key type="([bi])" name="([^"]+)">([\s\S]*?)<\/key>/g)) {
    const [, type, key, body] = match;
    const value = body.match(/<default>(.*?)<\/default>/)[1];
    defaults.set(key, type === 'b' ? value === 'true' : Number(value));
    const range = body.match(/<range min="(\d+)" max="(\d+)"\/>/);
    if (range) {
        ranges.set(key, [Number(range[1]), Number(range[2])]);
    }
}

const unmanaged = ['panel-corner-size', 'support-notifier-type', 'support-notifier-showed-version'];
const managedKeys = [...defaults.keys()].filter(key => !unmanaged.includes(key)).sort();
const restoredCalls = [
    ['UIStyleClassRemove', 'just-perfection'],
    ['panelShow'],
    ['searchEntryShow', false],
    ['dashShow'],
    ['OSDEnable'],
    ['workspaceSwitcherShow'],
    ['workspacePopupEnable'],
    ['backgroundMenuEnable'],
    ['activitiesButtonShow'],
    ['dateMenuShow'],
    ['keyboardLayoutShow'],
    ['accessibilityMenuShow'],
    ['quickSettingsMenuShow'],
    ['quickSettingsDarkStyleToggleShow'],
    ['quickSettingsBacklightToggleShow'],
    ['quickSettingsNightLightToggleShow'],
    ['quickSettingsDoNotDisturbToggleShow'],
    ['quickSettingsAirplaneModeToggleShow'],
    ['windowPickerIconEnable'],
    ['startSearchEnable'],
    ['workspaceSwitcherSetDefaultSize'],
    ['powerIconShow'],
    ['panelSetPosition', 0],
    ['panelNotificationIconEnable'],
    ['clockMenuPositionSetDefault'],
    ['showAppsButtonEnable'],
    ['animationSpeedSetDefault'],
    ['enableAnimationsSetDefault'],
    ['windowDemandsAttentionFocusDisable'],
    ['windowMaximizedOnCreateDisable'],
    ['dashIconSizeSetDefault'],
    ['startupStatusSetDefault'],
    ['workspacesInAppGridEnable'],
    ['notificationBannerPositionSetDefault'],
    ['workspaceSwitcherShouldShowSetDefault'],
    ['panelSetDefaultSize'],
    ['panelButtonHpaddingSetDefault'],
    ['panelIndicatorPaddingSetDefault'],
    ['windowPreviewCaptionEnable'],
    ['windowPreviewCloseButtonEnable'],
    ['workspaceBackgroundRadiusSetDefault'],
    ['workspaceWraparoundDisable'],
    ['rippleBoxEnable'],
    ['doubleSuperToAppGridEnable'],
    ['unblockOverlayKey'],
    ['switcherPopupDelaySetDefault'],
    ['worldClocksShow'],
    ['weatherShow'],
    ['panelIconSetDefaultSize'],
    ['eventsButtonShow'],
    ['calendarShow'],
    ['dashSeparatorShow'],
    ['lookingGlassSetDefaultSize'],
    ['osdPositionSetDefault'],
    ['windowMenuShow'],
    ['screenshotInWindowMenuShow'],
    ['altTabWindowPreviewSetDefaultSize'],
    ['altTabSmallIconSetDefaultSize'],
    ['altTabIconSetDefaultSize'],
    ['screenSharingIndicatorEnable'],
    ['screenRecordingIndicatorEnable'],
    ['controlsManagerSpacingSetDefault'],
    ['workspacesViewSpacingSetDefault'],
    ['dashAppRunningDotShow'],
    ['setMaxDisplayedSearchResultToDefault'],
    ['accentColorIconDisable'],
    ['workspaceThumbnailClickToDefault'],
    ['revertCalendarColumnItemsToDefault'],
];

function sorted(calls)
{
    return [...calls].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function fixture(overrides = {})
{
    const values = new Map(defaults);
    const connections = new Map();
    const calls = [];
    const events = [];
    const api = {};

    for (const name of Object.getOwnPropertyNames(API.prototype)) {
        if (name !== 'constructor' && typeof API.prototype[name] === 'function') {
            api[name] = (...args) =>
            {
                calls.push([name, ...args]);
                events.push('api');
            };
        }
    }

    function read(key, type)
    {
        assert.ok(values.has(key), `Unknown settings key: ${key}`);
        const value = values.get(key);
        assert.equal(typeof value, type, `Wrong settings getter for ${key}`);
        return value;
    }

    function set(key, value)
    {
        assert.ok(defaults.has(key), `Unknown settings key: ${key}`);
        assert.equal(typeof value, typeof defaults.get(key));
        if (typeof value === 'number') {
            assert.ok(Number.isInteger(value));
            const range = ranges.get(key);
            assert.ok(!range || (value >= range[0] && value <= range[1]));
        }
        values.set(key, value);
    }

    const settings = {
        get_boolean: key => read(key, 'boolean'),
        get_int: key => read(key, 'number'),
        connectObject(signal, callback, owner)
        {
            assert.ok(signal.startsWith('changed::'));
            assert.ok(defaults.has(signal.slice('changed::'.length)));
            assert.ok(!connections.has(signal), `Duplicate subscription: ${signal}`);
            connections.set(signal, {callback, owner});
            events.push('connect');
        },
        disconnectObject(owner)
        {
            events.push('disconnect');
            for (const [signal, connection] of connections) {
                if (connection.owner === owner) {
                    connections.delete(signal);
                }
            }
        },
    };

    for (const [key, value] of Object.entries(overrides)) {
        set(key, value);
    }

    const manager = new Manager({API: api, Settings: settings});
    return {
        manager, calls, events, connections, set,
        change(key, value)
        {
            set(key, value);
            connections.get(`changed::${key}`)?.callback();
        },
    };
}

test('start registers all managed settings before applying schema defaults', () =>
{
    const f = fixture();
    assert.deepEqual(f.events, []);
    f.manager.start();
    assert.deepEqual([...f.connections.keys()].sort(), managedKeys.map(key => `changed::${key}`));
    for (const connection of f.connections.values()) {
        assert.equal(connection.owner, f.manager);
    }
    assert.deepEqual(f.events.slice(0, managedKeys.length), managedKeys.map(() => 'connect'));
    assert.ok(f.events.slice(managedKeys.length).every(event => event === 'api'));

    const initialOverrides = new Map([
        ['clockMenuPositionSetDefault', ['clockMenuPositionSet', 0, 0]],
        ['enableAnimationsSetDefault', ['enableAnimationsSet', true]],
        ['startupStatusSetDefault', ['startupStatusSet', 1]],
        ['notificationBannerPositionSetDefault', ['notificationBannerPositionSet', 1]],
        ['lookingGlassSetDefaultSize', ['lookingGlassSetSize', null, null]],
    ]);
    const expected = restoredCalls.map(call => initialOverrides.get(call[0]) ?? call);
    assert.deepEqual(sorted(f.calls), sorted(expected));
});

test('stop disconnects its owner before restoring every default despite user overrides', () =>
{
    const overrides = Object.fromEntries(managedKeys.map(key =>
        [key, typeof defaults.get(key) === 'boolean' ? !defaults.get(key) :
            Math.min(2, ranges.get(key)?.[1] ?? 2)]));
    const f = fixture(overrides);
    f.manager.start();
    f.calls.length = 0;
    f.events.length = 0;
    f.manager.stop();
    assert.equal(f.connections.size, 0);
    assert.equal(f.events[0], 'disconnect');
    assert.ok(f.events.slice(1).every(event => event === 'api'));
    assert.deepEqual(sorted(f.calls), sorted(restoredCalls));
});

for (const key of managedKeys) {
    test(`changed::${key} reaches an API action and is disconnected on stop`, () =>
    {
        const f = fixture();
        f.manager.start();
        f.calls.length = 0;
        const value = defaults.get(key);
        f.change(key, typeof value === 'boolean' ? !value : (value === 0 ? 1 : 0));
        assert.ok(f.calls.length > 0);
        f.manager.stop();
        f.calls.length = 0;
        f.change(key, value);
        assert.deepEqual(f.calls, []);
    });
}

const changes = [
    ['panel', false, [['panelHide', 0]]],
    ['panel-in-overview', true, [['panelHide', 1]], {panel: false}],
    ['panel-in-overview', true, [['panelShow']]],
    ['dash', false, [['dashHide']]],
    ['theme', true, [['UIStyleClassAdd', 'just-perfection']]],
    ['clock-menu-position', 2, [['clockMenuPositionSet', 2, 3]],
        {'clock-menu-position-offset': 3}],
    ['clock-menu-position-offset', 4, [['clockMenuPositionSet', 1, 4]],
        {'clock-menu-position': 1}],
    ['workspace-switcher-size', 25, [['workspaceSwitcherSetSize', 0.25]]],
    ['panel-size', 32, [['panelSetSize', 32, false]]],
    ['panel-button-padding-size', 1, [['panelButtonHpaddingSizeSet', 0]]],
    ['panel-indicator-padding-size', 5, [['panelIndicatorPaddingSizeSet', 4]]],
    ['workspace-background-corner-size', 1, [['workspaceBackgroundRadiusSet', 0]]],
    ['looking-glass-width', 7, [['lookingGlassSetSize', 0.7, null]]],
    ['looking-glass-height', 6, [['lookingGlassSetSize', 0.7, 0.6]],
        {'looking-glass-width': 7}],
    ['osd-position', 1, [['osdPositionSet', 0]]],
    ['overlay-key', false, [['doubleSuperToAppGridEnable'], ['blockOverlayKey']]],
    ['double-super-to-appgrid', false,
        [['unblockOverlayKey'], ['doubleSuperToAppGridDisable']]],
    ['double-super-to-appgrid', false,
        [['doubleSuperToAppGridEnable'], ['blockOverlayKey']], {'overlay-key': false}],
];

for (const [key, value, expected, overrides] of changes) {
    test(`${key}=${value} routes correct arguments with ${JSON.stringify(overrides ?? {})}`, () =>
    {
        const f = fixture(overrides);
        f.manager.start();
        f.calls.length = 0;
        f.change(key, value);
        assert.deepEqual(f.calls, expected);
    });
}

const animationCalls = [
    [['animationSpeedSetDefault'], ['enableAnimationsSet', false]],
    [['animationSpeedSetDefault'], ['enableAnimationsSet', true]],
    ...[0.01, 0.2, 0.6, 0.8, 1.3, 1.6, 2.8].map(factor =>
        [['animationSpeedSet', factor], ['enableAnimationsSet', true]]),
];

for (const [value, expected] of animationCalls.entries()) {
    test(`animation=${value} sets speed and enabled state`, () =>
    {
        const f = fixture();
        f.manager.start();
        f.calls.length = 0;
        f.change('animation', value);
        assert.deepEqual(f.calls, expected);
    });
}

test('a fresh start after stop reconnects callbacks and reapplies current values', () =>
{
    const f = fixture();
    f.manager.start();
    f.manager.stop();
    f.change('dash', false);
    f.calls.length = 0;
    f.manager.start();
    assert.equal(f.connections.size, managedKeys.length);
    assert.ok(f.calls.some(call => call[0] === 'dashHide'));
    f.calls.length = 0;
    f.change('dash', true);
    assert.deepEqual(f.calls, [['dashShow']]);
    f.manager.stop();
    assert.equal(f.connections.size, 0);
});
