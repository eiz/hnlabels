# HN Labels

A small Chrome extension that lets you add persistent personal labels to Hacker News users.

## Features

- Adds a `+ tag` control beside each Hacker News username.
- Shows saved labels beside that username anywhere they appear on HN.
- Records edit history with the page URL and title where each edit happened.
- Opens edit history when you click an existing label.
- Uses Google Drive `appDataFolder` for private cross-device sync.
- Keeps a local cache so labels render quickly and offline edits can queue for sync.
- Exports and imports JSON backups from the toolbar popup.

## Local install

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `C:\Users\eiz\Documents\hnlabel`.
5. Visit [Hacker News](https://news.ycombinator.com/) and click `+ tag` beside any username.

## Google Drive OAuth setup

This extension uses `chrome.identity` and the Drive API. It does not load remote code.

1. In GCP, enable the Google Drive API for the project.
2. Create an OAuth client with application type **Chrome Extension**.
3. Use the Chrome extension item ID as the OAuth client item/application ID.
4. Copy the generated client ID into `manifest.json`:

   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
   }
   ```

5. Reload the unpacked extension.
6. Click the HN Labels toolbar icon and choose **Connect Google Drive**.

For stable local OAuth, add the Chrome Web Store public key to `manifest.json` as `"key"` after creating the draft item. That keeps the local unpacked extension ID aligned with the item ID used in GCP.

## Storage model

- `chrome.storage.local`: cache, sync status, pending edits, Drive file ID.
- Google Drive `appDataFolder`: private synced JSON file named `hn-labels-data.json`.
- [PRIVACY.md](PRIVACY.md) describes the stored data for Web Store privacy disclosure.

## Import and export

The toolbar popup has **Export JSON** and **Import JSON** buttons.

- Export downloads a JSON backup of labels and edit history.
- Import validates and merges a JSON backup into local data.
- Imported data is marked as pending, so it will sync to Drive if Drive is connected.
- Import is merge-only; it does not wipe existing labels.

## Store screenshots

Chrome Web Store screenshots are generated with fake Hacker News data so the listing does not show real users or posts.

```powershell
node tools\generate-screenshots.js
```

Generated screenshots are written to `assets\screenshots`.

## Files

- `manifest.json`: Chrome extension manifest, permissions, OAuth scope, popup, and background worker.
- `src/content.js`: Finds HN user links, renders labels/history, and sends edits to the background worker.
- `src/background.js`: Owns local cache, Drive OAuth, Drive API reads/writes, and merge logic.
- `src/shared/data.js`: Shared data normalization, merge, and history helpers.
- `src/popup.html`, `src/popup.css`, `src/popup.js`: Toolbar popup for connect/sync/status.
- `src/content.css`: Hacker News-styled inline UI for labels and popovers.
- `icons/icon128.png`: Web Store extension icon.
