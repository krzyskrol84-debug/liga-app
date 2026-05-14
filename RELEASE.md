# Release Build

## Requirements

- Node.js 20+
- Rust stable with Cargo in `PATH`
- Microsoft C++ Build Tools
- WebView2 Runtime
- NSIS is handled by Tauri bundler tooling

## Versioning

Update `package.json`:

```powershell
npm.cmd version patch --no-git-tag-version
npm.cmd run version:sync
```

`version:sync` copies the package version to:

```txt
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
```

## Unsigned Installer

```powershell
npm.cmd run release
```

The Windows `.exe` installer is generated under:

```txt
src-tauri/target/release/bundle/nsis/
```

## Optional Signing

Set the certificate thumbprint:

```powershell
$env:SIGN_CERT_THUMBPRINT="YOUR_CERT_SHA1_THUMBPRINT"
$env:SIGN_TIMESTAMP_URL="http://timestamp.digicert.com"
npm.cmd run sign:windows
```

If `signtool.exe` is not in `PATH`, set:

```powershell
$env:SIGNTOOL_PATH="C:\Path\To\signtool.exe"
```
