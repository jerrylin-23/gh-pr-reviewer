# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['gh_pr_reviewer/gui.py'],
    pathex=[],
    binaries=[],
    datas=[('gh_pr_reviewer/index.html', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='PRReviewer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['/Users/jerry/Projects/gh-pr-reviewer/packaging/assets/AppIcon.icns'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='PRReviewer',
)
app = BUNDLE(
    coll,
    name='PRReviewer.app',
    icon='/Users/jerry/Projects/gh-pr-reviewer/packaging/assets/AppIcon.icns',
    bundle_identifier=None,
)
