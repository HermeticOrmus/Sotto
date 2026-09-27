#!/bin/sh
# Archives the iPhone app and uploads it to App Store Connect for TestFlight (ADR-0032).
# Run by .github/workflows/ios-testflight.yml on a macOS runner. Needs KEY_ID, ISSUER_ID and TEAM_ID in the
# environment, the App Store Connect key at KEY_PATH, and BUILD_NUMBER rising with every upload.
# Signing is Xcode's automatic signing with Apple's cloud-managed certificates, so no certificate or
# profile is kept anywhere; the key needs the Admin role for that.
set -eu
cd "$(dirname "$0")/.."
: "${KEY_ID:?}" "${ISSUER_ID:?}" "${TEAM_ID:?}" "${KEY_PATH:?}" "${BUILD_NUMBER:?}"
out=.build-native

xcodebuild -project Sotto.xcodeproj -scheme Sotto -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$out/Sotto.xcarchive" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive

# destination "upload" sends the signed build straight to App Store Connect; nothing is kept on the runner.
cat > "$out/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>destination</key><string>upload</string>
	<key>method</key><string>app-store-connect</string>
	<key>signingStyle</key><string>automatic</string>
	<key>teamID</key><string>$TEAM_ID</string>
	<key>manageAppVersionAndBuildNumber</key><false/>
	<key>uploadSymbols</key><false/>
</dict>
</plist>
EOF

xcodebuild -exportArchive -archivePath "$out/Sotto.xcarchive" \
  -exportOptionsPlist "$out/ExportOptions.plist" -exportPath "$out/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID"
