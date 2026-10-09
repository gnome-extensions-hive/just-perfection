import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';

const sourceUrl = new URL('../src/prefs.js', import.meta.url);
let fixtureNumber = 0;

async function createFixture(version = '49.2', failAt)
{
    const events = [];
    const instances = {builders: [], providers: [], keys: [], controllers: []};
    const failure = new Error(`failure at ${failAt}`);

    function record(stage, value)
    {
        events.push(stage);
        if (stage === failAt)
        {
            throw failure;
        }
        return value;
    }

    class Builder
    {
        constructor()
        {
            record('builder');
            instances.builders.push(this);
        }
    }

    class CssProvider
    {
        constructor()
        {
            record('css');
            instances.providers.push(this);
        }
    }

    class PrefsKeys
    {
        constructor(shellVersion)
        {
            record('keys');
            this.shellVersion = shellVersion;
            instances.keys.push(this);
        }
    }

    class Prefs
    {
        constructor(dependencies, prefsKeys, shellVersion)
        {
            record('prefs');
            Object.assign(this, {dependencies, prefsKeys, shellVersion, calls: []});
            instances.controllers.push(this);
        }

        fillPrefsWindow(...args)
        {
            record('fill');
            this.calls.push(args);
        }
    }

    class ExtensionPreferences
    {
        getSettings()
        {
            return record('settings', this.settings);
        }
    }

    const modules = {
        Adw: {},
        Gtk: {Builder, CssProvider},
        Gdk: {},
        Gio: {},
        GLib: {},
        Prefs,
        PrefsKeys,
        ExtensionPreferences,
    };
    const key = `prefs-entrypoint-${++fixtureNumber}`;
    globalThis[Symbol.for(key)] = modules;
    const readModules = `const modules = globalThis[Symbol.for(${JSON.stringify(key)})];`;
    const mocks = new Map();
    for (const name of ['Adw', 'Gtk', 'Gdk', 'Gio', 'GLib'])
    {
        mocks.set(`gi://${name}`, `${readModules} export default modules.${name};`);
    }
    mocks.set('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js',
        `${readModules} export const ExtensionPreferences = modules.ExtensionPreferences;`);
    mocks.set('resource:///org/gnome/Shell/Extensions/js/misc/config.js',
        `export const PACKAGE_VERSION = ${JSON.stringify(version)};`);
    mocks.set('./lib/Prefs/Prefs.js', `${readModules} export const Prefs = modules.Prefs;`);
    mocks.set('./lib/Prefs/PrefsKeys.js',
        `${readModules} export const PrefsKeys = modules.PrefsKeys;`);

    const hooks = registerHooks({
        resolve(specifier, context, nextResolve)
        {
            if (context.parentURL === `${sourceUrl}?fixture=${key}` && mocks.has(specifier))
            {
                const source = `${mocks.get(specifier)}\n// ${key}`;
                return {
                    url: `data:text/javascript,${encodeURIComponent(source)}`,
                    shortCircuit: true,
                };
            }
            return nextResolve(specifier, context);
        },
    });

    let EntryPoint;
    try
    {
        ({default: EntryPoint} = await import(`${sourceUrl}?fixture=${key}`));
    }
    finally
    {
        hooks.deregister();
        delete globalThis[Symbol.for(key)];
    }

    function createOwner(path = '/extension with spaces', domain = 'just-perfection')
    {
        const owner = new EntryPoint();
        Object.assign(owner, {path, metadata: {'gettext-domain': domain}, settings: {}});
        return owner;
    }

    return {events, instances, failure, modules, createOwner};
}

test('injects exact dependencies and forwards the original window, path and domain', async () =>
{
    const fixture = await createFixture();
    const owner = fixture.createOwner();
    const window = {};
    assert.equal(owner.fillPreferencesWindow(window), undefined);
    assert.deepEqual(fixture.events, ['keys', 'builder', 'settings', 'css', 'prefs', 'fill']);
    assert.equal(fixture.instances.controllers.length, 1);
    const [controller] = fixture.instances.controllers;
    assert.deepEqual(Object.keys(controller.dependencies).sort(),
        ['Adw', 'Builder', 'CssProvider', 'GLib', 'Gdk', 'Gio', 'Gtk', 'Settings'].sort());
    for (const name of ['Adw', 'Gtk', 'Gdk', 'Gio', 'GLib'])
    {
        assert.equal(controller.dependencies[name], fixture.modules[name]);
    }
    assert.equal(controller.dependencies.Builder, fixture.instances.builders[0]);
    assert.equal(controller.dependencies.CssProvider, fixture.instances.providers[0]);
    assert.equal(controller.dependencies.Settings, owner.settings);
    assert.equal(controller.prefsKeys, fixture.instances.keys[0]);
    assert.equal(controller.calls.length, 1);
    assert.equal(controller.calls[0][0], window);
    assert.deepEqual(controller.calls[0].slice(1), [owner.path, owner.metadata['gettext-domain']]);
});

for (const [version, expected] of [
    ['45.0', 45],
    ['47.12', 47.12],
    ['49.2', 49.2],
    ['50.beta', 50],
    ['51.rc', 51],
])
{
    test(`passes parsed Shell version ${version} to both constructors`, async () =>
    {
        const fixture = await createFixture(version);
        fixture.createOwner().fillPreferencesWindow({});
        assert.equal(fixture.instances.keys[0].shellVersion, expected);
        assert.equal(fixture.instances.controllers[0].shellVersion, expected);
    });
}

test('creates fresh collaborators and reads current settings for each window', async () =>
{
    const fixture = await createFixture();
    const owner = fixture.createOwner();
    const firstSettings = owner.settings;
    const windows = [{}, {}];
    owner.fillPreferencesWindow(windows[0]);
    owner.settings = {};
    owner.path = '/new/path';
    owner.metadata['gettext-domain'] = 'new-domain';
    owner.fillPreferencesWindow(windows[1]);
    for (const instances of Object.values(fixture.instances))
    {
        assert.equal(instances.length, 2);
        assert.notEqual(instances[0], instances[1]);
    }
    const [first, second] = fixture.instances.controllers;
    assert.equal(first.dependencies.Settings, firstSettings);
    assert.equal(second.dependencies.Settings, owner.settings);
    assert.equal(first.calls[0][0], windows[0]);
    assert.equal(second.calls[0][0], windows[1]);
    assert.deepEqual(second.calls[0].slice(1), ['/new/path', 'new-domain']);
    assert.equal(fixture.events.filter(event => event === 'settings').length, 2);
});

test('keeps settings and delegation isolated between owners', async () =>
{
    const fixture = await createFixture();
    const owners = [
        fixture.createOwner('/first', 'first-domain'),
        fixture.createOwner('/second', 'second-domain'),
    ];
    const windows = [{}, {}];
    owners.forEach((owner, index) => owner.fillPreferencesWindow(windows[index]));
    fixture.instances.controllers.forEach((controller, index) =>
    {
        assert.equal(controller.dependencies.Settings, owners[index].settings);
        assert.equal(controller.calls[0][0], windows[index]);
        assert.deepEqual(controller.calls[0].slice(1),
            [owners[index].path, owners[index].metadata['gettext-domain']]);
    });
});

const stages = ['keys', 'builder', 'settings', 'css', 'prefs', 'fill'];
for (const [index, stage] of stages.entries())
{
    test(`propagates ${stage} failures and does not execute later stages`, async () =>
    {
        const fixture = await createFixture('49.2', stage);
        const owner = fixture.createOwner();
        assert.throws(() => owner.fillPreferencesWindow({}), error => error === fixture.failure);
        assert.deepEqual(fixture.events, stages.slice(0, index + 1));
        assert.equal(fixture.instances.controllers.length, stage === 'fill' ? 1 : 0);
        if (stage === 'fill')
        {
            assert.deepEqual(fixture.instances.controllers[0].calls, []);
        }
    });
}
