#!/bin/bash
set -e

# Directories
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGING_DIR="$REPO_DIR/packaging"
DIST_DIR="$REPO_DIR/dist"
ASSETS_DIR="$PACKAGING_DIR/assets"
STAGE_DIR="$PACKAGING_DIR/dmg_stage"
DMG_DIST_DIR="$PACKAGING_DIR/dist"

echo "=== 1. Cleaning up previous builds ==="
rm -rf "$STAGE_DIR"
rm -rf "$DMG_DIST_DIR"
mkdir -p "$ASSETS_DIR"
mkdir -p "$DMG_DIST_DIR"

echo "=== 2. Copying App Icon Asset ==="
# Find the generated logo file
LOGO_SRC="$1"
if [ -z "$LOGO_SRC" ]; then
    # Fallback to looking in the user's gemini app data brain folder
    LOGO_SRC=$(find ~/.gemini/antigravity-cli/brain/959dc6a4-12f8-4dfd-b43b-4fee2694d3ab -name "career_ops_logo_*.jpg" | head -n 1)
fi

if [ -f "$LOGO_SRC" ]; then
    echo "Found logo asset at: $LOGO_SRC"
    if [ "$(cd "$(dirname "$LOGO_SRC")" && pwd)/$(basename "$LOGO_SRC")" != "$ASSETS_DIR/logo.jpg" ]; then
        cp "$LOGO_SRC" "$ASSETS_DIR/logo.jpg"
    fi
else
    echo "WARNING: Logo asset not found. Using placeholder icon."
fi

echo "=== 3. Creating .icns Icon from logo ==="
ICON_OPTION=""
if [ -f "$ASSETS_DIR/logo.jpg" ]; then
    ICONSET_DIR="$ASSETS_DIR/AppIcon.iconset"
    rm -rf "$ICONSET_DIR"
    mkdir -p "$ICONSET_DIR"
    
    # Generate the multi-size icons using sips
    sips -s format png -z 16 16     "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null
    sips -s format png -z 32 32     "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null
    sips -s format png -z 32 32     "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null
    sips -s format png -z 64 64     "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null
    sips -s format png -z 128 128   "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null
    sips -s format png -z 256 256   "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null
    sips -s format png -z 256 256   "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null
    sips -s format png -z 512 512   "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null
    sips -s format png -z 512 512   "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null
    sips -s format png -z 1024 1024 "$ASSETS_DIR/logo.jpg" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null
    
    if iconutil -c icns "$ICONSET_DIR" -o "$ASSETS_DIR/AppIcon.icns"; then
        echo "Successfully generated AppIcon.icns!"
    else
        echo "WARNING: iconutil failed. Reusing existing AppIcon.icns if available."
    fi
    rm -rf "$ICONSET_DIR"
    if [ -f "$ASSETS_DIR/AppIcon.icns" ]; then
        ICON_OPTION="--icon=$ASSETS_DIR/AppIcon.icns"
    fi
else
    echo "Skipping icon generation due to missing logo asset."
fi

echo "=== 4. Compiling App via PyInstaller (Windowed GUI) ==="
cd "$REPO_DIR"

# Ensure PyInstaller builds the windowed Cocoa app
.venv/bin/pyinstaller --clean --noconfirm --windowed \
    --name PRReviewer \
    $ICON_OPTION \
    --add-data "gh_pr_reviewer/index.html:." \
    gh_pr_reviewer/gui.py

echo "=== 5. Packaging into DMG ==="
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# Copy App bundle to DMG staging area
cp -R "$DIST_DIR/PRReviewer.app" "$STAGE_DIR/"

# Create a symlink to /Applications for easy drag-and-drop install
ln -s /Applications "$STAGE_DIR/Applications"

# Generate DMG using hdiutil
DMG_PATH="$DMG_DIST_DIR/PRReviewer.dmg"
echo "Creating DMG at $DMG_PATH..."
hdiutil create -volname "PRReviewer" -srcfolder "$STAGE_DIR" -ov -format UDZO "$DMG_PATH"

echo "=== Build Complete! ==="
echo "DMG is located at: $DMG_PATH"
