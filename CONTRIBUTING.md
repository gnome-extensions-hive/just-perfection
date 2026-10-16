# Contribution

## Rules

- Respect 100 characters margin.

- The indentation is 4 characters. Don't use tab for indentation.

- Avoid unnecessary comments. The code should be self explanatory.

- Write a simple and readable code.

- All functions and methods should be testable inside *lib* folder.

- Curly brackets for function, class, method and CSS class should be in new line.

- Class name, function, method names and variables should be camel cased.

- Only main files are allowed in the src folder (such as `extension.js`, `prefs.js`, `stylesheet.css` and `metadata.json`).

- Singleton is not allowed for any files inside *lib* folder.

- Class constructor shouldn't do much. It is preferred to only use dependency injection if it is necessary.

- SVG and Image files should be released under GPLv3 license.

- Overriding GNOME Shell theme is accepted and your style should be applied when the parent has *just-perfection* class in it (or starts with *just-perfection-*).

- All *ui* files should be inside *src/data/ui* folder.

- All changes related to the GNOME Shell should pass through API (`lib/API.js`). Also API acts as compatibility layer.

## Translation

- You can find main translation file (pot file) in *po/main.pot*. That's the translation reference file.

- Initial language translation for current languages has been translated via online services. Feel free to edit that.

## Submitting Changes

### Destination and Workflow

Contributions to this repository are submitted via GitHub Pull Requests against the `main` branch.

1. Fork the repository on GitHub: `gnome-extensions-hive/just-perfection`.
2. Create a feature branch from the latest `main` branch.
3. Commit your changes with clear, descriptive commit messages explaining the problem and solution.
4. Push your branch to your personal fork.
5. Open a Pull Request targeting the `main` branch of `gnome-extensions-hive/just-perfection`.

### Pull Request Information

When submitting a pull request, provide clear context to help maintainers review your changes:

- **Summary of Changes**: Clearly explain what changes were made and why.
- **Related Issues**: Reference any corresponding issue (e.g., `Closes #123` or `Fixes #123`).
- **Testing and Verification**: Describe how you verified your changes and any testing performed.
- **Screenshots or Recordings**: Include visual proof for user interface or styling modifications.

### Pre-Submission Checks

Before opening your pull request, please ensure:

- **Coding Rules**: Your changes conform to the code style and architectural rules
  listed above (such as the 100-character line margin, 4-space indentation,
  newlines for opening braces, and keeping API interactions inside `lib/API.js`).
- **Translation Updates**: If UI strings are modified or added, update the translation
  templates if appropriate.
- **Local Testing**: Test the extension locally to verify that your changes function
  properly and introduce no regressions. If a build tool or linter is available in
  your environment, verify that files parse cleanly.

### Review Process

- Once submitted, maintainers and automated checks will review your pull request.
- Address any review comments promptly. You can push additional commits to your branch
  to update the pull request.
- Keep discussion constructive and focused on the code and user experience.

*This file may be updated in the future. Any change should be applied to all files in this repository.*

