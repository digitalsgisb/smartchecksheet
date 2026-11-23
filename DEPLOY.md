# Deploy Smart Checksheet at a site

A site is one **AI PC** (Linux + Docker) that hosts the app, plus one **Raspberry Pi per machine line**.
Everything is done with one command, `deploy/site.sh`. It asks plain questions, generates the
passwords and tokens itself, and never overwrites existing settings or data.

| I want to… | Run on the AI PC |
| --- | --- |
| Install a new site (or change basic settings) | `bash deploy/site.sh setup` |
| Get the latest version | `bash deploy/site.sh update` |
| Connect a machine line (ABB2 / ABB3 / ABB7) | `bash deploy/site.sh add-line ABB7` |
| Find out why something is not working | `bash deploy/site.sh doctor` |
| Save a copy of the database | `bash deploy/site.sh backup` |
| Keep the nightly backup in Google Drive | `bash deploy/site.sh drive-backup` |

## 1. New site

On the AI PC (needs Docker Engine with the Compose plugin, and git):

```bash
git clone https://github.com/digitalsgisb/smartchecksheet.git /srv/apps/smartchecksheet
```

```bash
cd /srv/apps/smartchecksheet && bash deploy/site.sh setup
```

Setup asks two things: how tablets reach the app (plant network address, or an HTTPS address) and,
optionally, the Attendance read-only token. It then builds and starts the app, prints the address
to open, and shows the administrator password **once** — write it down.

Sign in, open **User Management**, and create one account per tablet with its line.
Every line works immediately in manual-entry mode. Connecting the machine is step 2 and can wait.

## 2. Connect a machine line

### From the app (recommended)

Sign in as the developer account and open **Lines & machines**. Nothing on this page needs a file edit or a restart.

1. **Add line**: type the code (for example `ABB4`). It appears in User Management and the line menu (reload the app once).
2. **User Management**: create the line's tablet account and give it only that line. The account sees only this line, and this line reads only its own Pi.
3. **Connect Pi**: enter the Pi address, broker port (1883), broker username and password, and the line label used in the Pi's shift IDs (`20261106-Day-MF` → `MF`). The app connects straight away; the card shows whether fresh machine data arrives.
4. **Pi relay installer**: enter this PC's address as the Pi sees it and press **Download installer**. Copy the file to the Pi, run `sudo bash install-pi-ABB4.sh`, then delete the file (it holds the line's private relay token).
5. Open the Pi's broker to this PC (below), then set the line's **Models** link in **Apps Script links**.

The broker password and relay token are stored in the database, encrypted with `CHECKSHEET_SECRET_KEY`, which the
first update creates in `.env.docker`. Keep `.env.docker` with your backups: without the key the saved Pi logins cannot be
read and must be entered again (and the relay reinstalled). Lines from `machines.json` keep working and are shown read-only.
The Pi must reach this PC: with an HTTPS-only setup, enter the HTTPS address when downloading the installer.

### From the command line (older method)

Lines are not fixed: each site lists its own (ABB2, ABB3, ABB7 at Port Klang; SDY1, SDY2 at Sendayan, or any new
code of 2-8 capital letters/digits such as `ABB4`). Setup asks for the list and stores it as `PRODUCTION_LINES`;
`add-line` adds the line if it is missing. Adding a line needs no code change.

**Before you add a line,** its Pi program must speak the tablet protocol (the `line_code` in live data, a reply on
`<line>/shift_form_result`, and the shared downtime timer on `<line>/downtime_result`). ABB2, ABB3, ABB7 and SDY1
do after their latest updates; for a new line, copy the closest tracker and check it with `doctor`.

On the AI PC:

```bash
bash deploy/site.sh add-line ABB7
```

It asks for the Pi's address, the line label used in that Pi's shift IDs (ABB7 is `MF`), the broker
sign-in, and the two Apps Script links for the model and manpower lists (only if
`deploy/config/abb7-catalog.json` does not exist yet). The new settings are checked in a separate
container **before** the running app is restarted; if anything is wrong, or the app does not come
back healthy, the previous settings are restored automatically.

It finishes by printing two commands that copy a ready-made folder to the Pi and install it:

```bash
scp -r /srv/apps/smartchecksheet/deploy/config/pi-ABB7  PI_USER@PI_ADDRESS:/tmp/
```

```bash
ssh -t PI_USER@PI_ADDRESS 'sudo bash /tmp/pi-ABB7/install.sh'
```

The Pi installer finds the line's tracker service, account and database by itself, installs the
event relay as a service, and reports anything that still needs attention. It does not touch the
sensor program, GPIO, Node-RED, Google Sheets or the broker. If detection is wrong, add
`--user NAME` and/or `--db /path/to/abbN_state.db`.

### Open the broker (once per Pi, in a planned stop)

Each Pi's Mosquitto normally accepts connections only from the Pi itself. The AI PC must reach it
on port 1883 for live counts and tablet commands. This is the one step that is still manual,
because it restarts the broker that the running sensor program and Node-RED use. Back up
`/etc/mosquitto/` first, then follow section 5 of [DEPLOYMENT-AI-PC.md](./DEPLOYMENT-AI-PC.md)
(listener, password file, ACL). Keep the Pi's own local access working, and never share one broker
between two lines: the command topics are identical on every line.

Afterwards `bash deploy/site.sh doctor` on the AI PC shows, per line, whether the broker is
reachable and whether fresh machine data is arriving.

## 3. Updates

```bash
cd /srv/apps/smartchecksheet && bash deploy/site.sh update
```

This backs up the database, pulls the latest version, builds it while the current version keeps
running, swaps it in, and rolls back to the previous image if the new one is unhealthy. Tablets
update themselves about a minute after they are idle. Pushing to `main` does the same thing
automatically once the GitHub runner in [AUTOMATIC-UPDATES.md](./AUTOMATIC-UPDATES.md) is set up.

## What is stored where

| Item | Location | In Git? |
| --- | --- | --- |
| Passwords, tokens, mode | `.env.docker` | No |
| Machine list, catalogs, Pi folders | `deploy/config/` | No |
| Accounts and production records | Docker volume `checksheet-data` | No |
| Database copies (newest 14) | `backups/` | No |
| Nightly database copies (newest 14, 02:00) | `backups/` inside the volume | No |
| Nightly copies in Google Drive (newest 30) | Drive folder "Smart Checksheet backups" | No |

### Nightly backup to Google Drive

The app copies its database every night at 02:00 (Malaysia time) and keeps the newest 14 copies in the volume. Sign-in sessions are left out of every copy, so after a restore everyone signs in again. To also send each copy to Google Drive:

1. In the app open **Backups** and download the Drive backup Apps Script. Paste it into a new project at script.google.com, signed in to the Google account that should own the backups.
2. **Project Settings → Script properties**: add `BACKUP_TOKEN` with a long random password (24 or more letters and numbers).
3. **Deploy → New deployment → Web app**. Set *Execute as: Me* and *Who has access: Anyone*, then authorise and copy the `/exec` link.
4. On the AI PC run `bash deploy/site.sh drive-backup` and paste the link and the same token. The link and token are stored only in `.env.docker`.
5. In the app press **Backups → Back up now**. The Drive card should show the new file.

Copies go to the Drive folder *Smart Checksheet backups* as `.sqlite.gz` files. The newest 30 are kept, and older ones go to the Drive Bin. To restore one, unzip it and copy it over `/app/data/production.sqlite` while the app is stopped. Keep a copy of `.env.docker` somewhere safe as well: saved Pi logins can only be read with its `CHECKSHEET_SECRET_KEY`.

Never run `docker compose down -v`: it deletes the volume with all accounts and records.

## When something is wrong

Run `bash deploy/site.sh doctor` first. It names the failing part in plain words.

| Symptom | Usual cause |
| --- | --- |
| Tablet returns to sign-in immediately | Site is set to HTTPS but opened over `http://`. Run setup and choose 1, or use the HTTPS address |
| Attendance tab empty or unavailable | No token, token revoked, or Attendance container stopped |
| Line shows disconnected | Pi off, broker not opened to the AI PC, wrong broker sign-in, or Pi clock wrong |
| Counts arrive but rejects/parameters stay pending | Relay not running on the Pi: `sudo journalctl -u 'checksheet-relay@*' -n 40` |
| Old layout on a tablet | Open `/api/app-update` on that tablet and press **Reload latest app** |

Detailed background: [README.md](./README.md), [MULTILINE-PYTHON-SETUP.md](./MULTILINE-PYTHON-SETUP.md),
[DEPLOYMENT-AI-PC.md](./DEPLOYMENT-AI-PC.md).
