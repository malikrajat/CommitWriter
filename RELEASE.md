# Release process

This checklist is for maintainers. Publishing is always a manual decision.

## 1. Prepare

- [ ] Update `CHANGELOG.md` with the release notes.
- [ ] Update the version in `package.json`.
- [ ] Confirm `src/core/product.ts` matches the manifest (name, display name,
      publisher).
- [ ] Review `README.md`, `HELP.md`, `SUPPORT.md` for accuracy.
- [ ] Confirm screenshots match the current UI.

## 2. Verify

```bash
npm ci
npm run verify
```

This runs typecheck, lint, all tests, architecture checks and the production
build.

## 3. Package

```bash
npm run package
```

Produces `commitwriter-<version>.vsix`.

## 4. Validate the package

```bash
code --install-extension commitwriter-<version>.vsix --extensions-dir .tmp-ext
code --list-extensions --extensions-dir .tmp-ext
code --uninstall-extension RajatMalik.commitwriter --extensions-dir .tmp-ext
```

Then install it in a normal VS Code window and check:

- [ ] Activity-bar icon and sidebar open.
- [ ] Sidebar search works and toggles change settings.
- [ ] Generate works with a cloud provider.
- [ ] Generate works with a local provider and Local-only mode.
- [ ] Cancel stops a request.
- [ ] Undo and Regenerate behave correctly.
- [ ] No key appears in settings, logs or diagnostics.

## 5. Publish

Only after explicit approval:

```bash
npx @vscode/vsce publish
```

or upload the VSIX through the Marketplace management page.

## 6. After publishing

- [ ] Tag the release in Git.
- [ ] Push the tag to origin.
- [ ] Verify the Marketplace page: icon, README banner, screenshots, privacy and
      security links.
- [ ] Watch issues for installation or provider problems.

## Rollback

Marketplace versions cannot be deleted, but a fixed version can be published
immediately. Keep the previous VSIX for comparison.
