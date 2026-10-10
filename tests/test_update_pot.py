import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "update-pot.sh"

TOOL = """#!{python}
import json
import os
from pathlib import Path
import sys

name = Path(sys.argv[0]).name
with open(os.environ["TOOL_LOG"], "a") as log:
    log.write(json.dumps({{"name": name, "args": sys.argv[1:], "cwd": os.getcwd()}}) + "\\n")
if name == os.environ.get("FAIL_TOOL"):
    sys.exit(int(os.environ["FAIL_CODE"]))
if name == "xgettext":
    Path("po/main.pot").write_text("extracted template\\n")
else:
    if Path("po/main.pot").read_text() != "extracted template\\n":
        sys.exit(90)
    catalog = Path(sys.argv[2])
    with catalog.open("a") as output:
        output.write("# merged\\n")
        if catalog.stem in os.environ.get("FUZZY_LOCALES", "").split(","):
            output.write('#, fuzzy\\nmsgid "Example"\\nmsgstr "Example"\\n')
"""


class UpdatePotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="update-pot-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "checkout with spaces"
        (self.root / "scripts").mkdir(parents=True)
        (self.root / "po").mkdir()
        (self.root / "src" / "nested").mkdir(parents=True)
        shutil.copyfile(SCRIPT, self.root / "scripts" / "update-pot.sh")
        for relative in ("src/extension.js", "src/nested/prefs.js", "src/nested/page.ui"):
            (self.root / relative).write_text("fixture\n")
        (self.root / "src" / "ignored.txt").write_text("not an extraction input\n")
        for locale in ("de", "fr", "zz"):
            (self.root / "po" / f"{locale}.po").write_text("# fixture catalog\n")
        (self.root / "po" / "main.pot").write_text("old template\n")
        self.bin = Path(self.temp.name) / "bin"
        self.bin.mkdir()
        for tool in ("xgettext", "msgmerge"):
            path = self.bin / tool
            path.write_text(TOOL.format(python=sys.executable))
            path.chmod(0o755)
        self.log = Path(self.temp.name) / "tools.jsonl"
        self.env = dict(os.environ)
        for key in ("FAIL_TOOL", "FAIL_CODE", "FUZZY_LOCALES"):
            self.env.pop(key, None)
        self.env.update(
            PATH=f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            TOOL_LOG=str(self.log),
            LC_ALL="C",
        )

    def run_script(self, **overrides):
        result = subprocess.run(
            ["bash", str(self.root / "scripts" / "update-pot.sh")],
            cwd=self.temp.name,
            env={**self.env, **overrides},
            capture_output=True,
            text=True,
            timeout=10,
        )
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result, calls

    def test_extraction_inputs_options_and_repository_root(self):
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        extraction = calls[0]
        self.assertEqual(extraction["name"], "xgettext")
        self.assertEqual(
            extraction["args"][:5],
            [
                "--from-code=UTF-8",
                "--copyright-holder=Just Perfection",
                "--package-name=Just Perfection",
                "--package-version=3",
                "--output=po/main.pot",
            ],
        )
        self.assertCountEqual(
            extraction["args"][5:],
            ["./src/extension.js", "./src/nested/prefs.js", "./src/nested/page.ui"],
        )
        self.assertTrue(all(call["cwd"] == str(self.root) for call in calls))

    def test_each_catalog_is_merged_after_extraction(self):
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([call["name"] for call in calls], ["xgettext"] + ["msgmerge"] * 3)
        self.assertEqual(
            [call["args"] for call in calls[1:]],
            [["-U", f"po/{locale}.po", "po/main.pot"] for locale in ("de", "fr", "zz")],
        )
        self.assertEqual((self.root / "po" / "main.pot").read_text(), "extracted template\n")
        for locale in ("de", "fr", "zz"):
            self.assertIn("# merged\n", (self.root / "po" / f"{locale}.po").read_text())
            self.assertIn(f"Updating {locale}", result.stdout)

    def test_clean_catalogs_do_not_emit_warning(self):
        result, _ = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("WARNING:", result.stdout)

    def test_single_fuzzy_catalog_is_reported(self):
        result, _ = self.run_script(FUZZY_LOCALES="fr")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "WARNING: Translations have unclear strings and need an update: fr\n",
            result.stdout,
        )

    def test_multiple_fuzzy_catalogs_are_reported_in_catalog_order(self):
        result, _ = self.run_script(FUZZY_LOCALES="zz,de")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("need an update: de zz\n", result.stdout)
        self.assertEqual(result.stdout.count("WARNING:"), 1)

    def test_preexisting_fuzzy_marker_is_detected_but_plain_comment_is_not(self):
        (self.root / "po" / "de.po").write_text("#, fuzzy\n")
        (self.root / "po" / "fr.po").write_text("# fuzzy is only a comment\n")
        result, _ = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("need an update: de\n", result.stdout)

    def test_extraction_failure_stops_before_catalog_updates(self):
        result, calls = self.run_script(FAIL_TOOL="xgettext", FAIL_CODE="37")
        self.assertEqual(result.returncode, 123)
        self.assertEqual([call["name"] for call in calls], ["xgettext"])
        self.assertEqual((self.root / "po" / "main.pot").read_text(), "old template\n")
        self.assertNotIn("Updating", result.stdout)
        for locale in ("de", "fr", "zz"):
            self.assertEqual(
                (self.root / "po" / f"{locale}.po").read_text(), "# fixture catalog\n"
            )

    def test_merge_failure_stops_before_later_catalogs_and_warning(self):
        result, calls = self.run_script(FAIL_TOOL="msgmerge", FAIL_CODE="41")
        self.assertEqual(result.returncode, 41)
        self.assertEqual([call["name"] for call in calls], ["xgettext", "msgmerge"])
        self.assertEqual(calls[1]["args"], ["-U", "po/de.po", "po/main.pot"])
        self.assertNotIn("Updating fr", result.stdout)
        self.assertNotIn("WARNING:", result.stdout)
        for locale in ("de", "fr", "zz"):
            self.assertEqual(
                (self.root / "po" / f"{locale}.po").read_text(), "# fixture catalog\n"
            )


if __name__ == "__main__":
    unittest.main()
