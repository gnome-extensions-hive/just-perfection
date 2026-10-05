import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';

const sourceUrl = new URL('../src/extension.js', import.meta.url);
let fixtureId = 0;

async function createHarness({shellVersion = '51.2', extensionVersion = '37', failAt} = {})
{
    const id = ++fixtureId;
    const events = [];
    const instances = {API: [], Manager: [], SupportNotifier: []};
    const dependencies = new Map();
    const settings = {identity: 'extension settings'};
    const interfaceSettings = [];
    const registryKey = `extensionEntrypointFixture${id}`;

    function record(event)
    {
        events.push(event);
        if (event === failAt)
        {
            throw new Error(`Injected failure: ${event}`);
        }
    }

    function component(name, startMethod, stopMethod)
    {
        return class
        {
            constructor(...args)
            {
                this.args = args;
                this.stops = 0;
                this[startMethod] = () => record(`${name}.${startMethod}`);
                this[stopMethod] = () =>
                {
                    this.stops++;
                    record(`${name}.${stopMethod}`);
                };
                instances[name].push(this);
                record(`${name}.construct`);
            }
        };
    }

    const fixture = {
        API: component('API', 'open', 'close'),
        Manager: component('Manager', 'start', 'stop'),
        SupportNotifier: component('SupportNotifier', 'start', 'stop'),
        Extension: class
        {
            constructor()
            {
                this.metadata = {version: extensionVersion};
            }

            getSettings()
            {
                record('getSettings');
                return settings;
            }
        },
        Gio: {
            Settings: class
            {
                constructor(options)
                {
                    this.options = options;
                    interfaceSettings.push(this);
                    record('Gio.Settings');
                }
            },
        },
    };
    globalThis[registryKey] = fixture;

    const hooks = registerHooks({
        resolve(specifier, context, nextResolve)
        {
            if (context.parentURL?.startsWith(sourceUrl.href))
            {
                return {url: `entrypoint-mock:${id}/${specifier}`, shortCircuit: true};
            }
            return nextResolve(specifier, context);
        },
        load(url, context, nextLoad)
        {
            const prefix = `entrypoint-mock:${id}/`;
            if (!url.startsWith(prefix))
            {
                return nextLoad(url, context);
            }

            const specifier = url.slice(prefix.length);
            const registry = `globalThis[${JSON.stringify(registryKey)}]`;
            let source;
            if (specifier.startsWith('gi://'))
            {
                const name = specifier.slice(5);
                fixture[name] ??= {identity: specifier};
                dependencies.set(name, fixture[name]);
                source = `export default ${registry}[${JSON.stringify(name)}];`;
            }
            else if (specifier.endsWith('/misc/config.js'))
            {
                source = `export const PACKAGE_VERSION = ${JSON.stringify(shellVersion)};`;
            }
            else if (specifier.endsWith('/extensions/extension.js'))
            {
                source = `export const Extension = ${registry}.Extension;`;
            }
            else if (specifier.startsWith('./lib/'))
            {
                const name = specifier.split('/').at(-1).slice(0, -3);
                source = `export const ${name} = ${registry}.${name};`;
            }
            else
            {
                const name = specifier.split('/').at(-1).slice(0, -3);
                const key = name === 'osdWindow' ? 'OSDWindow' :
                    name[0].toUpperCase() + name.slice(1);
                dependencies.set(key, {identity: specifier});
                fixture[key] = dependencies.get(key);
                source = `export const identity = ${registry}[${JSON.stringify(key)}];`;
            }
            return {format: 'module', source, shortCircuit: true};
        },
    });

    try
    {
        const {default: Extension} = await import(`${sourceUrl.href}?fixture=${id}`);
        return {
            Extension, extension: new Extension(), events, instances,
            dependencies, settings, interfaceSettings,
        };
    }
    finally
    {
        hooks.deregister();
        delete globalThis[registryKey];
    }
}

const startup = [
    'Gio.Settings', 'API.construct', 'API.open', 'getSettings',
    'Manager.construct', 'Manager.start', 'SupportNotifier.construct', 'SupportNotifier.start',
];
const teardown = ['Manager.stop', 'API.close', 'SupportNotifier.stop'];

test('enable opens API before starting Manager and SupportNotifier', async () =>
{
    const harness = await createHarness();
    harness.extension.enable();
    assert.deepEqual(harness.events, startup);
});

test('API receives every Shell dependency and the real interface settings instance', async () =>
{
    const harness = await createHarness();
    harness.extension.enable();
    const [injected, version] = harness.instances.API[0].args;
    assert.equal(version, 51.2);
    assert.deepEqual(Object.keys(injected).sort(), [
        'Main', 'BackgroundMenu', 'OverviewControls', 'WorkspaceSwitcherPopup',
        'SwitcherPopup', 'InterfaceSettings', 'Search', 'SearchController',
        'WorkspaceThumbnail', 'WorkspacesView', 'Panel', 'PanelMenu', 'WindowPreview',
        'Workspace', 'LookingGlass', 'MessageTray', 'OSDWindow', 'WindowMenu',
        'AltTab', 'St', 'GLib', 'Clutter', 'Util', 'Meta', 'GObject',
    ].sort());
    assert.equal(harness.interfaceSettings.length, 1);
    assert.deepEqual(harness.interfaceSettings[0].options, {
        schema_id: 'org.gnome.desktop.interface',
    });
    assert.equal(injected.InterfaceSettings, harness.interfaceSettings[0]);
    for (const [name, dependency] of harness.dependencies)
    {
        if (name === 'Gio')
        {
            continue;
        }
        const actual = injected[name];
        assert.equal(actual?.identity === dependency ? actual.identity : actual, dependency, name);
    }
});

test('Manager and notifier share extension settings and notifier receives its owner', async () =>
{
    const harness = await createHarness();
    harness.extension.enable();
    assert.deepEqual(harness.instances.Manager[0].args, [{
        API: harness.instances.API[0], Settings: harness.settings,
    }]);
    const [injected, shellVersion, extensionVersion, owner] =
        harness.instances.SupportNotifier[0].args;
    assert.deepEqual(Object.keys(injected).sort(),
        ['MessageTray', 'Main', 'GLib', 'Gio', 'Settings'].sort());
    assert.equal(injected.Settings, harness.settings);
    for (const name of ['MessageTray', 'Main', 'GLib', 'Gio'])
    {
        const dependency = harness.dependencies.get(name);
        const actual = injected[name];
        assert.equal(actual?.identity === dependency ? actual.identity : actual, dependency, name);
    }
    assert.equal(shellVersion, 51.2);
    assert.equal(extensionVersion, 37);
    assert.equal(owner, harness.extension);
});

for (const version of [45, 46, 47, 48, 49, 50, 51])
{
    test(`Shell ${version} metadata is converted before dependency construction`, async () =>
    {
        const harness = await createHarness({
            shellVersion: `${version}.3`, extensionVersion: '37.9',
        });
        harness.extension.enable();
        assert.equal(harness.instances.API[0].args[1], version + 0.3);
        assert.equal(harness.instances.SupportNotifier[0].args[1], version + 0.3);
        assert.equal(harness.instances.SupportNotifier[0].args[2], 37);
    });
}

test('disable restores Manager before closing API and stopping notifier', async () =>
{
    const harness = await createHarness();
    harness.extension.enable();
    harness.events.length = 0;
    harness.extension.disable();
    assert.deepEqual(harness.events, teardown);
    harness.extension.disable();
    assert.deepEqual(harness.events, teardown);
});

test('disable before enable is harmless and leaves startup available', async () =>
{
    const harness = await createHarness();
    harness.extension.disable();
    harness.extension.disable();
    assert.deepEqual(harness.events, []);
    harness.extension.enable();
    assert.deepEqual(harness.events, startup);
});

test('restart creates fresh dependencies and only tears down the current instances', async () =>
{
    const harness = await createHarness();
    harness.extension.enable();
    harness.extension.disable();
    harness.extension.enable();
    for (const instances of Object.values(harness.instances))
    {
        assert.equal(instances.length, 2);
        assert.notEqual(instances[0], instances[1]);
    }
    assert.notEqual(harness.interfaceSettings[0], harness.interfaceSettings[1]);
    harness.extension.disable();
    harness.extension.disable();
    assert.deepEqual(harness.events, [...startup, ...teardown, ...startup, ...teardown]);
    for (const instances of Object.values(harness.instances))
    {
        assert.equal(instances[0].stops, 1);
        assert.equal(instances[1].stops, 1);
    }
});

test('separate extension owners retain separate lifecycle state', async () =>
{
    const harness = await createHarness();
    const other = new harness.Extension();
    harness.extension.enable();
    other.enable();
    harness.events.length = 0;
    harness.extension.disable();
    harness.extension.disable();
    assert.deepEqual(harness.events, teardown);
    for (const instances of Object.values(harness.instances))
    {
        assert.equal(instances[0].stops, 1);
        assert.equal(instances[1].stops, 0);
    }
    other.disable();
    assert.deepEqual(harness.events, [...teardown, ...teardown]);
    for (const instances of Object.values(harness.instances))
    {
        assert.equal(instances[1].stops, 1);
    }
    assert.equal(harness.instances.SupportNotifier[0].args[3], harness.extension);
    assert.equal(harness.instances.SupportNotifier[1].args[3], other);
});

for (const [failAt, cleanup] of [
    ['API.open', ['API.close']],
    ['getSettings', ['API.close']],
    ['Manager.start', ['Manager.stop', 'API.close']],
    ['SupportNotifier.start', teardown],
])
{
    test(`${failAt} errors propagate and disable cleans up assigned instances`, async () =>
    {
        const harness = await createHarness({failAt});
        assert.throws(() => harness.extension.enable(), {
            message: `Injected failure: ${failAt}`,
        });
        assert.deepEqual(harness.events, startup.slice(0, startup.indexOf(failAt) + 1));
        harness.events.length = 0;
        harness.extension.disable();
        harness.extension.disable();
        assert.deepEqual(harness.events, cleanup);
    });
}
