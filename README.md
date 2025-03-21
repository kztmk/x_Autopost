# xAutoPostLibrary

This library provides functionality to schedule and automatically post content to X (formerly Twitter) using Google Sheets and Google Apps Script.

## Overview

The library allows you to manage X posts through a Google Sheet, scheduling posts for specific times. It leverages the X API to post content, including text and media, at the designated times.

## Core Features

- **X Account Authentication:** Manages and stores authentication information for X accounts.
- **Scheduled Posting:** Reads post information from a Google Sheet and posts to X at the scheduled time.
- **Media Upload:** Uploads media files from Google Drive to X.
- **Trigger Management:** Creates and deletes time-based triggers to automate the posting process.

## Additional Features

- **Concurrency Control:** Uses CacheService to prevent duplicate posting attempts within a short period.
- **Posted & Errors Sheets:** Automatically moves successfully posted entries to the "Posted" sheet and logs errors in the "Errors" sheet, providing clear tracking.
- **Error Handling:** Detailed error logs, plus optional emailed error reports.
- **Media Upload Enhancement:** Now supports direct file-to-media uploads from Google Drive, with improved MIME type checks.

## File Descriptions

### `api.ts`

This file defines the API functions that are exposed by the library. These functions are accessible via `doPost` and handle various operations based on the `functionName` parameter in the request.

- **`doPost(e: GoogleAppsScript.Events.DoPost)`:** Main function to handle incoming POST requests. It routes requests to different functions based on the `functionName` parameter.
- **`deployAsWebApp(): string`:** Returns the URL of the deployed web app.
- **`createPostsSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet)`:** Creates a "Posts" sheet in the spreadsheet with predefined headers.
- **`writeAuthInfo(e: GoogleAppsScript.Events.DoPost)`:** Stores X authentication information in the Library Properties.
- **`clearAuthInfo(): GoogleAppsScript.Content.TextOutput`:** Clears X authentication information from the Library Properties.
- **`writePostsData(e: GoogleAppsScript.Events.DoPost)`:** Writes post data to the "Posts" sheet.
- **`deletePostsData(e: GoogleAppsScript.Events.DoPost)`:** Deletes post data from the "Posts" sheet based on the provided IDs.
- **`deleteAllPostsData(e: GoogleAppsScript.Events.DoPost)`:** Deletes all post data from the "Posts" sheet.
- **`getPostsData(e: GoogleAppsScript.Events.DoPost)`:** Retrieves post data from the "Posts" sheet.

### `auth.ts`

This file contains functions related to X authentication and token management.

- **`getAccessToken(accountId: string, clientId: string): string`:** Retrieves the access token for the specified account. If the token is expired, it refreshes it.
- **`refreshAccessToken(accountId: string, clientId: string): string`:** Refreshes the access token using the refresh token.
- **`postTweetByBearerToken(content: string, mediaIds: string[], replyToPostId: string | null, accountId: string, clientId: string): any`:** Posts a tweet to X using a bearer token.
- **`storeTokens(accountId: string, accessToken: string, refreshToken: string, expiresAt: number): void`:** Stores the provided tokens in the script properties.

### `main.ts`

This file contains the main logic for automating the posting process.

- **`autoPostToX(): Promise<void>`:** Main function that runs every minute to check for scheduled posts and post them to X.
- **`postTweet(content: string, mediaIds: string[], replyToPostId: string | null, accountId: string): Promise<any>`:** Posts a tweet to X using the provided content, media IDs, and reply-to post ID.
- **`getReplyToPostId(sheet: GoogleAppsScript.Spreadsheet.Sheet, inReplyToInternal: string): string | null`:** Retrieves the post ID of a reply from the sheet.
- **`createTimeBasedTrigger(intervalMinutes: number): void`:** Creates a time-based trigger to run the `autoPostToX` function every `intervalMinutes`.
- **`deleteAllTriggers(): void`:** Deletes all triggers associated with the script.

### `media.ts`

This file handles media uploads to X.

- **`uploadMediaToX(mediaUrls: string, accountId: string): Promise<string[]>`:** Uploads media files from Google Drive to X and returns an array of media IDs.
- **`initMediaUpload(fileSize: number, mediaType: string, accountId: string): Promise<string>`:** Initializes the media upload process.
- **`finalizeMediaUpload(mediaId: string, accountId: string): Promise<void>`:** Finalizes the media upload process.
- **`checkMediaStatus(mediaId: string, accountId: string): Promise<void>`:** Checks the processing status of the uploaded media.

### `utils.ts`

This file contains utility functions used throughout the library.

- **`sortPostsBySchedule(sheet: GoogleAppsScript.Spreadsheet.Sheet): void`:** Sorts the posts in the sheet by the scheduled time.
- **`isWithinOneMinute(now: Date, scheduleDate: Date): boolean`:** Checks if a scheduled date is within one minute of the current time.
- **`sendErrorEmail(body: string, subject: string): void`:** Sends an error email to the active user.
- **`logErrorToSheet(error: Error, context: string): void`:** Logs an error to the "Errors" sheet in the spreadsheet.
- **`fetchWithRetries(url: string, options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions, retries: number = 3): GoogleAppsScript.URL_Fetch.HTTPResponse`:** Fetches a URL with retry logic.

## Usage

1.  **Deploy as Library:** Deploy the script as a library in Google Apps Script.
2.  **Create Google Sheet:** Create a Google Sheet to manage your X posts.
3.  **Set up Authentication:** Use the API functions to store your X account authentication information.
4.  **Schedule Posts:** Add post data to the "Posts" sheet, including the content, media URLs, and scheduled time.
5.  **Create Trigger:** Use the API functions to create a time-based trigger to run the `autoPostToX` function.

## Usage (Detailed)

### 1. Deploy as Library

1.  In the Google Apps Script editor, go to "Deploy" > "New deployment".
2.  Select "Library" as the type.
3.  Set a version and description.
4.  Click "Deploy".
5.  Note the Script ID. You will need this to use the library in other projects.

### 2. Enable the Library in Your Google Apps Script Project

1.  Open your Google Apps Script project.
2.  Go to "Editor".
3.  Click the "Services" icon (looks like a "+" sign next to "Services").
4.  Enter the Script ID of the library you deployed.
5.  Click "Add".
6.  You can now use the library in your project.

### 3. Sample Code

Here's an example of how to use the library to create a "Posts" sheet:

```javascript
// filepath: /path/to/your/script.gs
function initializeSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  xAutoPostLibrary.createPostsSheet(ss);
}
```

And here's an example of how to trigger the auto post function:

```javascript
// filepath: /path/to/your/script.gs
function createAutoPostTrigger() {
  xAutoPostLibrary.createTimeBasedTrigger(1); // Run every 1 minute
}
```

## Dependencies

- Google Apps Script
- Google Sheets
- X API

## License

[MIT](LICENSE)
