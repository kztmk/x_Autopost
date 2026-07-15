import * as auth from "../auth";
import { XAuthInfo } from "../types";
import { getXAuthAll } from "./xauth";

const INTERACTIONS_SHEET = "XMarketingInteractions";
const RUNS_SHEET = "XMarketingRuns";
const SETTINGS_KEY = "x_marketing_settings";
const OWNED_POST_READ_USD = 0.001;
const USER_READ_USD = 0.01;
const HEADERS = ["interactionId", "accountId", "userId", "username", "name", "reactionType", "postId", "postText", "occurredAt", "score", "stage", "status", "likeCount", "replyCount", "quoteCount", "repostCount", "tags", "memo", "updatedAt"];
type Query = Record<string, string>;
type MarketingSettings = { enabled: boolean; trackingDays: number; maxPostsPerAccount: number; maxLikingUsersPerPost: number; monthlyLimitUsd: number };
const defaults: MarketingSettings = { enabled: false, trackingDays: 7, maxPostsPerAccount: 10, maxLikingUsersPerPost: 25, monthlyLimitUsd: 25 };

function getSettings(): MarketingSettings {
  const raw = PropertiesService.getScriptProperties().getProperty(SETTINGS_KEY);
  if (!raw) return defaults;
  try { return { ...defaults, ...JSON.parse(raw) }; } catch (_) { return defaults; }
}

export function upsertXMarketingSettings(input: Partial<MarketingSettings>) {
  const current = getSettings();
  const next: MarketingSettings = {
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    trackingDays: [1, 7, 14, 30].includes(Number(input.trackingDays)) ? Number(input.trackingDays) : current.trackingDays,
    maxPostsPerAccount: Math.min(100, Math.max(1, Number(input.maxPostsPerAccount) || current.maxPostsPerAccount)),
    maxLikingUsersPerPost: Math.min(100, Math.max(1, Number(input.maxLikingUsersPerPost) || current.maxLikingUsersPerPost)),
    monthlyLimitUsd: Math.min(1000, Math.max(1, Number(input.monthlyLimitUsd) || current.monthlyLimitUsd)),
  };
  PropertiesService.getScriptProperties().setProperty(SETTINGS_KEY, JSON.stringify(next));
  const handler = "refreshXMarketingDaily";
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === handler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  if (next.enabled) {
    ScriptApp.newTrigger(handler).timeBased().everyDays(1).atHour(8).create();
  }
  return { status: "success", settings: next };
}

function getSheet(name: string, headers: string[]) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let target = ss.getSheetByName(name);
  if (!target) { target = ss.insertSheet(name); target.getRange(1, 1, 1, headers.length).setValues([headers]); target.setFrozenRows(1); }
  return target;
}

function signedGet(authInfo: XAuthInfo, endpoint: string, query: Query = {}): any {
  const oauth = auth.generateOAuthParams(authInfo.apiKey, authInfo.accessToken);
  const base = auth.generateSignatureBaseString("GET", endpoint, { ...oauth, ...query });
  const key = auth.generateSigningKey(authInfo.apiKeySecret, authInfo.accessTokenSecret);
  const signature = auth.generateSignature(base, key);
  const header = auth.generateOAuthHeader({ ...oauth, oauth_signature: signature });
  const qs = Object.keys(query).map((k) => `${auth.rfc3986Encode(k)}=${auth.rfc3986Encode(query[k])}`).join("&");
  const response = UrlFetchApp.fetch(qs ? `${endpoint}?${qs}` : endpoint, { method: "get", headers: { Authorization: header }, muteHttpExceptions: true });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error(`X_MARKETING_X_API_ERROR:${code}:${body.substring(0, 300)}`);
  return JSON.parse(body || "{}");
}

function readRows(): any[] {
  const target = getSheet(INTERACTIONS_SHEET, HEADERS);
  if (target.getLastRow() < 2) return [];
  return target.getRange(2, 1, target.getLastRow() - 1, HEADERS.length).getValues().map((row) => Object.fromEntries(HEADERS.map((h, i) => [h, row[i]])));
}

function upsertRows(incoming: any[], replaceAll = false, existingRows?: any[]) {
  const target = getSheet(INTERACTIONS_SHEET, HEADERS);
  let source = incoming;
  if (!replaceAll) {
    const merged = new Map((existingRows || readRows()).map((row) => [String(row.interactionId), row]));
    incoming.forEach((row) => merged.set(String(row.interactionId), { ...merged.get(String(row.interactionId)), ...row }));
    source = Array.from(merged.values());
  }
  const rows = source.map((row) => HEADERS.map((h) => row[h] ?? ""));
  if (target.getLastRow() > 1) target.getRange(2, 1, target.getLastRow() - 1, HEADERS.length).clearContent();
  if (rows.length) target.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}

function monthKey(date = new Date()) { return Utilities.formatDate(date, "UTC", "yyyy-MM"); }
function appendRun(accountId: string, resources: number, estimatedCostUsd: number, status: string, message = "") {
  const headers = ["timestamp", "month", "accountId", "resources", "estimatedCostUsd", "status", "message"];
  getSheet(RUNS_SHEET, headers).appendRow([new Date(), monthKey(), accountId, resources, estimatedCostUsd, status, message]);
}
function monthlyUsage() {
  const target = getSheet(RUNS_SHEET, ["timestamp", "month", "accountId", "resources", "estimatedCostUsd", "status", "message"]);
  const byAccount: Record<string, number> = {}; let resources = 0;
  let costUsd = 0;
  if (target.getLastRow() >= 2) target.getRange(2, 1, target.getLastRow() - 1, 7).getValues().filter((r) => String(r[1]) === monthKey()).forEach((r) => { const count = Number(r[3]) || 0; const cost = Number(r[4]) || 0; resources += count; costUsd += cost; byAccount[String(r[2])] = (byAccount[String(r[2])] || 0) + cost; });
  return { resources, costUsd, byAccount };
}

function refreshAccount(accountId: string, settings: MarketingSettings): { resources: number; costUsd: number } {
  const authInfo = auth.getXAuthById(accountId);
  const me = signedGet(authInfo, "https://api.x.com/2/users/me", { "user.fields": "name,username" });
  const userId = String(me?.data?.id || ""); if (!userId) throw new Error("X_MARKETING_AUTH_FAILED");
  const tweets = signedGet(authInfo, `https://api.x.com/2/users/${userId}/tweets`, { max_results: String(Math.max(5, settings.maxPostsPerAccount)), start_time: new Date(Date.now() - settings.trackingDays * 86400000).toISOString(), exclude: "retweets", "tweet.fields": "created_at,public_metrics" });
  const current = readRows(); const currentMap = new Map(current.map((row) => [String(row.interactionId), row])); const incoming: any[] = [];
  const partialErrors: string[] = [];
  let postReads = Array.isArray(tweets.data) ? tweets.data.length : 0;
  let userReads = 1;
  for (const post of (tweets.data || []).slice(0, settings.maxPostsPerAccount)) {
    try {
      const likes = signedGet(authInfo, `https://api.x.com/2/tweets/${post.id}/liking_users`, { max_results: String(settings.maxLikingUsersPerPost), "user.fields": "name,username" });
      userReads += Array.isArray(likes.data) ? likes.data.length : 0;
      for (const user of likes.data || []) {
        const id = `${accountId}:${post.id}:${user.id}:like`; const previous = currentMap.get(id);
        incoming.push({ interactionId: id, accountId, userId: user.id, username: user.username, name: user.name, reactionType: "like", postId: post.id, postText: String(post.text || "").substring(0, 180), occurredAt: post.created_at, score: Math.min(100, 42 + Number(previous?.likeCount || 0) * 2), stage: previous?.stage || "new", status: previous?.status || "unread", likeCount: previous?.likeCount || 1, replyCount: previous?.replyCount || 0, quoteCount: previous?.quoteCount || 0, repostCount: previous?.repostCount || 0, tags: previous?.tags || "", memo: previous?.memo || "", updatedAt: new Date().toISOString() });
      }
    } catch (error) {
      const message = `Failed to fetch liking users for post ${post.id}: ${String(error)}`.substring(0, 240);
      partialErrors.push(message);
      Logger.log(message);
    }
  }
  try {
    const mentions = signedGet(authInfo, `https://api.x.com/2/users/${userId}/mentions`, { max_results: String(Math.max(5, settings.maxPostsPerAccount)), start_time: new Date(Date.now() - settings.trackingDays * 86400000).toISOString(), expansions: "author_id", "tweet.fields": "author_id,created_at", "user.fields": "name,username" });
    const mentionUsers = new Map<string, any>((mentions.includes?.users || []).map((user: any) => [String(user.id), user]));
    postReads += Array.isArray(mentions.data) ? mentions.data.length : 0;
    userReads += mentionUsers.size;
    for (const mention of mentions.data || []) {
      const user: any = mentionUsers.get(String(mention.author_id));
      if (!user) continue;
      const id = `${accountId}:${mention.id}:${user.id}:reply`; const previous = currentMap.get(id);
      incoming.push({ interactionId: id, accountId, userId: user.id, username: user.username, name: user.name, reactionType: "reply", postId: mention.id, postText: String(mention.text || "").substring(0, 180), occurredAt: mention.created_at, score: Math.min(100, 72 + Number(previous?.replyCount || 0) * 5), stage: previous?.stage || "new", status: previous?.status || "unread", likeCount: previous?.likeCount || 0, replyCount: previous?.replyCount || 1, quoteCount: previous?.quoteCount || 0, repostCount: previous?.repostCount || 0, tags: previous?.tags || "", memo: previous?.memo || "", updatedAt: new Date().toISOString() });
    }
  } catch (error) {
    const message = `Failed to fetch mentions for account ${accountId}: ${String(error)}`.substring(0, 240);
    partialErrors.push(message);
    Logger.log(message);
  }
  const costUsd = postReads * OWNED_POST_READ_USD + userReads * USER_READ_USD;
  const resources = postReads + userReads;
  upsertRows(incoming, false, current); appendRun(accountId, resources, costUsd, partialErrors.length ? "warning" : "success", partialErrors.join(" | ").substring(0, 500)); return { resources, costUsd };
}

export function refreshXMarketingDaily() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { status: "already_running" };
  try {
    const settings = getSettings(); if (!settings.enabled) return { status: "disabled" };
    let currentCostUsd = monthlyUsage().costUsd;
    if (currentCostUsd >= settings.monthlyLimitUsd) return { status: "budget_stopped" };
    let resources = 0; const errors: any[] = [];
    for (const account of getXAuthAll()) {
      if (currentCostUsd >= settings.monthlyLimitUsd) {
        const message = "Monthly budget limit reached during execution";
        errors.push({ accountId: account.accountId, message });
        appendRun(account.accountId, 0, 0, "budget_stopped", message);
        break;
      }
      try { const result = refreshAccount(account.accountId, settings); resources += result.resources; currentCostUsd += result.costUsd; } catch (error: any) { const message = String(error.message || error).substring(0, 240); errors.push({ accountId: account.accountId, message }); appendRun(account.accountId, 0, 0, "error", message); }
    }
    return { status: errors.length ? "warning" : "success", resources, errors };
  } finally { lock.releaseLock(); }
}

function publicInteraction(row: any) { return { id: String(row.interactionId || ""), accountId: String(row.accountId || ""), userId: String(row.userId || ""), username: String(row.username || ""), name: String(row.name || ""), reactionType: String(row.reactionType || ""), postId: String(row.postId || ""), postText: String(row.postText || ""), occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt || ""), score: Number(row.score) || 0, stage: String(row.stage || "new"), status: String(row.status || "unread"), counts: { likes: Number(row.likeCount) || 0, replies: Number(row.replyCount) || 0, quotes: Number(row.quoteCount) || 0, reposts: Number(row.repostCount) || 0 }, tags: String(row.tags || "").split(",").map((v) => v.trim()).filter(Boolean), memo: String(row.memo || "") }; }

export function getXMarketingDashboard(params: any = {}) {
  const accountId = String(params.accountId || "all"); const usage = monthlyUsage(); const settings = getSettings();
  return { settings, accounts: getXAuthAll().map((a) => ({ accountId: a.accountId, estimatedCostUsd: usage.byAccount[a.accountId] || 0 })), globalCost: { estimatedUsd: usage.costUsd, limitUsd: settings.monthlyLimitUsd, resources: usage.resources }, interactions: readRows().filter((r) => accountId === "all" || String(r.accountId) === accountId).map(publicInteraction), lastSyncedAt: new Date().toISOString() };
}

export function updateXMarketingProspect(input: any) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("X_MARKETING_UPDATE_LOCK_TIMEOUT");
  try {
    if (!input?.interactionId) throw new Error("Missing interactionId"); const rows = readRows(); const target = rows.find((r) => String(r.interactionId) === String(input.interactionId)); if (!target) throw new Error("X_MARKETING_INTERACTION_NOT_FOUND");
    if (["new", "interested", "conversation", "completed"].includes(input.stage)) target.stage = input.stage;
    if (["unread", "read", "handled"].includes(input.status)) target.status = input.status;
    if (Array.isArray(input.tags)) target.tags = input.tags.slice(0, 10).join(","); if (typeof input.memo === "string") target.memo = input.memo.substring(0, 500); target.updatedAt = new Date().toISOString(); upsertRows(rows, true);
    return { status: "success", interaction: publicInteraction(target) };
  } finally { lock.releaseLock(); }
}
