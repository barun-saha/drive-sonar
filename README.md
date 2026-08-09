# Drive Sonar

<p align="center">
  <img src="public/drive_sonar_base.png" width="256" alt="Drive Sonar Logo" />
</p>

Drive Sonar is a fast, lightweight desktop disk usage explorer and analyzer built with Tauri v2, Rust, React, and TypeScript.

Drive Sonar is inspired by the simplicity of `ncdu`. In addition, Drive Sonar provides visualizations to help gain a better idea of your disk usage.


## ⚡ Features

- **Fast Parallel Scanning:** Traverses directory trees concurrently using Rust's multi-threaded `jwalk` engine
- **Interactive Visualizations:**
  - **Space Distribution Map:** High-performance storage treemap (MB) powered by Mantine Charts
  - **Extension Breakdown:** Top 15 file extensions by storage utilization
  - **File Age Analysis:** Scatter plot visualizing file size vs. age (months since last modification)
- **In-App File Management:** Open files or folders directly in native OS file managers or safely move items to system trash
- **Security Hardened:** Path canonicalization guards against relative traversal, strict Content Security Policy (CSP), and system root deletion protection
- **Cross-Platform Compatibility:** Normalized path matching handling backslashes (`\`), forward slashes (`/`), and case insensitivity across Windows, macOS, and Linux

<p align="center">
  <img src="public/screenshot.png" width="896" alt="Drive Sonar screenshot" />
</p>


## 🚀 Getting Started

Requires Windows 10 version 1709 (October 2017 Update) or later.

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


## 📜 License

Drive Sonar is an Open-Source software, released under Apache 2.0 license.
