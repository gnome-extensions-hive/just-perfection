# Preference key contract tests

Run from the repository root with Node.js 22 or newer; no packages or GNOME
session are required:

```sh
node --test tests/prefs-keys.test.mjs
```

The tests import the unchanged `src/lib/Prefs/PrefsKeys.js`. They check the
complete exposed key set against the settings schema, all three profile values,
widget IDs and types against the UI files, numeric maps and schema ranges,
version gates at 47 and 49, and isolation between instances. The profile values
are explicit regression fixtures, not values generated from the implementation.
The default profile is not assumed to equal every schema default.

`panel-corner-size` is a legacy schema key without a preference control;
`support-notifier-showed-version` is internal state. Neither is expected in
`PrefsKeys`. The notifier type has no profile values. `AdwActionRow` metadata
identifies combo rows, whose concrete UI class is `AdwComboRow`.

Generate raw V8 coverage outside the checkout:

```sh
coverage_dir="$(mktemp -d)"
NODE_V8_COVERAGE="$coverage_dir" node --test --experimental-test-coverage \
    --test-coverage-include='**/src/lib/Prefs/PrefsKeys.js' tests/prefs-keys.test.mjs
```

The directory contains machine-readable `coverage-*.json` files. Coverage is
limited to this unit suite and does not measure preferences-window rendering,
settings persistence, Shell behavior, or integration/end-to-end coverage.
Version parameters exercise metadata conditions, not actual Shell sessions.
