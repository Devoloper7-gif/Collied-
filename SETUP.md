# Collied APK setup (phone only)

## 1. Files into the repo
- Repo root: your web files (index.html, style.css, app.js, meta.js, sw.js, manifest.json, icons) + package.json, capacitor.config.json, .gitignore
- Workflow: GitHub web > Add file > Create new file > name it `.github/workflows/build.yml` (type the slashes in the name box) > paste the content of build.yml from this zip.

## 2. Keystore (once, in Termux)
    pkg install openjdk-17
    keytool -genkeypair -v -storetype PKCS12 -keystore collied.jks -alias collied -keyalg RSA -keysize 2048 -validity 36500
    base64 -w0 collied.jks > ks.txt
- Use the same password for store and key. Remember it.
- BACK UP collied.jks and the password somewhere outside GitHub (Drive, etc.). Lose it = no more updates over the old app.
- Never put collied.jks in the repo (the .gitignore blocks it).

## 3. Secrets (repo > Settings > Secrets and variables > Actions > New repository secret)
- KEYSTORE_BASE64  = the whole text of ks.txt
- KEYSTORE_PASSWORD = your password
- KEY_ALIAS = collied
- KEY_PASSWORD = (optional, only if different from the store password)
Delete ks.txt after pasting.

## 4. Make a release
Releases > Draft a new release > Choose a tag > type v1.6.1 > Create new tag > Publish.
The workflow runs (about 5-10 min) and attaches Collied-v1.6.1.apk to that release.
Each new release needs a higher tag (v1.6.2, v1.7 ...). The app version is stamped from the tag automatically.

## 5. Updates
Install the APK once. Later APKs install over it and keep songs/stats, because the package name (com.collied.player), the keystore and the origin (https://localhost) never change. Do not edit appId or androidScheme in capacitor.config.json.
In the app: Backup tab > Updates > Change repo (yourname/yourrepo) > Check for updates.
