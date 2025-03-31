 export interface XAuthInfo {
   accountId: string;
   apiKey: string;
   apiKeySecret: string;
   accessToken: string;
   accessTokenSecret: string;
 }

export interface XPostData {
   id?: string;
   createdAt?: string;
   postSchedule?: string;
   postTo?: string;
   contents?: string;
   media?: string;
   inReplyToInternal?: string;
  }

export interface TriggerProps {
  intervalMinuts: number;
}

export interface PostError {
  timestamp: string;
  context: string;
  message: string;
  stack: string;
}

