#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
app="$repo_root/work/native-section-export/RemindersSectionExport.app"
mkdir -p "$app/Contents/MacOS"
chmod 700 "$repo_root/work/native-section-export"
clang -fobjc-arc -Wall -Wextra -Wno-unused-parameter -framework Cocoa -framework EventKit "$repo_root/native/ios/mac-sections/SectionExport.m" -o "$app/Contents/MacOS/RemindersSectionExport"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.agentreminders.sectionexport</string>
<key>CFBundleExecutable</key><string>RemindersSectionExport</string>
<key>CFBundleName</key><string>Reminders Section Export</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSRemindersFullAccessUsageDescription</key><string>Read only the reminder lists you select to preserve their original sections in a private import. No Apple reminders are edited or uploaded.</string>
<key>NSRemindersUsageDescription</key><string>Read only the reminder lists you select for a private section-aware import.</string>
</dict></plist>
PLIST
codesign --force --sign - "$app" >/dev/null 2>&1
"$app/Contents/MacOS/RemindersSectionExport" --self-test
printf '%s\n' "$app"
