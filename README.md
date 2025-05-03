# X Autopost

An automated social media posting system for X (formerly Twitter) built with Google Apps Script and TypeScript.

## Overview

X Autopost is a scheduled posting system that allows you to prepare posts in advance and have them automatically published at specified times. The system uses Google Sheets as a database for post management and supports media uploads, thread replies, quoting, reposting (retweeting), and multiple account handling.

## Features

- **Scheduled Posting**: Schedule posts for specific dates and times.
- **Media Support**: Upload images and videos from Google Drive using their File IDs.
- **Thread Creation**: Create threaded replies to your own posts.
- **Quoting & Reposting**: Quote existing X posts or repost (retweet) them.
- **Multiple Account Management**: Support for multiple X accounts via `PropertiesService`. Credentials are stored securely.
- **Error Handling**: Comprehensive error logging to a dedicated Google Sheet (`Errors`).
- **REST API**: API support for managing authentication, posts, triggers, and archiving.
- **Archive System**: Archive posted content and errors to a separate spreadsheet.
- **Trigger Management**: Create, delete, and check the status of time-based triggers via API.
- **Automatic Trigger Deletion**: Automatically deletes the posting trigger if no scheduled posts remain.

## System Architecture

The application consists of several modules:

- **API Layer**: RESTful endpoints for external interaction (`apiv2.ts`, `api/*.ts`).
- **Authentication**: X API OAuth 1.0a authentication handling, reading credentials from the `PropertyesService` (`auth.ts`, `api/xauth.ts`).
- **Media Handling**: Uploads media from Google Drive to X using File IDs (`media.ts`).
- **Post Management**: Create, schedule, and track posts using Google Sheets (`api/postData.ts`).
- **Automated Posting**: Time-based triggers for scheduled posting (`main.ts`).
- **Error Handling & Utilities**: Comprehensive logging and helper functions (`utils.ts`).
- **Archive System**: Archive functionality for history management (`api/archive.ts`).
- **Type Definitions**: Centralized type definitions and constants (`types.d.ts`).

## API Endpoints

### POST Endpoints

The system provides several POST endpoints accessible via `doPost()`:

| Target     | Action            | Description                         | Module            |
| :--------- | :---------------- | :---------------------------------- | :---------------- |
| `xauth`    | `create`          | Create new X API authentication     | `api/xauth.ts`    |
|            | `update`          | Update existing authentication      | `api/xauth.ts`    |
|            | `delete`          | Delete authentication               | `api/xauth.ts`    |
| `postData` | `create`          | Create new post                     | `api/postData.ts` |
|            | `createMultiple`  | Create multiple posts at once       | `api/postData.ts` |
|            | `update`          | Update existing post                | `api/postData.ts` |
|            | `delete`          | Delete post (or all for an account) | `api/postData.ts` |
|            | `updateSchedules` | Update multiple post schedules      | `api/postData.ts` |
|            | `updateInReplyTo` | Update thread reply relationships   | `api/postData.ts` |
| `trigger`  | `create`          | Create time-based trigger           | `api/triggers.ts` |
|            | `delete`          | Delete all triggers                 | `api/triggers.ts` |
| `archive`  | -                 | Archive "Posted" or "Errors" sheets | `api/archive.ts`  |

### GET Endpoints

The system provides several GET endpoints accessible via `doGet()`:

| Target       | Action   | Description                              | Module            |
| :----------- | :------- | :--------------------------------------- | :---------------- |
| `xauth`      | `fetch`  | Fetch all X account credentials          | `api/xauth.ts`    |
| `postData`   | `fetch`  | Fetch all post data                      | `api/postData.ts` |
| `postedData` | `fetch`  | Fetch all posted data                    | `api/postData.ts` |
| `errorData`  | `fetch`  | Fetch all error data                     | `api/postData.ts` |
| `trigger`    | `status` | Check if a trigger exists for a function | `api/triggers.ts` |

## Data Structure

Constants for sheet names and headers are defined in `src/types.d.ts`.

### Posts Sheet (`Posts`)

Used for scheduling new posts. Headers defined in `HEADERS.POST_HEADERS`.

- `id`: Unique identifier for the post (e.g., UUID).
- `createdAt`: Timestamp when the post data was created.
- `postTo`: X account ID (must match an `accountId` stored in `PropertiesService`) to post from.
- `contents`: Post text content.
- `mediaUrls`: **JSON string** representing an array of media objects. Each object should have at least a `fileId` property corresponding to a file in Google Drive. Example: `[{\"fileId\":\"GOOGLE_DRIVE_FILE_ID_1\"}, {\"fileId\":\"GOOGLE_DRIVE_FILE_ID_2\"}]`
- `postSchedule`: Date and time for the scheduled post (ISO 8601 format recommended).
- `inReplyToInternal`: The `id` (from the first column) of another post in the `Posts` or `Posted` sheet that this post should reply to.
- `postId`: (Initially empty) Populated with the X post ID after successful posting, or "ERROR", or "Reposted:..."
- `inReplyToOnX`: (Initially empty) Populated with the X post ID of the tweet being replied to after successful posting.
- `quoteId`: The ID of the X post to quote.
- `repostTargetId`: The ID of the X post to repost (retweet).

### Posted Sheet (`Posted`)

Successfully posted items are moved here. Headers defined in `HEADERS.POSTED_HEADERS`. Includes most columns from `Posts` plus:

- `postedAt`: Timestamp when the post was successfully published to X.

### Errors Sheet (`Errors`)

Logs errors encountered during processing. Headers defined in `HEADERS.ERROR_HEADERS`.

- `timestamp`: Timestamp of the error.
- `context`: Context where the error occurred (e.g., function name, post ID).
- `message`: Error message.
- `stack`: Error stack trace.

### X Authentication Sheet (`PropertiesService`)

Stores X API credentials securely using Google Apps Script's `PropertiesService`. Each account's data is stored under a key like `xauth_<accountId>`. The stored value is a JSON string containing:

- `accountId`: Unique identifier for the X account (used in `postTo` column).
- `userId`: The X User ID (numeric).
- `apiKey`: X API consumer key.
- `apiKeySecret`: X API consumer secret.
- `accessToken`: X API access token.
- `accessTokenSecret`: X API access token secret.
- `note`: (Optional) A user-defined note for the account.

## Automated Posting Workflow (`main.ts`)

1.  The `autoPostToX()` function is triggered based on a schedule (e.g., every 5 minutes).
2.  It fetches the trigger interval from script properties (defaults to 5 minutes).
3.  It reads data from the `Posts` sheet.
4.  It iterates through the posts:
    - Skips posts that are already processed (have a `postId`), resulted in an error (`postId` is "ERROR"), or are missing required fields (`id`, `postTo`).
    - Uses a cache (`CacheService`) to prevent duplicate processing of the same post ID during concurrent runs.
    - Checks the `postSchedule`. If it's in the past or within the next trigger interval, the post is eligible.
    - For the **first** eligible post found:
      - Retrieves authentication details for the specified `postTo` account from `PropertiesService` using `getXAuthById()`.
      - If `repostTargetId` is present, it attempts to repost (retweet) the target tweet using the X API v2 Retweets endpoint.
      - If `mediaUrls` contains a valid JSON string, it parses it, retrieves files from Google Drive using the `fileId`s, and uploads them to X using `uploadMediaToX()`.
      - If `inReplyToInternal` is set, it finds the corresponding `postId` (the actual X ID) from the `Posted` or `Posts` sheet to use for the reply.
      - Constructs the tweet payload including text (`contents`), media IDs, reply settings (`reply.in_reply_to_tweet_id`), and quote settings (`quote_tweet_id`).
      - Publishes the post using the X API v2 tweets endpoint.
      - On success:
        - Updates the `postId` (and `inReplyToOnX` if it was a reply) in the `Posts` sheet row.
        - Moves the row from the `Posts` sheet to the `Posted` sheet.
        - Logs the success.
        - The function **exits** after processing the first eligible post (one action per trigger run).
      - On failure:
        - Logs the error to the `Errors` sheet using `logErrorToSheet()`.
        - Updates the `postId` in the `Posts` sheet to "ERROR".
    - If a post's `postSchedule` is too far in the future, the loop continues to the next post (posts are not necessarily sorted before processing in the current `main.ts` logic).
5.  After iterating through all posts, if no posts with valid schedules remain in the `Posts` sheet, the `autoPostToX` trigger is automatically deleted.

## Error Handling (`utils.ts`)

- Errors during the posting process are caught and logged to the `Errors` sheet using `logErrorToSheet()`.
- The `postId` for failed posts is set to "ERROR" in the `Posts` sheet to prevent retries.
- API functions (`apiv2.ts`, `api/*.ts`) return structured JSON responses including status and messages/data.

## Google Drive Media Storage

- Media files intended for posting should be stored in Google Drive.
- The **File ID** of each media file needs to be included in the JSON string within the `mediaUrls` column of the `Posts` sheet.
- The script uses `DriveApp.getFileById()` to access the files for uploading via `media.ts`. Ensure the script has the necessary permissions to access Drive.

## Archive System (`api/archive.ts`)

- Provides an API endpoint (`POST ?target=archive`) to copy data from the `Posted` or `Errors` sheets to a separate archive spreadsheet.
- Creates or uses an existing archive file named "X_Posted_Archive".
- Helps maintain a historical record and keep the main sheets clean.

## Setup Instructions

1.  Clone the repository or copy the code into a new Google Apps Script project.
2.  Run `npm install` to install development dependencies (TypeScript, esbuild).
3.  Run `npm run build` to transpile TypeScript to Apps Script compatible JavaScript (`build/main.js`). Copy the content of `build/main.js` into your Apps Script project's `Code.gs` file (or equivalent). Copy the content of `appsscript.json` into the Apps Script editor's `appsscript.json` manifest file.
4.  Enable the **Drive API** advanced service in the Apps Script editor (Services > Add Service > Google Drive API > Add).
5.  Set up Google Sheets with `Posts`, `Posted`, and `Errors` sheets. Ensure the header rows match the structure defined in `src/types.d.ts` (see Data Structure section). The `XAuth` sheet is **not** used.
6.  Add your X API credentials using the `xauth` API endpoints (`POST ?target=xauth&action=create` or `update`). This will store them securely in `PropertiesService`.
7.  Deploy the script as a Web App:
    - Description: (Optional) Add a description.
    - Execute as: Me
    - Who has access: Anyone (or restrict as needed, but the script needs to be executable by the trigger). **Important:** Deploying with "Anyone" access makes your API endpoints public. Consider adding authentication/authorization if needed.
8.  Create an initial time-based trigger via the API (`POST ?target=trigger&action=create`) or manually in the Apps Script editor (Triggers > Add Trigger) to run `autoPostToX` (e.g., every 5 minutes). The script will manage deleting this trigger if the post queue becomes empty.

## Trigger Management (`api/triggers.ts`)

- API endpoints allow creating and deleting triggers.
- Check trigger status: `GET ?action=status&target=trigger&functionName=autoPostToX`
- The `autoPostToX` function automatically deletes its own trigger if the `Posts` sheet has no more pending scheduled items.

## Security Considerations

- X API credentials should be handled securely. Storing them in the `XAuth` sheet requires appropriate sheet protection if collaborators have access.
- The deployed Web App URL is public if access is set to "Anyone". Implement authorization within `doGet`/`doPost` if sensitive operations need protection.

## Dependencies

- Google Apps Script Runtime & Services:
  - SpreadsheetApp
  - DriveApp
  - PropertiesService
  - CacheService
  - UrlFetchApp
  - Utilities
  - ScriptApp
  - Drive API (Advanced Google Service)
- X API v2 (Tweets, Retweets endpoints)
- X API v1.1 (Media upload endpoint - used by `media.ts`)
- TypeScript (for development)
- esbuild (for bundling/transpiling)
