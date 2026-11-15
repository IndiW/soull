#!/bin/sh
set -eu
project_root=$(pwd)
app_dir="$project_root/native/build/SoullDev.app"
mkdir -p "$app_dir/Contents/MacOS" "$project_root/.cache/swift"
swiftc -module-cache-path "$project_root/.cache/swift" -framework AppKit -framework WebKit native/Soull.swift -o "$app_dir/Contents/MacOS/SoullDev"
python3 - "$app_dir" "$project_root" <<'PY'
import plistlib,sys
from pathlib import Path
app,root=sys.argv[1:]
with open(Path(app)/'Contents/Info.plist','wb') as f:
 plistlib.dump({'CFBundleName':'Soull Dev','CFBundleDisplayName':'Soull Dev','CFBundleIdentifier':'dev.soull.desktop','CFBundleExecutable':'SoullDev','CFBundleVersion':'1','CFBundleShortVersionString':'0.1.0','CFBundlePackageType':'APPL','LSMinimumSystemVersion':'14.0','NSHighResolutionCapable':True,'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'SoullProjectRoot':root},f)
PY
printf 'Built %s\n' "$app_dir"
