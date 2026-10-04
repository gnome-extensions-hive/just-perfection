import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {SupportNotifier} from '../src/lib/SupportNotifier.js';

// Run directly with: node --test tests/support-notifier.test.mjs
const schema = readFileSync(new URL(
    '../src/schemas/org.gnome.shell.extensions.just-perfection.gschema.xml',
    import.meta.url
), 'utf8');
const defaults = new Map([...schema.matchAll(
    /<key type="i" name="(support-notifier-[^"]+)">[\s\S]*?<default>(\d+)<\/default>/g
)].map(([, key, value]) => [key, Number(value)]));

function createHarness({shellVersion = 46, extensionVersion = 36, type, shown} = {})
{
    const values = new Map(defaults);
    if (type !== undefined) {
        values.set('support-notifier-type', type);
    }
    if (shown !== undefined) {
        values.set('support-notifier-showed-version', shown);
    }

    const timers = new Map();
    const connections = new Map();
    const events = [];
    const notifications = [];
    const sources = [];
    let nextId = 1;

    const settings = {
        get_int(key)
        {
            assert.ok(values.has(key), `Unknown setting: ${key}`);
            return values.get(key);
        },
        set_int(key, value)
        {
            assert.ok(values.has(key), `Unknown setting: ${key}`);
            assert.ok(Number.isInteger(value));
            if (key === 'support-notifier-type') {
                assert.ok(value === 0 || value === 1);
            }
            const changed = values.get(key) !== value;
            values.set(key, value);
            events.push(['write', key, value]);
            if (changed) {
                for (const {signal, callback} of [...connections.values()]) {
                    if (signal === `changed::${key}`) {
                        callback();
                    }
                }
            }
        },
        connectObject(signal, callback, owner)
        {
            assert.equal(signal, 'changed::support-notifier-type');
            assert.equal(connections.has(owner), false);
            connections.set(owner, {signal, callback});
            events.push(['connect', owner]);
        },
        disconnectObject(owner)
        {
            connections.delete(owner);
            events.push(['disconnect', owner]);
        },
    };

    const glib = {
        PRIORITY_LOW: 300,
        SOURCE_CONTINUE: true,
        SOURCE_REMOVE: false,
        timeout_add_seconds(priority, seconds, callback)
        {
            assert.equal(priority, this.PRIORITY_LOW);
            assert.equal(seconds, 300);
            const id = nextId++;
            timers.set(id, callback);
            events.push(['schedule', id]);
            return id;
        },
        source_remove(id)
        {
            assert.ok(timers.delete(id), `Timer ${id} must still be active`);
            events.push(['remove', id]);
        },
    };

    function makeSource()
    {
        const source = {
            notifications: [],
            [shellVersion >= 46 ? 'addNotification' : 'showNotification'](notification)
            {
                this.notifications.push(notification);
                events.push(['deliver', notification]);
            },
        };
        sources.push(source);
        return source;
    }

    class Notification
    {
        constructor(...args)
        {
            if (shellVersion >= 46) {
                assert.equal(args.length, 1);
                assert.deepEqual(Object.keys(args[0]).sort(), ['body', 'source', 'title']);
                Object.assign(this, args[0]);
            } else {
                assert.equal(args.length, 4);
                [this.source, this.title, this.body] = args;
                assert.deepEqual(args[3], {bannerMarkup: true});
            }
            this.actions = new Map();
            this.destroyCount = 0;
            notifications.push(this);
        }

        addAction(label, callback)
        {
            assert.equal(this.actions.has(label), false);
            this.actions.set(label, callback);
        }

        destroy()
        {
            this.destroyCount++;
            events.push(['destroy', this]);
        }
    }

    const messageTray = {Notification, Urgency: {HIGH: 3}};
    if (shellVersion >= 46) {
        messageTray.getSystemSource = makeSource;
    } else {
        messageTray.SystemNotificationSource = class
        {
            constructor()
            {
                return makeSource();
            }
        };
    }
    const main = {
        layoutManager: {primaryMonitor: {inFullscreen: false}},
        messageTray: {
            add(source)
            {
                assert.ok(shellVersion < 46);
                events.push(['addSource', source]);
            },
        },
    };
    const gio = {
        AppInfo: {
            launch_default_for_uri(uri, context)
            {
                events.push(['launch', uri, context]);
            },
        },
    };
    const extension = {
        openPreferences()
        {
            events.push(['preferences']);
        },
    };
    const notifier = new SupportNotifier({
        MessageTray: messageTray, Main: main, GLib: glib, Gio: gio, Settings: settings,
    }, shellVersion, extensionVersion, extension);

    return {
        notifier, settings, timers, connections, events, notifications, sources, main, values,
        tick()
        {
            assert.equal(timers.size, 1);
            const [id, callback] = timers.entries().next().value;
            const result = callback();
            assert.ok(result === glib.SOURCE_CONTINUE || result === glib.SOURCE_REMOVE);
            if (result === glib.SOURCE_REMOVE) {
                timers.delete(id);
            }
            return result;
        },
    };
}

test('schema defaults enable new-release notifications with no previously shown version', () =>
{
    assert.deepEqual([...defaults], [
        ['support-notifier-type', 1],
        ['support-notifier-showed-version', 0],
    ]);
});

for (const version of [34, 35, 37, 38]) {
    test(`release ${version} does not register or schedule notifications`, () =>
    {
        const h = createHarness({extensionVersion: version});
        h.notifier.start();
        assert.deepEqual(h.events, []);
        assert.equal(h.timers.size, 0);
        h.notifier.stop();
        assert.equal(h.connections.size, 0);
    });
}

for (const options of [{type: 0}, {shown: 36}, {shown: 39}]) {
    test(`suppressed notification ${JSON.stringify(options)} retains its settings listener`, () =>
    {
        const h = createHarness(options);
        h.notifier.start();
        assert.equal(h.connections.size, 1);
        assert.equal(h.timers.size, 0);
        assert.equal(h.notifications.length, 0);
        h.notifier.stop();
        assert.equal(h.connections.size, 0);
    });
}

test('stop cancels the pending timer and disconnects its owner, and is repeatable', () =>
{
    const h = createHarness();
    h.notifier.start();
    assert.equal(h.connections.has(h.notifier), true);
    assert.equal(h.timers.size, 1);
    const [timerId] = h.timers.keys();
    h.notifier.stop();
    assert.deepEqual(h.events.slice(-2), [
        ['remove', timerId], ['disconnect', h.notifier],
    ]);
    h.notifier.stop();
    assert.equal(h.timers.size, 0);
    assert.equal(h.connections.size, 0);
    assert.equal(h.notifications.length, 0);
});

test('restart replaces the pending timer and reconnects only after cleanup', () =>
{
    const h = createHarness();
    h.notifier.start();
    const [oldId] = h.timers.keys();
    h.events.length = 0;
    h.notifier.restart();
    const [newId] = h.timers.keys();
    assert.notEqual(newId, oldId);
    assert.deepEqual(h.events, [
        ['remove', oldId], ['disconnect', h.notifier],
        ['connect', h.notifier], ['schedule', newId],
    ]);
    assert.equal(h.connections.size, 1);
    h.notifier.stop();
});

test('a repeated start replaces its timer rather than leaking it', () =>
{
    const h = createHarness();
    h.settings.connectObject = (signal, callback, owner) =>
    {
        h.connections.set(owner, {signal, callback});
    };
    h.notifier.start();
    const [oldId] = h.timers.keys();
    h.notifier.start();
    assert.equal(h.timers.size, 1);
    assert.equal(h.timers.has(oldId), false);
    assert.ok(h.events.some(([event, id]) => event === 'remove' && id === oldId));
    h.notifier.stop();
});

test('changing the notification preference cancels and re-enables the pending timer', () =>
{
    const h = createHarness();
    h.notifier.start();
    h.settings.set_int('support-notifier-type', 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.connections.size, 1);
    h.settings.set_int('support-notifier-type', 1);
    assert.equal(h.timers.size, 1);
    assert.equal(h.connections.size, 1);
    h.notifier.stop();
    h.settings.set_int('support-notifier-type', 0);
    h.settings.set_int('support-notifier-type', 1);
    assert.equal(h.timers.size, 0);
    assert.equal(h.connections.size, 0);
});

for (const shellVersion of [45, 46, 51]) {
    test(`Shell ${shellVersion}: fullscreen defers delivery until the monitor exits`, () =>
    {
        const h = createHarness({shellVersion});
        h.main.layoutManager.primaryMonitor.inFullscreen = true;
        h.notifier.start();
        const [id] = h.timers.keys();
        assert.equal(h.tick(), true);
        assert.equal(h.tick(), true);
        assert.equal(h.notifications.length, 0);
        assert.equal(h.values.get('support-notifier-showed-version'), 0);
        assert.equal(h.timers.has(id), true);
        h.main.layoutManager.primaryMonitor.inFullscreen = false;
        assert.equal(h.tick(), false);
        assert.equal(h.notifications.length, 1);
        assert.equal(h.timers.size, 0);
        h.notifier.stop();
    });

    test(`Shell ${shellVersion}: notification API selection and release persistence`, () =>
    {
        const h = createHarness({shellVersion, shown: 33});
        h.notifier.start();
        assert.equal(h.tick(), false);
        assert.equal(h.sources.length, 1);
        const [source] = h.sources;
        const [notification] = h.notifications;
        assert.equal(notification.source, source);
        assert.deepEqual(source.notifications, [notification]);
        assert.equal(source.title, 'Just Perfection Extension');
        assert.equal(source.iconName, 'application-x-addon-symbolic');
        assert.equal(notification.title, 'Just Perfection Extension Updated To Version 36');
        assert.equal(typeof notification.body, 'string');
        assert.ok(notification.body.includes('<i>'));
        assert.equal(notification.useBodyMarkup, true);
        assert.equal(notification.resident, true);
        assert.equal(notification.iconName, 'emblem-favorite-symbolic');
        assert.equal(notification.urgency, 3);
        assert.deepEqual([...notification.actions.keys()], [
            'Buy Me a Coffee', 'Donate Crypto', "Don't show again!",
        ]);
        assert.equal(h.events.filter(([event]) => event === 'addSource').length,
            shellVersion < 46 ? 1 : 0);
        assert.deepEqual(h.events.slice(-2), [
            ['deliver', notification], ['write', 'support-notifier-showed-version', 36],
        ]);
        h.notifier.restart();
        assert.equal(h.timers.size, 0);
        assert.equal(h.notifications.length, 1);
        h.notifier.stop();
    });

    for (const action of ['Buy Me a Coffee', 'Donate Crypto', "Don't show again!"]) {
        test(`Shell ${shellVersion}: ${action} acts and destroys the notification`, () =>
        {
            const h = createHarness({shellVersion});
            h.notifier.start();
            h.tick();
            const [notification] = h.notifications;
            h.events.length = 0;
            notification.actions.get(action)();
            assert.equal(notification.destroyCount, 1);
            if (action === 'Buy Me a Coffee') {
                assert.deepEqual(h.events, [
                    ['launch', 'https://www.buymeacoffee.com/justperfection', null],
                    ['destroy', notification],
                ]);
            } else if (action === 'Donate Crypto') {
                assert.deepEqual(h.events, [['preferences'], ['destroy', notification]]);
            } else {
                assert.equal(h.values.get('support-notifier-type'), 0);
                assert.deepEqual(h.events, [
                    ['write', 'support-notifier-type', 0], ['disconnect', h.notifier],
                    ['connect', h.notifier], ['destroy', notification],
                ]);
                assert.equal(h.timers.size, 0);
            }
            h.notifier.stop();
        });
    }
}

for (const monitor of [null, undefined, {}]) {
    test(`absent fullscreen state (${JSON.stringify(monitor)}) does not block delivery`, () =>
    {
        const h = createHarness();
        h.main.layoutManager.primaryMonitor = monitor;
        h.notifier.start();
        assert.equal(h.tick(), false);
        assert.equal(h.notifications.length, 1);
        h.notifier.stop();
    });
}
