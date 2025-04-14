# X Autopost

An automated social media posting system for X (formerly Twitter) built with Google Apps Script and TypeScript.

## Overview

X Autopost is a scheduled posting system that allows you to prepare posts in advance and have them automatically published at specified times. The system uses Google Sheets as a database for post management and supports media uploads, thread replies, and multiple account handling.

## Features

- **Scheduled Posting**: Schedule posts for specific dates and times.
- **Media Support**: Upload images and videos from Google Drive using their File IDs.
- **Thread Creation**: Create threaded replies to your own posts.
- **Multiple Account Management**: Support for multiple X accounts via PropertiesService.
- **Error Handling**: Comprehensive error logging to a dedicated Google Sheet and optional email notifications.
- **REST API**: API support for managing authentication, posts, triggers, and archiving.
- **Archive System**: Archive posted content and errors to a separate spreadsheet.
- **Trigger Management**: Create, delete, and check the status of time-based triggers via API.
- **Automatic Trigger Deletion**: Automatically deletes the posting trigger if no scheduled posts remain.

## System Architecture

The application consists of several modules:

- **API Layer**: RESTful endpoints for external interaction (`apiv2.ts`)
- **Authentication**: X API OAuth 1.0a authentication handling (`auth.ts`)
- **Media Handling**: Uploads media from Google Drive to X using File IDs (`media.ts`)
- **Post Management**: Create, schedule, and track posts (`postData.ts`)
- **Automated Posting**: Time-based triggers for scheduled posting (`main.ts`)
- **Error Handling**: Comprehensive logging and notification (`utils.ts`)
- **Archive System**: Archive functionality for history management (`archive.ts`)

## API Endpoints

### POST Endpoints

The system provides several POST endpoints accessible via `doPost()`:

| Target     | Action            | Description                         |
| ---------- | ----------------- | ----------------------------------- |
| `xauth`    | `create`          | Create new X API authentication     |
|            | `update`          | Update existing authentication      |
|            | `delete`          | Delete authentication               |
| `postData` | `create`          | Create new post                     |
|            | `update`          | Update existing post                |
|            | `delete`          | Delete post                         |
|            | `updateSchedules` | Update multiple post schedules      |
|            | `deleteMultiple`  | Delete multiple posts               |
|            | `updateInReplyTo` | Update thread reply relationships   |
| `trigger`  | `create`          | Create time-based trigger           |
|            | `delete`          | Delete all triggers                 |
| `archive`  | -                 | Archive "Posted" or "Errors" sheets |

### GET Endpoints

The system provides several GET endpoints accessible via `doGet()`:

| Target       | Action   | Description                              |
| ------------ | -------- | ---------------------------------------- |
| `xauth`      | `fetch`  | Fetch all X account IDs                  |
| `postData`   | `fetch`  | Fetch all post data                      |
| `postedData` | `fetch`  | Fetch all posted data                    |
| `errorData`  | `fetch`  | Fetch all error data                     |
| `trigger`    | `status` | Check if a trigger exists for a function |

## Data Structure

### Post Data

Posts are stored in Google Sheets ("Posts" sheet) with the following columns:

- `id`: Unique identifier for the post (e.g., UUID).
- `createdAt`: Timestamp when the post data was created (Optional, added by some functions).
- `postTo`: X account ID (from `xauth` properties) to post from.
- `content`: Post text content.
- `media`: **JSON string** representing an array of media objects. Each object should have at least a `fileId` property corresponding to a file in Google Drive. Example: `[{"fileId":"GOOGLE_DRIVE_FILE_ID_1"}, {"fileId":"GOOGLE_DRIVE_FILE_ID_2"}]`
- `postSchedule`: Date and time for the scheduled post.
- `inReplyToInternal`: The `id` (from the first column) of another post in the "Posts" or "Posted" sheet that this post should reply to.
- `postId`: (Initially empty) Populated with the X post ID after successful posting.
- `inReplyToOnX`: (Initially empty) Populated with the X post ID of the tweet being replied to after successful posting.

### Posted Data

Successfully posted items are moved to the "Posted" sheet, which includes the columns from "Posts" plus:

- `postedAt`: Timestamp when the post was successfully published to X.

### X Authentication

Authentication data is stored in Script Properties (`PropertiesService`) with keys like `xauth_<accountId>`. Each property stores a JSON string with:

- `accountId`: Unique identifier for the X account (matches `postTo` value).
- `apiKey`: X API consumer key.
- `apiKeySecret`: X API consumer secret.
- `accessToken`: X API access token.
- `accessTokenSecret`: X API access token secret.
- `note`: (Optional) A user-defined note for the account.

## Automated Posting Workflow

1.  The `autoPostToX()` function is triggered based on a schedule (e.g., every minute).
2.  It sorts the "Posts" sheet by `postSchedule` (ascending).
3.  It checks for posts scheduled within the allowed time window (past/present or near future based on trigger interval).
4.  For the **first** eligible post found:
    - A cache system prevents duplicate processing during concurrent runs.
    - If the `media` column contains a valid JSON string, it parses it, retrieves files from Google Drive using the `fileId`s, and uploads them to X using the simple media upload endpoint (v1.1).
    - If `inReplyToInternal` is set, it finds the corresponding `postId` from the "Posted" or "Posts" sheet.
    - OAuth 1.0a authentication is used for all X API requests.
    - The post (with text, media IDs, and reply ID if applicable) is published using the X API v2 tweets endpoint.
    - On success, the post data is moved from the "Posts" sheet to the "Posted" sheet, and the `postId` and `postedAt` columns are updated.
    - The function **exits** after the first successful post (1 post per trigger run).
5.  If a post's `postSchedule` is too far in the future, the loop breaks (since posts are sorted).
6.  After the loop, if no posts with valid schedules remain in the "Posts" sheet, the `autoPostToX` trigger is automatically deleted.

## Error Handling

The system has comprehensive error handling:

- All errors are logged to the "Errors" sheet with timestamp, context, message and stack trace
- Error notifications can be sent via email using `sendErrorEmail()`
- Each API request returns appropriate HTTP status codes in the response payload
- Detailed error logs are maintained via the Logger service

## Google Drive Media Storage

- Media files intended for posting should be stored in Google Drive.
- The **File ID** of each media file needs to be included in the JSON string within the `media` column of the "Posts" sheet.
- The script uses `DriveApp.getFileById()` to access the files for uploading. Ensure the script has the necessary permissions to access Drive. File sharing permissions ("anyone with the link can view") are **not** automatically handled by this script version.

## Archive System

The system includes an archive functionality that:

1. Copies data from "Posted" or "Errors" sheets to a separate archive spreadsheet
2. Creates or uses an existing archive file named "X_Posted_Archive"
3. Names each archived sheet according to user specifications
4. Maintains a complete historical record of all posted content

## Setup Instructions

1.  Clone the repository or copy the code into a new Google Apps Script project.
2.  Enable the **Drive API** advanced service in the Apps Script editor (Resources > Advanced Google services > Drive API > ON).
3.  Set up Google Sheets with "Posts", "Posted", and "Errors" sheets. Ensure the header rows match the expected structure (see Data Structure section).
4.  Configure X API credentials using the `xauth` API endpoints (e.g., using Postman or `curl`). Store at least one account.
5.  Deploy the script as a Web App:
    - Execute as: Me
    - Who has access: Anyone (or restrict as needed, but the script needs to be executable).
6.  Create an initial time-based trigger via the API or manually in the Apps Script editor to run `autoPostToX` (e.g., every 5 minutes). The script will manage deleting this trigger if the post queue becomes empty.

## Trigger Management

The system provides functions to manage Google Apps Script triggers:

- Create time-based triggers with specified interval
- Delete all existing triggers
- Check if a trigger exists for a specific function:
  ```
  GET ?action=status&target=trigger&functionName=autoPostToX
  ```
  Returns information about whether the specified function has an active trigger.
- The `autoPostToX` function includes logic to automatically delete its own trigger if it finds no remaining posts with valid schedules in the "Posts" sheet after a run.

## Security Considerations

- OAuth credentials are securely stored using PropertiesService
- API endpoints validate request data and handle errors gracefully
- Media upload size is restricted to prevent abuse
- Response includes status codes to indicate success or failure

## Dependencies

- Google Apps Script Runtime
- Google Sheets Service
- Google Drive Service (`DriveApp`)
- Google Drive API v2 or v3 (Advanced Service)
- Properties Service
- Cache Service
- UrlFetch Service
- Utilities Service
- X API v2 (Tweets endpoint)
- X API v1.1 (Media upload endpoint)
- TypeScript (for development)
- esbuild (for bundling/transpiling)
