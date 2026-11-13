# Print Archive — local-only Bambu Lab print history for iPhone

Every time your Bambu Lab printer finishes (or fails) a job, a small **helper** on your home network copies the sliced
3MF off the printer, pulls out the thumbnail, filament use, times and print settings, and files it in a folder on your
computer. The **Print Archive** Home Screen web app on your iPhone lets you browse, search, add notes, download the file
and **reprint** it with one tap. Nothing goes through Bambu Lab's cloud.

* **Demo preview (example data):** https://sp4cecadt.github.io/print-archive/
* **Live use:** open the helper's own address on your iPhone, e.g. `http://your-mac.local:8787/`, then
  Share → **Add to Home Screen**.

> Not affiliated with or endorsed by Bambu Lab. The app icon is an original drawing; no Bambu Lab logos are used.

## Why a helper?
iPhone web apps can't run in the background or open raw MQTT/FTPS connections, so the capture runs on an always-on
computer (your Mac, a Raspberry Pi, a NAS…). The phone app only browses and reprints.

Also: the GitHub Pages copy is served over **https**, and Safari blocks an https page from calling an **http** LAN
address ("mixed content"). That's why the live app is opened from the helper itself (`http://<mac>.local:8787`). The
GitHub Pages copy always runs in **Demo mode**.

```
 Printer (LAN mode) ── MQTT TLS :8883 (status reports, print command) ──┐
                    ── FTPS implicit :990 (copy 3MF / upload reprint) ──┤
                                                                         ▼
                                     helper (Node.js) ── ~/Print Archive/ (3MF, thumb, STL, index.json)
                                                         │  REST API + PWA on :8787
                                                         ▼
                                             iPhone Home Screen app (Safari)
```

## Repo layout
| Path | What |
|---|---|
| `web/` | The PWA (vanilla JS, no build). `version.js` holds the version used by the service worker cache. `demo/` is generated example data. |
| `helper/` | Node.js helper: `src/` code, `test/` tests, `config.example.json`, `launchd/` + `scripts/` for running at login. |

## Mac helper setup (2017 Intel MacBook Pro or any always-on machine)
1. **Install Node.js 18 or newer** — download the macOS installer from https://nodejs.org (LTS), or `brew install node`.
2. **Get the code** — download this repo (Code → Download ZIP) and unzip it to e.g. `~/print-archive`.
3. **Install dependencies**
   ```bash
   cd ~/print-archive/helper
   npm install --omit=dev
   ```
4. **Printer: turn on LAN access.** On the printer screen go to *Settings → Network* (WLAN/LAN page), turn on
   **LAN Only** mode and note the **Access Code** and the printer's **IP address**. On recent firmware with Bambu's
   "authorization control", also turn on **Developer Mode** (shown under LAN Only) — without it the printer may refuse
   third-party print commands (reprint). The serial number is in *Settings → Device* (or on the sticker).
   Tip: give the printer a fixed IP (DHCP reservation) in your router.
5. **Configure**
   ```bash
   cp config.example.json config.json
   chmod 600 config.json      # it holds your LAN access code
   open -e config.json        # set printer.ip, printer.serial, printer.accessCode, archiveDir, stlWatchDir
   ```
   `stlWatchDir` is optional: if an `.stl` with the same name as the print (or the object name inside the 3MF) is in
   that folder, it's linked and copied into the archive and the entry is labelled **STL attached**.
6. **Try it**
   ```bash
   npm start            # real printer
   npm run mock         # or: simulated printer + 18 example prints, no printer needed
   ```
   macOS will ask whether *node* may accept incoming connections — click **Allow**.
7. **On your iPhone (same Wi-Fi):** open Safari at `http://<your-mac-local-hostname>.local:8787/` (the helper prints
   the exact address; find the name in *System Settings → General → Sharing → Local hostname*). Tap Share → **Add to
   Home Screen**. Open it from the Home Screen; Settings should show *Online · watching X1C*.
8. **Run at login**
   ```bash
   ./scripts/install-launchd.sh      # creates ~/Library/LaunchAgents/com.printarchive.helper.plist and starts it
   ./scripts/uninstall-launchd.sh    # to remove it later (archive is kept)
   ```
   Logs: `~/Library/Logs/print-archive-helper.log`. Keep the Mac awake on power
   (*System Settings → Battery → Options → Prevent automatic sleeping on power adapter when the display is off*),
   otherwise prints that finish while it sleeps are captured late (the helper catches the last finished job on wake
   if it hasn't been archived yet).

### Optional: helper token
Set `"apiToken": "some-long-random-string"` in `config.json` to require it for notes, settings and reprint. Enter the
same token in the app under Settings → Helper token.

## What a capture saves
| From | Data |
|---|---|
| MQTT `device/<serial>/report` | job name (`subtask_name`), file (`gcode_file`), start time (`gcode_start_time`), finish/fail time and reason, final nozzle/bed temps, loaded filament (AMS `tray_now` / external spool) |
| 3MF `Metadata/plate_N.png` | thumbnail |
| 3MF `Metadata/slice_info.config` | estimated time (`prediction`), filament grams + metres per slot, object names |
| 3MF `Metadata/project_settings.config` | layer height, infill % + pattern, supports, wall loops, speeds (outer/inner wall, infill, travel), nozzle + bed temps, printer/filament profiles |
| 3MF `3D/*.model` | whether real mesh geometry is inside → **Mesh included** (resliceable) vs **Sliced only** |
| STL watch folder | matching `.stl` → **STL attached** |
| File | name, size, printer-side modified time; stored as `~/Print Archive/YYYY-MM/<id>/file.3mf` |

The index is `~/Print Archive/index.json` (plain JSON; notes live here too).

## Reprint flow
1. Tap **Reprint** on a print. The sheet shows printer status, plate, the filament loaded now vs the filament the job
   was sliced for, and warns on a mismatch.
2. **Confirm & send** → the helper uploads the archived 3MF to the printer's storage over FTPS (`/` by default) and
   publishes the MQTT `project_file` command (`param: Metadata/plate_N.gcode`, `url: ftp:///<file>`, `use_ams`,
   `ams_mapping`, bed levelling on). It refuses if the printer is busy or offline, or if the 3MF has no sliced G-code
   for that plate.
3. If the AMS is present and "Use AMS" is on, each job filament is mapped to the AMS slot with the same type + colour;
   if any can't be matched it prints from the external spool.

If your firmware expects a different file URL, change `reprint.urlTemplate` (e.g. `file:///sdcard/{file}`).

## REST API (helper, port 8787)
`GET /api/status` · `GET /api/prints` · `GET /api/prints/:id` · `PATCH /api/prints/:id {notes}` ·
`GET /api/prints/:id/{thumb|file|stl}` · `POST /api/prints/:id/reprint {plate, useAms}` · `POST /api/printer/test` ·
`PATCH /api/config {capture, printer}` · mock only: `POST /api/mock/simulate {id, name, fail}`. CORS is open (`*`) for LAN use.

## Development
```bash
cd helper && npm install && npm test     # 3MF parser, tracker, capture, MQTT-TLS + FTPS client against local fakes, mock end-to-end
npm run build-demo                       # regenerates web/demo/ from generated sample 3MFs
```
Bump `web/version.js` whenever the web app changes so installed copies pick up the new service worker cache.
