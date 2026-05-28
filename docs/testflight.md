# TestFlight deployment

This repo can build the Capacitor iOS app in GitHub Actions and upload it to
TestFlight.

## Apple setup

Use your personal Apple Developer account.

1. In Apple Developer, create an explicit App ID / bundle ID, for example:

   ```text
   dev.pi.mobile
   ```

   If that ID is unavailable, choose your own reverse-DNS ID and use that same
   value for the `IOS_BUNDLE_ID` secret.

2. Create an App Store Connect app for that bundle ID.

3. Create an App Store Connect API key with permission to upload builds.

4. Create an Apple Distribution certificate and an App Store provisioning profile
   for the bundle ID.

## GitHub secrets

Add these repository secrets:

| Secret | Meaning |
| --- | --- |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID. |
| `IOS_BUNDLE_ID` | Bundle ID registered in Apple Developer / App Store Connect. |
| `APPLE_CERTIFICATE_BASE64` | Base64-encoded `.p12` Apple Distribution certificate. |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`. |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Base64-encoded App Store `.mobileprovision` profile. |
| `APP_STORE_CONNECT_KEY_ID` | App Store Connect API key ID. |
| `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect issuer ID. |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Contents of `AuthKey_<KEY_ID>.p8`. |

Encoding helpers on macOS:

```bash
base64 -i path/to/certificate.p12 | pbcopy
base64 -i path/to/profile.mobileprovision | pbcopy
pbcopy < AuthKey_XXXXXXXXXX.p8
```

## Running a build

Manual:

```bash
gh workflow run testflight.yml
```

Or push a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Tags matching `vX.Y.Z` set the marketing version to `X.Y.Z`. Untagged manual
runs use `1.0.0`. The TestFlight build number is the GitHub Actions run number.

## Phone-only loop

1. Open pi-mobile on your phone.
2. Ask remote pi to edit this repo, run checks, commit, and push.
3. Trigger the workflow from GitHub mobile/web or by asking pi to push a tag.
4. Install the new build from TestFlight after processing completes.
