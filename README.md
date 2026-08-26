# Drive Sonar

<p align="center">
  <img src="public/drive_sonar_base.png" width="256" alt="Drive Sonar Logo" />
</p>

Drive Sonar is a fast, lightweight desktop disk usage explorer and analyzer built with Tauri v2, Rust, React, and TypeScript.

Drive Sonar is inspired by the simplicity of `ncdu`. Drive Sonar offers different visualizations to help you gain a better idea of your disk usage.

Drive Sonar runs entirely in **user mode**—no admin mode or elevated privilege is required to scan even the most protected corners of your disk. It's also fully **open source**, so you can see exactly what it's doing and build it yourself if you'd rather not trust a binary.

## ⚡ Features

- **Fast Parallel Scanning:** Native fast-path scanning on Windows and a multi-threaded `jwalk`-based fallback for other platforms
- **Interactive Visualizations:**
  - **Space Distribution Map:** High-performance storage treemap
  - **Extension Breakdown:** Top file extensions by storage utilization
  - **File Age Analysis:** Scatter plot visualizing file size vs. age
- **In-App File Management:** Open files or folders directly in native OS file managers or safely move items to system trash (requires confirmation)
- **Security Hardened:** Path canonicalization guards against relative traversal, strict Content Security Policy (CSP), and system root deletion protection
- **No Admin Required:** Runs entirely in user mode, unlike many disk analyzers that need elevated privileges to scan protected directories
- **Open Source:** Apache 2.0 licensed—inspect the code, fork it, or build it yourself

<p align="center">
  <img src="public/screenshot.png" width="896" alt="Drive Sonar screenshot" />
</p>


## 🤔 Why Drive Sonar?

Primarily, this started as a hands-on project to learn Rust and Tauri. But it's also grown into something I actually reach for: Windows' native storage view is fairly high-level, and I wanted something like `ncdu`, but with a GUI—fast and minimal, insightful without visual clutter, and one that doesn't demand admin rights just to tell me where my disk space went.

## 📥 Download

Pre-built binaries are available on the [Releases](https://github.com/barun-saha/drive-sonar/releases) page. Download the installer for your platform, run it, and you're good to go—no build step required.

> **Note:** The Windows installer isn't code-signed yet, so you'll likely see a Windows SmartScreen warning ("Windows protected your PC") on first run. This is just because the binary doesn't carry a paid publisher certificate—it's not a sign of malware. Click **More info → Run anyway** to proceed. Signing is on the radar for a future release.

## 🚀 Getting Started

On Windows, Drive Sonar requires Windows 10 version 1709 (October 2017 Update) or later. macOS and Linux have no additional version requirement.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/) (stable toolchain)

### Development

Install dependencies:

```bash
npm install
```

Run the application in development mode:

```bash
npm run tauri dev
```

### Production Build

Build the optimized desktop binary:

```bash
npm run tauri build
```

### 🧪 Unit Testing

Run backend Rust unit tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

To generate code coverage reports, install `cargo-tarpaulin` (if not already installed) and run:

```bash
cargo install cargo-tarpaulin
cargo tarpaulin --manifest-path src-tauri/Cargo.toml --ignore-tests
```

## 📦 Release Process

To create a new release:

1. **Bump Version:** Update the version number (e.g., `0.4.0` -> `0.5.0`) in:
   - [`package.json`](package.json) (`"version"`)
   - [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) (`"version"`)
   - [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) (`version` under `[package]`)
2. **Merge to `main`:** Commit changes, raise a PR, and merge into `main`.
3. **Tag & Push:** Checkout the latest `main` and push the Git tag:
   ```bash
   git checkout main
   git pull origin main
   git tag v0.5.0
   git push origin v0.5.0
   ```
4. **Publish Release:** Pushing the `v*` tag triggers the GitHub Actions workflow, building binaries across platforms and creating a draft release on GitHub. Review and publish the draft.

## 📜 License

Drive Sonar is open-source software, released under the Apache 2.0 license.
