# X Autopost

An automated social media posting system for X (formerly Twitter) built with Google Apps Script and TypeScript.

## Overview

X Autopost is a scheduled posting system that allows you to prepare posts in advance and have them automatically published at specified times. The system uses Google Sheets as a database for post management and supports media uploads, thread replies, and multiple account handling.

## Features

- **Scheduled Posting**: Schedule posts for specific dates and times
- **Media Support**: Upload and attach images to your posts
- **Thread Creation**: Create threaded replies to your own posts
- **Multiple Account Management**: Support for multiple X accounts
- **Error Handling**: Comprehensive error logging to spreadsheet and email notifications
- **REST API**: Full API support for integration with other services
- **Archive System**: Archive posted content and errors to separate spreadsheets

## System Architecture

The application consists of several modules:

- **API Layer**: RESTful endpoints for external interaction (`apiv2.ts`)
- **Authentication**: X API OAuth 1.0a authentication handling (`auth.ts`)
- **Media Handling**: Upload and process media files (`media.ts`)
- **Post Management**: Create, schedule, and track posts (`postData.ts`)
- **Automated Posting**: Time-based triggers for scheduled posting (`main.ts`)
- **Error Handling**: Comprehensive logging and notification (`utils.ts`)
- **Archive System**: Archive functionality for history management (`archive.ts`)

## API Endpoints

### POST Endpoints

The system provides several POST endpoints accessible via `doPost()`:

| Target     | Action   | Description                         |
| ---------- | -------- | ----------------------------------- |
| `xauth`    | `create` | Create new X API authentication     |
|            | `update` | Update existing authentication      |
|            | `delete` | Delete authentication               |
| `postData` | `create` | Create new post                     |
|            | `update` | Update existing post                |
|            | `delete` | Delete post                         |
| `trigger`  | `create` | Create time-based trigger           |
|            | `delete` | Delete all triggers                 |
| `media`    | `upload` | Upload media file                   |
| `archive`  | -        | Archive "Posted" or "Errors" sheets |

### GET Endpoints

The system provides several GET endpoints accessible via `doGet()`:

| Target       | Action  | Description             |
| ------------ | ------- | ----------------------- |
| `xauth`      | `fetch` | Fetch all X account IDs |
| `postData`   | `fetch` | Fetch all post data     |
| `postedData` | `fetch` | Fetch all posted data   |
| `errorData`  | `fetch` | Fetch all error data    |

## Data Structure

### Post Data

Posts are stored in Google Sheets with the following columns:

- `id`: Unique identifier for the post
- `postSchedule`: Date and time for the scheduled post
- `postTo`: X account ID to post from
- `content`: Post content/text
- `media`: Media URLs (comma-separated)
- `inReplyToInternal`: ID of another post this is replying to
- `postId`: X post ID after posting
- `inReplyToOnX`: X post ID this is replying to

### X Authentication

Authentication data includes:

- `accountId`: Unique identifier for the X account
- `apiKey`: X API consumer key
- `apiKeySecret`: X API consumer secret
- `apiAccessToken`: X API access token
- `apiAccessTokenSecret`: X API access token secret

## Automated Posting Workflow

1. The `autoPostToX()` function is triggered to run every minute via a time-based trigger
2. It checks for posts scheduled within the next minute
3. For each post due for publication:
   - A cache system prevents duplicate processing
   - Media is uploaded if attached to the post
   - Reply relationships are resolved
   - OAuth 1.0a authentication is used for X API requests
   - The post is published using X API v2
   - Published posts are moved from "Posts" to "Posted" sheet
   - The sheet is sorted to maintain chronological order

## Error Handling

The system has comprehensive error handling:

- All errors are logged to the "Errors" sheet with timestamp, context, message and stack trace
- Error notifications can be sent via email using `sendErrorEmail()`
- Each API request returns appropriate HTTP status codes in the response payload
- Detailed error logs are maintained via the Logger service

## Google Drive Media Storage

Media files are:

1. Uploaded to a dedicated folder in Google Drive
2. Automatically set to "anyone with the link can view" using Drive API
3. Converted to accessible URLs for embedding in posts

## Archive System

The system includes an archive functionality that:

1. Copies data from "Posted" or "Errors" sheets to a separate archive spreadsheet
2. Creates or uses an existing archive file named "X_Posted_Archive"
3. Names each archived sheet according to user specifications
4. Maintains a complete historical record of all posted content

## Setup Instructions

1. Create a new Google Apps Script project
2. Set up Google Sheets with "Posts", "Posted", and "Errors" sheets
3. Configure X API credentials using the xauth API endpoints
4. Deploy as a web app with appropriate permissions
5. Set up time-based triggers for the `autoPostToX()` function

## Security Considerations

- OAuth credentials are securely stored using PropertiesService
- API endpoints validate request data and handle errors gracefully
- Media upload size is restricted to prevent abuse
- Response includes status codes to indicate success or failure

## Dependencies

- Google Apps Script
- Google Sheets
- Google Drive API v3 (advanced service)
- X API v2
- TypeScript
