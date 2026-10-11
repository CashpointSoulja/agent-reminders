#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
build_root="$repo_root/work/native-companion-tests"
mkdir -p "$build_root"
xcrun swiftc -swift-version 5 -parse-as-library -framework EventKit -framework CryptoKit -framework Security \
  "$repo_root/native/ios/Sources/SyncCore.swift" "$repo_root/native/ios/Sources/ReminderStores.swift" \
  "$repo_root/native/ios/Sources/DeviceCredential.swift" "$repo_root/native/ios/Sources/NativeDeviceClient.swift" \
  "$repo_root/native/ios/Tests/DeviceClientTests.swift" -o "$build_root/DeviceClientTests"
"$build_root/DeviceClientTests" "$@"
