# Collied

A personal offline music player for Android. Pure black, made for OLED. It plays the songs on your phone, keeps its own listening stats, and can merge those stats with a Rhythm backup.

Collied is built for one person's daily use. It is not a commercial product.

## What it does

**Library**
- Add songs from your phone (mp3, m4a, flac, wav, ogg, opus, aac). Songs are kept inside the app.
- Songs, Favourites, Playlists and Artists views, with search.
- Reads title, artist, album, cover and embedded lyrics from ID3v2, FLAC and MP4 tags.

**Player**
- Mini bar and full player. Swipe the full player down to shrink it, swipe the mini bar up to open it.
- Cover gestures: one tap opens lyrics, double tap plays or pauses, swipe left or right for next or previous.
- Queue, shuffle, repeat (off, all, one), speed and pitch, sleep timer.
- Loop a part of a song (A-B), and a start point per song to skip intros.
- Soft fade on play, pause and song change.
- Beat glow at the bottom of the screen that moves with the music. Speed, brightness and height are adjustable.

**Covers and lyrics**
- Looks on the phone first: the tag inside the file, the same album, saved lyrics and `.lrc` files next to the song.
- Only what is still missing is looked up online: covers from iTunes, lyrics from lrclib.net. Results are kept on the phone.
- Synced lyrics follow the song. Press and hold a line to jump to it.

**Stats**
- All time, 30 days, 7 days and a Day view (listening time, plays, first and last play, plays by hour, and the list of plays for that day).
- A play counts when you listen to at least 30 seconds or half of the song, whichever is shorter.

**Rhythm stats**
- Import a Rhythm backup (`.json`): stats, playlists and favourites come in.
- Collied keeps a master copy of the stats. An import only adds and never lowers a number, and the same play is never counted twice.
- Export one merged backup. Real-time sync with Rhythm is not possible, so this file is the bridge.

**Look**
- Pure black background, liquid glass surfaces, accent colour and font options, animations that can be switched off.

**Android app (APK)**
- System media notification with cover, seek bar, previous, play or pause, next, shuffle and repeat. Works on the lock screen too.
- Headphone and Bluetooth buttons: play or pause, next, previous.
- "Check for updates" in the Backup tab reads your GitHub Releases and gives the APK download link.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `style.css` | Screens and design |
| `app.js` | Everything the app does |
| `meta.js` | Reads tags and covers from song files |
| `sw.js`, `manifest.json`, `icon-*.png` | Installable web app (PWA) |
| `package.json`, `capacitor.config.json` | Android wrapper (Capacitor) |
| `.github/workflows/build.yml` | Builds the signed APK |

There is no server and no account. Songs, stats and settings live in the browser storage of the app on your phone.

## Use it in a browser (PWA)

1. Turn on GitHub Pages for this repo (Settings, Pages, deploy from the main branch).
2. Open the page in Chrome on Android and choose Install app.

## Build the APK

The APK is built on GitHub, so no computer or Android Studio is needed.

**One time**
1. Make a keystore (Termux): 
   ```
   pkg install openjdk-17
   keytool -genkeypair -v -storetype PKCS12 -keystore collied.jks -alias collied -keyalg RSA -keysize 2048 -validity 36500
   base64 -w0 collied.jks > ks.txt
   ```
   Use the same password for the store and the key.
2. Add these repository secrets (Settings, Secrets and variables, Actions):
   - `KEYSTORE_BASE64`: the text of `ks.txt`
   - `KEYSTORE_PASSWORD`: your password
   - `KEY_ALIAS`: `collied`
   - `KEY_PASSWORD`: only if different from the store password
3. Keep `collied.jks` and the password safe outside GitHub. Never commit them. If you lose the keystore, new APKs can no longer be installed over the old app.

**Every release**
1. Replace the web files in the repo.
2. Releases, Draft a new release, create a new tag higher than the last one (for example `v1.8`), Publish.
3. After about 5 to 10 minutes the APK `Collied-v1.8.apk` appears on that release.

The version shown in the app is taken from the tag. A new APK installs over the old one and keeps songs and stats, as long as these never change: the package name `com.collied.player`, the keystore, and `androidScheme: https` in `capacitor.config.json`.

In the app, open Backup, Updates, tap Change repo and enter `yourname/yourrepo`, then Check for updates.

## Good to know

- Songs and stats in the browser version (PWA) and in the APK are separate. To move stats, export a backup from one and import it in the other. Songs have to be added again.
- On Android 13 and newer, allow notifications for the media card to show.
- For music to keep playing with the screen off, set battery use for Collied to Unrestricted.
- Restoring a Collied export back into Rhythm has not been verified.
- Phone makers' battery rules can still stop background playback on some devices.

## Privacy

Everything stays on your phone. The only network calls are the cover search (iTunes), the lyrics search (lrclib.net) and the update check (GitHub). Nothing about you is sent anywhere else. This repo is public, so never put keys or passwords in it.
