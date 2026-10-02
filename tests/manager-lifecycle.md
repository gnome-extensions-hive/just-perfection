# Manager lifecycle unit tests

Run from the repository root with Node.js 22.7 or newer:

```sh
node --test tests/manager-lifecycle.test.mjs
```

Capture raw V8 coverage outside the checkout and print the unit coverage summary:

```sh
coverage_dir="$(mktemp -d)"
NODE_V8_COVERAGE="$coverage_dir" node --test --experimental-test-coverage \
    --test-coverage-include='**/src/lib/Manager.js' \
    tests/manager-lifecycle.test.mjs
printf 'Raw V8 coverage: %s\n' "$coverage_dir"
```

No packages, compiled schemas or running GNOME Shell are required. Tests import
the unchanged Manager module, read boolean/integer defaults from the extension's
schema, and inject settings and recording API doubles. API prototype names
validate the available mock methods; actual API method bodies are not executed.

Assertions cover initial settings application, owner-bound signal registration,
disconnect-before-restore ordering, complete restoration despite user overrides,
callback cleanup, restart, numeric conversions, animation speeds, and coupled
panel, clock-menu, looking-glass and overlay-key settings.

The signal inventory excludes the legacy panel-corner-size setting and the two
support-notifier settings, which Manager does not manage. New schema keys require
an explicit decision about whether Manager owns them.

These are mocked unit tests, not GNOME integration or end-to-end tests. They do
not establish Shell compatibility or execution of the underlying API methods.
Raw coverage must only be combined with other suites from the same code revision
and compatible coverage metadata; a unit report alone cannot establish missing
end-to-end coverage.
