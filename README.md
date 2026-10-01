# File Converter

Electron app that converts **CBR/RAR/CB7** archives to **ZIP** or **CBZ**. After a successful conversion it can **delete the original file**.

## Requirements

- **[Node.js](https://nodejs.org/) 18 or later** (needed to run from source or to build a package)
- **7-Zip** at runtime (the app does not bundle it)

| OS | 7-Zip install | What the app looks for |
| --- | --- | --- |
| Windows | [7-Zip](https://www.7-zip.org/) | `C:\Program Files\7-Zip\7z.exe`, or `7z.exe` on `PATH` |
| macOS | Homebrew: `brew install p7zip` | `7z` / `7zz` in `/opt/homebrew/bin`, `/usr/local/bin`, or `PATH` |
| Linux | distro package (see below) | `7z` / `7zz` / `7za` on `PATH` or in `/usr/bin` |

### 7-Zip on Linux

```bash
# Debian / Ubuntu
sudo apt update
sudo apt install p7zip-full

# Fedora
sudo dnf install p7zip p7zip-plugins

# Arch
sudo pacman -S p7zip
```

Confirm it works with `7z` (or `7zz`) in a terminal before converting files.

## Run from source

Works on Windows, macOS, and Linux:

```bash
git clone https://github.com/exportsmedia/file-converter.git
cd file-converter
npm install
npm start
```

## Build a packaged app

Install dependencies once, then package **on the OS you want to ship**:

```bash
npm install
```

| OS | Command | Output in `dist/` |
| --- | --- | --- |
| Windows | `npm run dist:win` | `File Converter Setup 1.0.0.exe` (NSIS installer) |
| macOS | `npm run dist:mac` | `File Converter-1.0.0.dmg` |
| Linux | `npm run dist:linux` | `.AppImage` and `.deb` |

`npm run dist` builds for the machine you are on. `npm run pack` writes an unpacked app folder without an installer, useful for a quick local check.

Build each platform on that platform. A Mac `.dmg` needs macOS. Windows and Linux packages are produced on Windows and Linux respectively.

### Install the package

**Windows** — run the NSIS setup `.exe` and follow the wizard. Launch **File Converter** from the Start menu.

**macOS** — open the `.dmg` and drag **File Converter** into **Applications**. The build is unsigned, so the first launch may require **Control-click → Open** (or System Settings → Privacy & Security) instead of a double-click.

**Linux** — either:

```bash
chmod +x "File Converter-1.0.0.AppImage"
./"File Converter-1.0.0.AppImage"
```

or install the `.deb` on Debian/Ubuntu:

```bash
sudo dpkg -i file-converter_1.0.0_amd64.deb
```

7-Zip still needs to be installed on the machine that **runs** the app, including after you install a packaged build.

## Usage

- **+ add files** / **Add folder** / drop files onto the window
- **Save as** ZIP or CBZ (CBZ is the default)
- Convert writes next to the source, then deletes the original if that checkbox is on
- **Clean comic names** (on by default) writes `Series 003 (Year)` — ComicInfo.xml when present, otherwise it strips scene tags like `(digital)` and scanner groups from the filename. Already-matching ZIP/CBZ files are renamed in place when the cleaned name differs (including oddly cased extensions like `.cbZ` → `.cbz`); if the name is already clean they are skipped. Unsupported types stay skipped.
- You can add or remove Waiting/Skipped rows while a run is going; **Stop** cancels the current file

## Conversion map (v1)

| Save as | Converts from | Skipped |
| --- | --- | --- |
| ZIP | `.cbr`, `.rar`, `.cb7` | already `.zip` when Clean comic names is off; plus `.pdf`, `.docx`, images, and anything else |
| CBZ | `.cbr`, `.rar`, `.cb7` | already `.cbz` when Clean comic names is off; plus the same unsupported types |

When Clean comic names is on, already-matching `.zip` / `.cbz` files are renamed in place when the cleaned name differs (no re-archive), including normalizing the extension to lowercase; if the name is already clean they are **Skipped**. Unsupported files still show in the list as **Skipped**. They are not written and the original is not deleted.

## License

[MIT](LICENSE)
