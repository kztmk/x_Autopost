export interface XAuthInfo {
  accountId: string;
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
  note?: string; // 任意のメモフィールド
}

export interface XPostData {
  id?: string;
  createdAt?: string;
  postSchedule?: string;
  postTo?: string;
  contents?: string;
  mediaUrls?: string; // Changed from media
  inReplyToInternal?: string;
  postId?: string;
  inReplyToOnX?: string;
  quoteId?: string; // Added
  repostTargetId?: string; // Added
  status?: string; // Added: 'queued', 'posted', 'failed', etc.
  errorMessage?: string; // Added: error message if status is 'failed'
}

export interface XPostedData extends XPostData {
  postedAt: string;
}

export interface TriggerProps {
  intervalMinuts: number;
}

export interface PostError {
  timestamp: string;
  context: string;
  message: string;
  stack: string;
  postContent: string;
}

export interface PostScheduleUpdate {
  id: string;
  postSchedule: string; // ISO 8601 形式の文字列などを期待
}

export interface UpdateResult {
  id: string;
  status: "updated" | "not_found" | "error";
  postSchedule: string;
  message?: string;
}

export interface UpdateInReplyToResult {
  id: string;
  status: "updated" | "not_found" | "error";
  inReplyToInternal: string;
  message?: string;
}

export interface PostDeletion {
  id: string; // ID of the post to delete, or "all"
  postTo?: string; // Required if id is "all", specifies which account/platform's posts to delete
}

export interface DeleteResult {
  id: string;
  status: "deleted" | "not_found" | "error";
  message?: string;
}

export interface XPostDataInput {
  postTo: string;
  contents: string;
  mediaUrls?: string; // Changed from media
  postSchedule?: string; // 文字列形式を期待 (ISO 8601など)
  inReplytoInternal?: string;
  postId?: string;
  inReplyToOnX?: string;
  quoteId?: string; // Added
  repostTargetId?: string; // Added
  status?: string; // Added: initial status (typically 'queued')
  errorMessage?: string; // Added: for when importing data with existing errors
}

// Type for header map
export type HeaderMap = { [key: string]: number };
