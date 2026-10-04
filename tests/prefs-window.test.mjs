import assert from 'node:assert/strict';
import test from 'node:test';
import {Prefs} from '../src/lib/Prefs/Prefs.js';

class Widget
{
    handlers = new Map();
    active = false;
    selected = 0;
    value = 0;
    children = [];

    connect(signal, callback)
    {
        assert.ok(!this.handlers.has(signal), `duplicate ${signal} handler`);
        this.handlers.set(signal, callback);
    }

    emit(signal, ...args)
    {
        assert.ok(this.handlers.has(signal), `missing ${signal} handler`);
        return this.handlers.get(signal)(this, ...args);
    }

    set_active(value)
    {
        this.active = value;
    }

    get_active()
    {
        return this.active;
    }

    set_selected(value)
    {
        this.selected = Number(value);
    }

    get_selected()
    {
        return this.selected;
    }

    set_value(value)
    {
        this.value = value;
    }

    get_value()
    {
        return this.value;
    }

    set_resource(path)
    {
        this.resource = path;
    }

    observe_children()
    {
        return {
            get_n_items: () => this.children.length,
            get_item: index => this.children[index],
        };
    }
}

class HeaderBar extends Widget
{
    packed = [];

    pack_end(widget)
    {
        this.packed.push(widget);
    }
}

function fixture({monitor = [800, 900, 1], missing = [], keys: suppliedKeys} = {})
{
    const keys = suppliedKeys ?? {
        toggle: {
            id: 'toggle', name: 'toggle', widgetId: 'toggle_switch',
            widgetType: 'GtkSwitch', supported: true, maps: {},
            profiles: {default: true, minimal: false, superminimal: false},
        },
        choice: {
            id: 'choice', name: 'choice', widgetId: 'choice_combo',
            widgetType: 'AdwActionRow', supported: true, maps: {1: 32},
            profiles: {default: 0, minimal: 1, superminimal: 2},
        },
        number: {
            id: 'number', name: 'number', widgetId: 'number_spin',
            widgetType: 'AdwSpinRow', supported: true, maps: {},
            profiles: {default: 5, minimal: 2, superminimal: 0},
        },
    };
    const objects = new Map();
    for (const id of [
        'menu_button', 'profile', 'visibility', 'behavior', 'customize',
        'profile_default', 'profile_minimal', 'profile_superminimal', 'profile_custom',
        'support_crypto_row', 'crypto_address_copy_button', 'crypto_address_row',
        'toast_added_to_clipboard', 'qr_picture',
        ...Object.values(keys).flatMap(key => [key.widgetId, `${key.id}_row`]),
    ]) {
        if (!missing.includes(id)) {
            objects.set(id, new Widget());
        }
    }
    const values = new Map([['toggle', true], ['choice', 0], ['number', 5]]);
    const writes = [];
    const resources = [];
    const loaded = [];
    const providers = [];
    const launched = [];
    const copied = [];
    const resource = {};
    const display = {
        get_monitors: () => ({
            get_item: index => {
                assert.equal(index, 0);
                return monitor && {
                    get_geometry: () => ({width: monitor[0], height: monitor[1]}),
                    get_scale_factor: () => monitor[2],
                };
            },
        }),
        get_clipboard: () => ({set: text => copied.push(text)}),
    };
    const window = new Widget();
    const header = new HeaderBar();
    const container = new Widget();
    container.children = [header];
    window.children = [container];
    window.pages = [];
    window.toasts = [];
    window.groups = new Map();
    window.add = page => window.pages.push(page);
    window.add_toast = toast => window.toasts.push(toast);
    window.insert_action_group = (name, group) => window.groups.set(name, group);
    window.set_default_size = (...size) => { window.size = size; };
    let domain;
    const settings = {
        get_boolean: name => {
            assert.equal(name, 'toggle');
            return values.get(name);
        },
        get_int: name => {
            assert.ok(['choice', 'number'].includes(name));
            return values.get(name);
        },
        set_boolean: (name, value) => {
            assert.equal(name, 'toggle');
            assert.equal(typeof value, 'boolean');
            writes.push([name, value]);
            values.set(name, value);
        },
        set_int: (name, value) => {
            assert.ok(['choice', 'number'].includes(name));
            assert.ok(Number.isInteger(value));
            writes.push([name, value]);
            values.set(name, value);
        },
    };
    const prefs = new Prefs({
        Settings: settings,
        Builder: {
            get_object: id => {
                assert.ok(objects.has(id) || missing.includes(id), `unexpected widget ${id}`);
                return objects.get(id) ?? null;
            },
            set_translation_domain: value => { domain = value; },
            add_from_resource: path => loaded.push(path),
        },
        CssProvider: {load_from_resource: path => loaded.push(path)},
        Adw: {HeaderBar},
        Gtk: {
            STYLE_PROVIDER_PRIORITY_APPLICATION: 600,
            StyleContext: {
                add_provider_for_display: (...args) => providers.push(args),
            },
        },
        Gdk: {Display: {get_default: () => display}},
        Gio: {
            Resource: {
                load: path => {
                    resources.push(['load', path]);
                    return resource;
                },
            },
            resources_register: value => resources.push(['register', value]),
            resources_unregister: value => resources.push(['unregister', value]),
            SimpleActionGroup: class {
                actions = [];
                add_action(action) { this.actions.push(action); }
            },
            SimpleAction: class extends Widget {
                constructor(options) { super(); this.options = options; }
            },
            AppInfo: {launch_default_for_uri: (...args) => launched.push(args)},
        },
        GLib: {VariantType: class {
            constructor(type) { this.type = type; }
        }},
    }, {keys}, 49);
    return {
        fill: () => prefs.fillPrefsWindow(window, '/extension/data', 'test-domain'),
        objects, window, header, values, writes, resources, resource, loaded,
        providers, display, launched, copied, getDomain: () => domain,
    };
}

test('window setup loads resources, pages, styling and nested header menu in order', () =>
{
    const f = fixture();
    f.fill();
    const root = '/org/gnome/Shell/Extensions/justperfection';
    assert.deepEqual(f.loaded, [
        `${root}/css/prefs.css`, `${root}/ui/menu.ui`, `${root}/ui/pages/profile.ui`,
        `${root}/ui/pages/visibility.ui`, `${root}/ui/pages/behavior.ui`,
        `${root}/ui/pages/customize.ui`,
    ]);
    assert.equal(f.getDomain(), 'test-domain');
    assert.deepEqual(f.resources, [
        ['load', '/extension/data/resources.gresource'], ['register', f.resource],
    ]);
    assert.deepEqual(f.window.pages,
        ['profile', 'visibility', 'behavior', 'customize'].map(id => f.objects.get(id)));
    assert.equal(f.providers.length, 1);
    assert.equal(f.providers[0][0], f.display);
    assert.equal(f.providers[0][2], 600);
    assert.deepEqual(f.header.packed, [f.objects.get('menu_button')]);
    assert.equal(f.window.search_enabled, true);
    assert.deepEqual(f.writes, []);
});

test('settings initialize all widget types and reverse-map stored combo values', () =>
{
    const f = fixture();
    f.values.set('toggle', false);
    f.values.set('choice', 32);
    f.values.set('number', 8);
    f.fill();
    assert.equal(f.objects.get('toggle_switch').active, false);
    assert.equal(f.objects.get('choice_combo').selected, 1);
    assert.equal(f.objects.get('number_spin').value, 8);
    assert.equal(f.objects.get('profile_custom').active, true);
    assert.deepEqual(f.writes, []);
});

for (const [id, signal, property, value, expected] of [
    ['toggle_switch', 'state-set', 'active', false, ['toggle', false]],
    ['choice_combo', 'notify::selected-item', 'selected', 1, ['choice', 32]],
    ['choice_combo', 'notify::selected-item', 'selected', 2, ['choice', 2]],
    ['number_spin', 'notify::value', 'value', 7, ['number', 7]],
]) {
    test(`${id} ${signal} writes the correct settings value and guesses custom`, () =>
    {
        const f = fixture();
        f.fill();
        const widget = f.objects.get(id);
        widget[property] = value;
        widget.emit(signal);
        assert.deepEqual(f.writes, [expected]);
        assert.equal(f.objects.get('profile_custom').active, true);
    });
}

for (const [profile, expected] of [
    ['default', [true, 0, 5]],
    ['minimal', [false, 1, 2]],
    ['superminimal', [false, 2, 0]],
]) {
    test(`${profile} button selects its preset values`, () =>
    {
        const f = fixture();
        f.fill();
        f.objects.get(`profile_${profile}`).emit('clicked');
        assert.deepEqual([
            f.objects.get('toggle_switch').active,
            f.objects.get('choice_combo').selected,
            f.objects.get('number_spin').value,
        ], expected);
    });
}

test('supported widgets alone determine the profile and row visibility', () =>
{
    const f = fixture({keys: {
        toggle: {
            id: 'toggle', name: 'toggle', widgetId: 'toggle_switch',
            widgetType: 'GtkSwitch', supported: true, maps: {},
            profiles: {default: true, minimal: false, superminimal: false},
        },
        number: {
            id: 'number', name: 'number', widgetId: 'number_spin',
            widgetType: 'AdwSpinRow', supported: false, maps: {},
            profiles: {default: 99, minimal: 99, superminimal: 99},
        },
    }});
    f.fill();
    assert.equal(f.objects.get('profile_default').active, true);
    assert.equal(f.objects.get('toggle_row').visible, true);
    assert.equal(f.objects.get('number_row').visible, false);
});

test('matching values select minimal after a settings callback', () =>
{
    const f = fixture();
    f.fill();
    f.objects.get('toggle_switch').active = false;
    f.objects.get('choice_combo').selected = 1;
    f.objects.get('number_spin').value = 2;
    f.objects.get('number_spin').emit('notify::value');
    assert.equal(f.objects.get('profile_minimal').active, true);
});

for (const [monitor, size] of [
    [[690, 800, 1], [640, 750]],
    [[689, 800, 1], undefined],
    [[690, 799, 1], undefined],
    [[1380, 1600, 2], [640, 750]],
    [[1379, 1600, 2], undefined],
    [null, undefined],
]) {
    test(`monitor ${JSON.stringify(monitor)} respects scaled size tolerance`, () =>
    {
        const f = fixture({monitor});
        f.fill();
        assert.deepEqual(f.window.size, size);
    });
}

test('missing header tree and absent optional profile widgets do not block setup', () =>
{
    const f = fixture({missing: ['profile_default', 'profile_custom']});
    f.window.observe_children = () => null;
    f.fill();
    assert.deepEqual(f.header.packed, []);
    assert.equal(f.objects.get('profile_minimal').handlers.size, 0);
    assert.equal(f.window.search_enabled, true);
});

test('close unregisters the same resource registered at setup', () =>
{
    const f = fixture();
    f.fill();
    f.window.emit('close-request');
    assert.deepEqual(f.resources.at(-1), ['unregister', f.resource]);
});

test('link action forwards its variant URI and launch context', () =>
{
    const f = fixture();
    f.fill();
    const group = f.window.groups.get('links');
    assert.equal(group.actions.length, 1);
    const action = group.actions[0];
    assert.equal(action.options.name, 'open-uri');
    assert.equal(action.options.parameter_type.type, 's');
    action.emit('activate', {get_string: () => ['https://example.invalid/']});
    assert.deepEqual(f.launched, [['https://example.invalid/', null]]);
});

test('support selection updates its QR and copy uses the displayed address', () =>
{
    const f = fixture();
    f.fill();
    const address = f.objects.get('crypto_address_row');
    const initial = address.text;
    const combo = f.objects.get('support_crypto_row');
    combo.selected = 2;
    combo.emit('notify::selected-item');
    assert.equal(address.title, 'Bitcoin Cash Address');
    assert.notEqual(address.text, initial);
    assert.equal(f.objects.get('qr_picture').resource,
        '/org/gnome/Shell/Extensions/justperfection/imgs/qr-bitcoin-cash.svg');
    f.objects.get('crypto_address_copy_button').emit('clicked');
    assert.deepEqual(f.copied, [address.text]);
    assert.deepEqual(f.window.toasts, [f.objects.get('toast_added_to_clipboard')]);
});
