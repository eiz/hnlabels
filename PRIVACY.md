# HN Labels Privacy Policy

Last updated: May 8, 2026

HN Labels is a Chrome extension for adding personal labels to Hacker News users.

## Data the extension stores

HN Labels stores:

- Hacker News usernames you label.
- Labels you create for those usernames.
- Edit history for labels, including timestamps.
- The Hacker News page URL and page title where each label edit happened.
- Sync status metadata, such as the Google Drive app data file ID and last sync time.

## Where data is stored

HN Labels stores data locally in Chrome extension storage.

If you connect Google Drive, HN Labels also stores the same label data in a private Google Drive `appDataFolder` file named `hn-labels-data.json`. This app data folder is not visible in your normal Google Drive file list and is only accessible to HN Labels through the Drive API permission you approve.

HN Labels also lets you export and import your label data as JSON files.

## How data is used

HN Labels uses stored data only to:

- Show your labels beside Hacker News usernames.
- Show label edit history.
- Sync your labels across browsers through your Google Drive account, if you choose to connect Drive.
- Import or export your label data when you choose those actions.

## Data sharing

HN Labels does not sell, rent, or share your data with third parties.

HN Labels does not send your data to any developer-operated server.

When Google Drive sync is enabled, data is sent only to Google Drive using Google's Drive API and stored in your Google account.

## Remote code

HN Labels does not load or execute remote code. All extension code is packaged with the extension.

## Permissions

HN Labels requests these Chrome permissions:

- `storage`: store labels, history, sync metadata, and cached data.
- `identity`: let you sign in and authorize Google Drive sync.
- `https://www.googleapis.com/*`: read and write the private Google Drive app data file used for sync.
- `news.ycombinator.com`: add the label UI to Hacker News pages.

## Contact

For questions about this privacy policy, contact the extension publisher through the Chrome Web Store listing.
