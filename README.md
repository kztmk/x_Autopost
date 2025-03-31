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

## System Architecture

The application consists of several modules:

- **API Layer**: RESTful endpoints for external interaction
- **Authentication**: X API OAuth 1.0a authentication handling
- **Media Handling**: Upload and process media files
- **Post Management**: Create, schedule, and track posts
- **Error Handling**: Comprehensive logging and notification

## API Endpoints

### POST Endpoints

The system provides several POST endpoints accessible via `doPost()`:

| Target    | Action   | Description                           |
|-----------|----------|---------------------------------------|
| `xauth`   | `create` | Create new X API authentication       |
|           | `update` | Update existing authentication        |
|           | `delete` | Delete authentication                 |
| `postData`| `create` | Create new post                       |
|           | `update` | Update existing post                  |
|           | `delete` | Delete post                           |
| `trigger` | `create` | Create time-based trigger             |
|           | `delete` | Delete all triggers                   |
| `media`   | `upload` | Upload media file                     |

### GET Endpoints

The system provides several GET endpoints accessible via `doGet()`:

| Target    | Action   | Description                           |
|-----------|----------|---------------------------------------|
| `xauth`   | `fetch`  | Fetch all X account IDs               |
| `postData`| `fetch`  | Fetch all post data                   |

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

## Workflow

1. Posts are created and stored in the "Posts" sheet
2. A time-based trigger runs `autoPostToX()` every minute
3. The function checks for posts scheduled within the next minute
4. Media is uploaded if necessary
5. Posts are published to X using OAuth 1.0a authentication
6. Published posts are moved to the "Posted" sheet
7. Errors are logged to the "Errors" sheet

## Error Handling

The system has comprehensive error handling:
- All errors are logged to the "Errors" sheet
- Error notifications can be sent via email
- Each API request returns appropriate HTTP status codes in the response payload

## Google Drive Media Storage

Media files are:
1. Uploaded to a dedicated folder in Google Drive
2. Automatically set to "anyone with the link can view"
3. Converted to accessible URLs for embedding

## Setup Instructions

1. Create a new Google Apps Script project
2. Set up Google Sheets with "Posts", "Posted", and "Errors" sheets
3. Configure X API credentials
4. Deploy as a web app

## Security Considerations

- OAuth credentials are securely stored using PropertiesService
- API endpoints validate request data
- Media upload size is restricted to prevent abuse

## Dependencies

- Google Apps Script
- Google Sheets
- Google Drive
- X API v2