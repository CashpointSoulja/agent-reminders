#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
build_root="$repo_root/work/native-companion"
app_dir="$build_root/AgentReminders.app"
mkdir -p "$app_dir"
sdk_path=$(xcrun --sdk iphonesimulator --show-sdk-path)
SDKROOT="$sdk_path" xcrun --sdk iphonesimulator swiftc -swift-version 5 -target arm64-apple-ios17.0-simulator -sdk "$sdk_path" \
  -framework UIKit -framework WebKit -framework EventKit -framework Security -framework CryptoKit \
  "$repo_root/native/ios/Sources/SyncCore.swift" "$repo_root/native/ios/Sources/ReminderStores.swift" \
  "$repo_root/native/ios/Sources/DeviceCredential.swift" "$repo_root/native/ios/Sources/NativeDeviceClient.swift" "$repo_root/native/ios/Sources/ConnectionController.swift" \
  "$repo_root/native/ios/Sources/main.swift" -o "$app_dir/AgentReminders"
cp "$repo_root/native/ios/Info.plist" "$app_dir/Info.plist"
plutil -replace CFBundleIdentifier -string local.rea.agentreminders.companion "$app_dir/Info.plist"
codesign --force --sign - "$app_dir" >/dev/null
printf '%s\n' "$app_dir"
