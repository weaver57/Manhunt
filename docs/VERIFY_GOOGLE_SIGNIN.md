# Verify Google sign-in (DEVELOPER_ERROR) — definitive procedure

`DEVELOPER_ERROR` means Google Play Services rejected the app's identity
**before Supabase or any code was involved**. There is exactly one fact that
decides success or failure:

> The fingerprint (SHA-1 **or** SHA-256) of the key that signed the APK you
> installed **must be listed** in the Google Cloud **"Android"** OAuth client
> whose project also owns the Web client ID used in the app,
> together with package name `com.manhunt.app`.

Never trust what you *think* was used. Verify the installed APK directly.

---

## Step 1 — Get the REAL fingerprint of the installed app 

With the phone connected over USB (or Wi-Fi debugging), from Git Bash:

```bash
adb shell pm path com.manhunt.app
# → package:/data/app/~~XYZ==/com.manhunt.app-ABCD==/base.apk

adb pull /data/app/~~XYZ==/com.manhunt.app-ABCD==/base.apk installed-app.apk
keytool -printcert -jarfile installed-app.apk
```

`keytool` ships with the JDK already installed for Android builds
(`keytool` alone not found? try `$(dirname $(which java))/keytool`).
Write down the **SHA-1** and **SHA-256** lines.

## Step 2 — Compare in Google Cloud

<https://console.cloud.google.com/apis/credentials> — in project
**15498625452-…** (same project as your Web client ID
`15498625452-a6bj63epveo35k62tl1s47bo2mhl7341….apps.googleusercontent.com`):

- OAuth client of type **"Android"** must contain:
  - Package name: `com.manhunt.app` (exactly — no spaces, no suffix)
  - SHA-1 **or** SHA-256 equal to Step 1's output
- The **Web** client ID must be in the same project (the app exchanges its
  ID token against the Web client's audience).

If the Android client you edited is in a *different* project, or the
fingerprint differs → that's the bug. Fix it there.

## Step 3 — Wait, then clear the device cache

After any Cloud change, Google needs a few minutes (worst case ~1 hour), and
**Google Play Services caches the last result per app**:

1. Uninstall the app from the phone.
2. Reboot the phone (fastest way to drop the cached credential judgment).
3. Open app → sign in again.

## Step 4 — Rule out the account

Very rarely an account itself carries the stale state: add a *second* Google
account on the device and attempt sign-in with that one.

---

## If Step 1–4 are all satisfied and it still fails

- Confirm the build you installed is the **same EAS build** from the same
  profile each time (multiple local/experimental releases can hide a second
  keystore — `adb shell pm path` + `keytool` always tells the truth).
- Send me: the `keytool` output, a screenshot of the Google Cloud credentials
  page (Android + Web clients), and the exact on-screen error. That is enough
  information to pinpoint it without another blind round-trip.

> Note: none of the fixes above require a rebuild — package name and
> client ID were already baked into the app. Only Cloud-side and device-side
> changes are needed from here.
