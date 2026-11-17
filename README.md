# Personal CRM

A local-first personal CRM for macOS, for one user. Contacts, deals, an activity
log, reminders with native notifications, a calendar and a menu bar helper —
in Latvian and English. No cloud, no accounts, no telemetry: everything lives in
one SQLite file on your Mac.

Built with **Tauri 2** (Rust) + **Svelte 5** / TypeScript / Vite.

## Prerequisites

| Tool | Install |
| --- | --- |
| Xcode Command Line Tools | `xcode-select --install` |
| Rust (rustup) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js LTS (20+) | <https://nodejs.org> or `brew install node` |

For the universal build both Apple targets are needed:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

## Run and build

```bash
npm install
npm run tauri dev
npm run tauri build -- --target universal-apple-darwin
```

The universal build produces

- `src-tauri/target/universal-apple-darwin/release/bundle/macos/Personal CRM.app`
- `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Personal CRM_1.0.0_universal.dmg`

The app is **ad-hoc signed** (`bundle.macOS.signingIdentity = "-"` in
`src-tauri/tauri.conf.json`), so it runs locally without a paid Apple Developer
account.

Other scripts:

```bash
npm test
npm run check
node scripts/check-locales.mjs
```

`npm test` runs the quick-add parser tests (Vitest), `npm run check` type-checks
the frontend, and `check-locales` verifies that `lv.json` and `en.json` have the
same keys and that every key used in the code exists.

`npm run dev` on its own serves the UI in a browser at <http://localhost:1420>
with an in-memory database — handy for UI work; native features (tray,
notifications, backups, global hotkey) only exist inside the Tauri app.

## First launch

- **Gatekeeper**: because the app is not notarised, macOS may refuse to open it
  the first time. Right-click the app → **Open** → **Open** (or allow it in
  System Settings → Privacy & Security).
- **Global hotkey** (default `Ctrl+Option+Space`): if it does not react, approve
  the app in **System Settings → Privacy & Security → Accessibility**.
- **Notifications**: allow them when asked. To see the *Snooze +15 min /
  Snooze +1 h / Mark done* buttons, set the notification style for Personal CRM
  to **Alerts** in System Settings → Notifications (banners hide the buttons
  behind a hover menu). In `tauri dev` notifications are attributed to Terminal.
- The app starts with **sample data** (5 contacts). Remove it with
  *Dzēst paraugdatus / Clear sample data* on the Summary or in Settings.

## Apple Calendar sync

Settings → **Apple Calendar** → *Sync with Apple Calendar* keeps CRM reminders in
a calendar named **CRM** (created in iCloud when available, so it also reaches
your iPhone; otherwise "On My Mac"). The first time, macOS asks for calendar
access; choose **Full Access**.

- Every pending reminder is an event (default length 30 min). Done or deleted
  reminders are removed from the calendar. Snoozing does not move the event.
- Moving, resizing or renaming an event in Calendar updates the reminder;
  deleting it deletes the reminder (the toast offers Undo). An event you create
  in the CRM calendar becomes a new reminder.
- If both sides changed since the last sync, the CRM version wins.
- Events have no alarms – the CRM already notifies you.
- Only events from one year back to three years ahead are synced (EventKit limit).
- Turning sync off leaves the existing events in the calendar. Deleting the CRM
  calendar in Calendar.app turns sync off.
- **Ad-hoc signing:** macOS ties the calendar permission to the app's signature,
  which changes with every rebuild, so a rebuilt app asks for access again on
  its first sync. If it shows as denied instead, re-enable it in System Settings
  → Privacy & Security → Calendars.

## Apple Intelligence

On an Apple Silicon Mac with Apple Intelligence turned on (macOS 26+), the CRM
uses Apple's **on-device** language model. Nothing leaves the Mac.

- **Contact summary**: ✨ *Kopsavilkums / Summary* in a contact's panel gives
  a short "where things stand" plus a suggested next step (with one-click
  reminder buttons). *Add to notes* saves it; otherwise it is not stored.
- **Next-step suggestion**: after logging an activity, the *Next step?* prompt
  also offers an AI reminder ("Send BESS offer to Dmitrijs · next Tuesday");
  one click creates it. Its timing is read by the app's own quick-add parser.
- **Paste contacts**: ✨ *Ielīmēt kontaktus / Paste contacts* in the Contacts
  view. Paste an email signature or any text with people in it, check/edit the
  rows, create them. Emails and phone numbers that don't literally appear in the
  pasted text are dropped, so the model can't invent them.

Notes:
- Latvian is not one of the model's languages, so answers come in English
  (Settings → Apple Intelligence lists the supported languages). The model
  still reads Latvian text.
- It can be wrong – results are labelled and nothing is saved without a click.
- Settings → Apple Intelligence → *Show AI features* hides everything.
- Without Apple Intelligence (Intel Mac, turned off, model downloading) the AI
  buttons simply don't appear.

### Apple's cloud model (prepared, not usable yet)

The switch *Use Apple's cloud model when the local one can't* lets the app use
Apple's larger Private Cloud Compute model (macOS 27+) when the local model is
unavailable, the text is too long, or the answer language is unsupported. Data
then goes to Apple's servers. Apple only allows this for apps with a **managed
entitlement** it grants, which needs a paid Apple Developer account, a real
signing identity and a provisioning profile. Without it, switching it on runs
one test call, which fails, and the switch stays off. To enable it later:
request access at <https://developer.apple.com/private-cloud-compute/>, add
the entitlement to `src-tauri/Entitlements.plist`, and set
`bundle.macOS.signingIdentity` and `bundle.macOS.provisioningProfile` in
`src-tauri/tauri.conf.json`. Don't add the entitlement before that: an ad-hoc
signed app with a managed entitlement may not launch.

### How it is built

Apple's model can only be called from Swift. `src-tauri/swift/CRMIntelligence`
is a small Swift package that `src-tauri/build.rs` compiles for each
architecture and links into the app; `src-tauri/src/ai.rs` calls it. Only the
Command Line Tools are needed (no Xcode). The Rust tests that exercise the real
model are ignored by default:

```bash
cd src-tauri && cargo test --lib ai:: -- --include-ignored --nocapture
```

## Where your data lives

| What | Where |
| --- | --- |
| Database | `~/Library/Application Support/lv.personalcrm.desktop/crm.db` |
| Backups (default) | `~/Documents/CRM Backups/` |
| Window size/position | `~/Library/Application Support/lv.personalcrm.desktop/.window-state.json` |

- **Backup now** copies the SQLite file as `crm-backup-<date>_<time>.sqlite`.
- An **automatic daily backup** (`crm-auto-…sqlite`) is made on the first run of
  each day; the newest 14 are kept. Manual backups are never deleted.
- **Restore from backup** replaces the database with a chosen file (a safety
  copy of the current data is made first).
- **Export / Import JSON** writes or replaces the whole database as one JSON file.
- **Export .ics** writes every reminder for Apple Calendar; each reminder also
  has its own "Export to calendar" button.

## Using it

- `Cmd+W` hides the window; the app keeps running in the menu bar so reminders
  still fire. `Cmd+Q` quits.
- **Quick add** (`Cmd+K`, or the global hotkey from any app, or the menu bar
  dropdown): type a sentence, check the live preview, press Enter.
  - `Zvanīt Jānim rīt 10:00 par rēķinu` / `Call Janis tomorrow 10:00 re invoice`
  - Latvian: `šodien, rīt, parīt, nākamnedēļ, pirmdien … svētdien, pēc 3 dienām, pēc stundas, pēc 2 stundām, plkst. 10, 10:00, 20.11.`
  - English: `today, tomorrow, day after tomorrow, next week, monday … sunday, in 3 days, in 1 hour, at 10, 10:00`
  - Contact names are matched in any Latvian case (`Jānim`, `Jāņa` → *Jānis*);
    if several contacts match, pick one with ↑ ↓.
  - No date → tomorrow at the default reminder time; a time that has already
    passed today → tomorrow.
- Everything is edited inline: click, type, Enter (or click away). `Esc` reverts.
- `Cmd+Z` undoes the last action (or use *Atsaukt / Undo* in the toast);
  `Shift+Cmd+Z` redoes. While typing in a field, `Cmd+Z` is normal text undo.
- `?` shows all shortcuts.

## Project layout

```
locales/                  lv.json, en.json – every UI string (also read by Rust)
src/
  main.ts, App.svelte     entry point and main window shell
  windows/                floating quick-add window, menu bar dropdown
  lib/
    db/                   types, SQLite client, reactive store + undo, seed, backup
    i18n/                 translation + LV/EN date & currency formatting
    quickadd/             LV/EN parser (+ tests) and the quick-add field
    reminders/            one-click reminder buttons, reminder row, .ics export
    contacts/             table, side panel, tags, freshness colours
    calendar/             month/week views, event popover, Apple Calendar sync (reconcile + runner)
    ai/                   Apple Intelligence state, calls and input/output helpers
    activities/           activity log
    summary/              home screen
    settings/             settings view + native settings sync
    ui/                   shared pieces (inline edit, toasts, icons, cheat sheet)
src-tauri/
  migrations/             versioned SQL migrations (001_init, 002_calendar_links)
  Info.plist              calendar permission text (merged into the app bundle)
  src/
    lib.rs                plugins, commands, window lifecycle
    reminders.rs          scheduler thread + native notifications with actions
    tray.rs               menu bar icon and badge
    menu.rs               native translated menu bar
    windows.rs            quick-add / tray windows, global hotkey, Dock icon
    backup.rs             backup, restore, file export helpers
    i18n.rs               reads locales/*.json for native UI text
    calendar.rs           EventKit bridge for the Apple Calendar sync
    ai.rs                 Apple Intelligence: calls the Swift bridge
  swift/CRMIntelligence/  Swift package wrapping Apple's Foundation Models
scripts/                  icon generator, locale checker
```

### How it stays fast

All data is loaded into memory once at startup; every view is derived from that
reactive state, and writes are applied to memory immediately and persisted to
SQLite in the background. There are no loading states anywhere.

### Adding a migration

Add `src-tauri/migrations/002_<name>.sql` and append a `Migration { version: 2, … }`
entry in `migrations()` in `src-tauri/src/lib.rs`. Migrations run automatically
when the database is opened.

### Regenerating icons

```bash
node scripts/make-icons.mjs && npm run tauri icon scripts/app-icon.png
```
