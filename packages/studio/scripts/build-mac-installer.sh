#!/bin/bash
# Build macOS .pkg installer for InkOS Studio
# Installs to /Applications/InkOS Studio.app (as a command-line app bundle)
# User data lives in ~/.inkos/ — never touched by installer/uninstaller

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STUDIO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$STUDIO_DIR/dist"
VERSION=$(node -e "console.log(require('$STUDIO_DIR/package.json').version)")

echo "Building InkOS Studio macOS installer v${VERSION}..."

# ── 1. Create app bundle structure ──
APP_BUNDLE="$DIST_DIR/InkOS Studio.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Copy executable binary
cp "$DIST_DIR/inkos-studio-mac" "$APP_BUNDLE/Contents/MacOS/inkos-studio-bin"
chmod 755 "$APP_BUNDLE/Contents/MacOS/inkos-studio-bin"

# Create launcher script that opens browser and stops Dock bouncing
cat > "$APP_BUNDLE/Contents/MacOS/inkos-studio" << 'LAUNCHER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

# Start server in background
"$DIR/inkos-studio-bin" &
PID=$!

# Wait for server to be ready, then open browser
(
  for i in $(seq 1 30); do
    curl -s -o /dev/null http://127.0.0.1:8799 && break
    sleep 0.5
  done
  open "http://127.0.0.1:8799"
) &

# Replace bash with Python Cocoa process (exec makes it the SAME PID
# macOS is tracking, so Dock bounce stops when NSApplication.run() starts)
# Cmd+Q triggers app.run() exit → atexit kills server
exec python3 -c "
import os, atexit, signal
atexit.register(lambda: os.kill($PID, signal.SIGTERM))
from AppKit import NSApplication, NSApplicationActivationPolicyRegular
app = NSApplication.sharedApplication()
app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
app.run()
" 2>/dev/null
LAUNCHER
chmod 755 "$APP_BUNDLE/Contents/MacOS/inkos-studio"

# Copy assets
cp -R "$DIST_DIR/public" "$APP_BUNDLE/Contents/Resources/public"
cp -R "$DIST_DIR/cli" "$APP_BUNDLE/Contents/Resources/cli"
cp "$DIST_DIR/core-bundle.cjs" "$APP_BUNDLE/Contents/Resources/core-bundle.cjs"

# Fix permissions: ensure all files are world-readable after pkg install (runs as root)
chmod -R a+rX "$APP_BUNDLE"

# Copy Node.js runtime for CLI subprocess
if [ -f "$DIST_DIR/node" ]; then
  cp "$DIST_DIR/node" "$APP_BUNDLE/Contents/MacOS/node"
  chmod 755 "$APP_BUNDLE/Contents/MacOS/node"
fi

# Create Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>InkOS Studio</string>
    <key>CFBundleDisplayName</key>
    <string>InkOS Studio</string>
    <key>CFBundleIdentifier</key>
    <string>com.inkos.studio</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>inkos-studio</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>LSArchitecturePriority</key>
    <array>
        <string>x86_64</string>
    </array>
</dict>
</plist>
PLIST

echo "  App bundle created: InkOS Studio.app"

# ── 2. Build DMG with Applications shortcut ──
DMG_STAGING="$DIST_DIR/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"
DMG_OUTPUT="$DIST_DIR/InkOS-Studio-${VERSION}-mac.dmg"
hdiutil create -volname "InkOS Studio" -srcfolder "$DMG_STAGING" -ov -format UDZO "$DMG_OUTPUT"
rm -rf "$DMG_STAGING"
echo "  DMG created: $DMG_OUTPUT"

# ── 3. Build .pkg installer ──
PKG_OUTPUT="$DIST_DIR/InkOS-Studio-Setup-${VERSION}-mac.pkg"

pkgbuild \
  --root "$APP_BUNDLE" \
  --identifier "com.inkos.studio" \
  --version "$VERSION" \
  --install-location "/Applications/InkOS Studio.app" \
  "$PKG_OUTPUT"

echo "  Installer created: $PKG_OUTPUT"
echo "Done. User data will be stored in ~/.inkos/"
