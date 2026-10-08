import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


BUILD_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build.sh"
ARCHIVE = "just-perfection-desktop@just-perfection.shell-extension.zip"
COMPILE_ARGS = ["--sourcedir", "src/data", "src/data/resources.gresource.xml"]
PACK_ARGS = [
    "pack", "src", "--force", "--podir=../po",
    "--extra-source=data/resources.gresource",
    "--extra-source=lib", "--extra-source=../LICENSE",
    "--extra-source=../CHANGELOG.md",
]
INSTALL_ARGS = ["install", "--force", ARCHIVE]

COMMAND_DOUBLE = """
import json
import os
from pathlib import Path
import sys

tool = Path(sys.argv[0]).name
args = sys.argv[1:]
operation = "compile" if tool == "glib-compile-resources" else args[0]
with open(os.environ["COMMAND_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"tool": tool, "cwd": os.getcwd(), "args": args}) + "\\n")
if os.environ.get("FAIL_OPERATION") == operation:
    print("fixture failure: " + operation, file=sys.stderr)
    sys.exit(23)
if operation == "compile":
    Path("src/data/resources.gresource").write_text("fixture resource")
elif operation == "pack":
    if not Path("src/data/resources.gresource").is_file():
        sys.exit("resource was not compiled before packing")
    Path("just-perfection-desktop@just-perfection.shell-extension.zip").touch()
elif operation == "install" and not Path(args[-1]).is_file():
    sys.exit("archive was not packed before installation")
"""


class BuildScriptTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="build script tests ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "checkout with spaces"
        (self.repo / "scripts").mkdir(parents=True)
        (self.repo / "src" / "data").mkdir(parents=True)
        self.script = self.repo / "scripts" / "build.sh"
        shutil.copyfile(BUILD_SCRIPT, self.script)
        self.cwd = self.root / "unrelated directory"
        self.cwd.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "commands.jsonl"
        for tool in ("glib-compile-resources", "gnome-extensions"):
            command = self.bin / tool
            command.write_text("#!" + sys.executable + "\n" + COMMAND_DOUBLE, encoding="utf-8")
            command.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.defpath,
            "COMMAND_LOG": str(self.log),
            "LC_ALL": "C",
        }
        self.env.pop("FAIL_OPERATION", None)
        self.env.pop("BASH_ENV", None)
        self.env.pop("ENV", None)

    def run_build(self, *args, failure=None):
        if failure is not None:
            self.env["FAIL_OPERATION"] = failure
        return subprocess.run(
            ["/bin/bash", str(self.script), *args],
            cwd=self.cwd,
            env=self.env,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_calls(self, *commands):
        self.assertEqual(
            self.calls(),
            [{"tool": tool, "cwd": str(self.repo), "args": args} for tool, args in commands],
        )

    def test_default_build_compiles_then_packs_from_repository_root(self):
        result = self.run_build()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_calls(
            ("glib-compile-resources", COMPILE_ARGS), ("gnome-extensions", PACK_ARGS),
        )
        self.assertEqual(
            result.stdout,
            "Compiling Resources...\nPacking extension...\nPacking Done!\n",
        )
        self.assertEqual(result.stderr, "")
        self.assertTrue((self.repo / ARCHIVE).is_file())
        self.assertEqual(list(self.cwd.iterdir()), [])

    def test_install_flag_installs_only_after_packing(self):
        result = self.run_build("-i")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_calls(
            ("glib-compile-resources", COMPILE_ARGS),
            ("gnome-extensions", PACK_ARGS),
            ("gnome-extensions", INSTALL_ARGS),
        )
        self.assertIn("Extension is installed. Now restart the GNOME Shell.\n", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_compile_failure_stops_before_packing(self):
        result = self.run_build("-i", failure="compile")
        self.assertEqual(result.returncode, 23)
        self.assert_calls(("glib-compile-resources", COMPILE_ARGS))
        self.assertEqual(result.stdout, "Compiling Resources...\n")
        self.assertEqual(result.stderr, "fixture failure: compile\n")
        self.assertFalse((self.repo / ARCHIVE).exists())

    def test_pack_failure_stops_before_installation(self):
        result = self.run_build("-i", failure="pack")
        self.assertEqual(result.returncode, 23)
        self.assert_calls(
            ("glib-compile-resources", COMPILE_ARGS), ("gnome-extensions", PACK_ARGS),
        )
        self.assertEqual(result.stdout, "Compiling Resources...\nPacking extension...\n")
        self.assertEqual(result.stderr, "fixture failure: pack\n")
        self.assertFalse((self.repo / ARCHIVE).exists())

    def test_install_failure_reports_error_without_success_message(self):
        result = self.run_build("-i", failure="install")
        self.assertEqual(result.returncode, 1)
        self.assert_calls(
            ("glib-compile-resources", COMPILE_ARGS),
            ("gnome-extensions", PACK_ARGS),
            ("gnome-extensions", INSTALL_ARGS),
        )
        self.assertEqual(
            result.stdout,
            "Compiling Resources...\nPacking extension...\nPacking Done!\n"
            "ERROR: Could not install the extension!\n",
        )
        self.assertEqual(result.stderr, "fixture failure: install\n")

    def test_invalid_flag_reports_usage_after_current_pack_step(self):
        result = self.run_build("-x")
        self.assertEqual(result.returncode, 1)
        self.assert_calls(
            ("glib-compile-resources", COMPILE_ARGS), ("gnome-extensions", PACK_ARGS),
        )
        self.assertEqual(
            result.stdout,
            "Compiling Resources...\nPacking extension...\nPacking Done!\n"
            "ERROR: Invalid flag!\n"
            "Use '-i' to install the extension to your system.\n"
            "To just build it, run the script without any flag.\n",
        )
        self.assertIn("illegal option -- x", result.stderr)

    def test_repeated_install_flag_preserves_each_requested_install(self):
        result = self.run_build("-ii")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_calls(
            ("glib-compile-resources", COMPILE_ARGS),
            ("gnome-extensions", PACK_ARGS),
            ("gnome-extensions", INSTALL_ARGS),
            ("gnome-extensions", INSTALL_ARGS),
        )
        self.assertEqual(
            result.stdout.count("Extension is installed. Now restart the GNOME Shell.\n"), 2,
        )


if __name__ == "__main__":
    unittest.main()
