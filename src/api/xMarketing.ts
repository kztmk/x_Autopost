import * as auth from "../auth";
import { XAuthInfo } from "../types";
import { getXAuthAll } from "./xauth";

const INTERACTIONS_SHEET = "XMarketingInteractions";
const RUNS_SHEET = "XMarketingRuns";
const SETTINGS_KEY = "x_marketing_settings";
const REFRESH_LEASE_KEY = "x_marketing_refresh_lease";
const REFRESH_LEASE_TTL_MS = 15 * 60 * 1000;
const OWNED_POST_READ_USD = 0.001;
const USER_READ_USD = 0.01;
const MAX_STORED_INTERACTIONS = 2000;
const HEADERS = ["interactionId", "accountId", "userId", "username", "name", "reactionType", "postId", "postText", "occurredAt", "score", "stage", "status", "likeCount", "replyCount", "quoteCount", "repostCount", "tags", "memo", "updatedAt"];
type Query = Record<string, string>;
type MarketingSettings = { enabled: boolean; trackingDays: number; maxPostsPerAccount: number; maxLikingUsersPerPost: number; monthlyLimitUsd: number };
type FetchedInteraction = { interactionId: string; accountId: string; userId: string; username: string; name: string; reactionType: "like" | "reply"; postId: string; postText: string; occurredAt: string };
type AccountFetchResult = { accountId: string; interactions: FetchedInteraction[]; resources: number; costUsd: number; partialErrors: string[] };
type RunEntry = { accountId: string; resources: number; costUsd: number; status: string; message?: string };
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
  return target.getRange(2, 1, target.getLastRow() - 1, HEADERS.length).getValues()
    .map((row) => Object.fromEntries(HEADERS.map((h, i) => [h, row[i]])))
    .filter((row) => String(row.interactionId || "").trim());
}

function ensureRowCapacity(target: GoogleAppsScript.Spreadsheet.Sheet, requiredRows: number) {
  const maxRows = target.getMaxRows();
  if (requiredRows > maxRows) target.insertRowsAfter(maxRows, requiredRows - maxRows);
}

function replaceRows(source: any[]) {
  const target = getSheet(INTERACTIONS_SHEET, HEADERS);
  const rows = source.map((row) => HEADERS.map((h) => row[h] ?? ""));
  const lastRow = target.getLastRow();
  if (rows.length) {
    ensureRowCapacity(target, rows.length + 1);
    target.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
  if (lastRow > rows.length + 1) {
    target.getRange(rows.length + 2, 1, lastRow - (rows.length + 1), HEADERS.length).clearContent();
  }
}

function monthKey(date = new Date()) { return Utilities.formatDate(date, "UTC", "yyyy-MM"); }
function appendRuns(entries: RunEntry[]) {
  if (!entries.length) return;
  const headers = ["timestamp", "month", "accountId", "resources", "estimatedCostUsd", "status", "message"];
  const target = getSheet(RUNS_SHEET, headers);
  const timestamp = new Date();
  const month = monthKey(timestamp);
  const firstRow = target.getLastRow() + 1;
  ensureRowCapacity(target, firstRow + entries.length - 1);
  target.getRange(firstRow, 1, entries.length, headers.length).setValues(
    entries.map((entry) => [timestamp, month, entry.accountId, entry.resources, entry.costUsd, entry.status, entry.message || ""])
  );
}
function monthlyUsage() {
  const target = getSheet(RUNS_SHEET, ["timestamp", "month", "accountId", "resources", "estimatedCostUsd", "status", "message"]);
  const byAccount: Record<string, number> = {}; let resources = 0;
  let costUsd = 0;
  const lastRow = target.getLastRow();
  if (lastRow < 2) return { resources, costUsd, byAccount };
  const currentMonth = monthKey();
  const timestamps = target.getRange(2, 1, lastRow - 1, 1).getValues();
  let firstMatchingRow = 0;
  let lastMatchingRow = 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index][0];
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) continue;
    if (monthKey(timestamp) !== currentMonth) continue;
    const sheetRow = index + 2;
    if (!firstMatchingRow) firstMatchingRow = sheetRow;
    lastMatchingRow = sheetRow;
  }
  if (!firstMatchingRow) return { resources, costUsd, byAccount };
  const rows = target.getRange(firstMatchingRow, 1, lastMatchingRow - firstMatchingRow + 1, 7).getValues();
  for (const row of rows) {
    const timestamp = row[0];
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) continue;
    if (monthKey(timestamp) !== currentMonth) continue;
    const count = Number(row[3]) || 0;
    const cost = Number(row[4]) || 0;
    const accountId = String(row[2]);
    resources += count;
    costUsd += cost;
    byAccount[accountId] = (byAccount[accountId] || 0) + cost;
  }
  return { resources, costUsd, byAccount };
}

function fetchAccount(accountId: string, settings: MarketingSettings): AccountFetchResult {
  const authInfo = auth.getXAuthById(accountId);
  const me = signedGet(authInfo, "https://api.x.com/2/users/me", { "user.fields": "name,username" });
  const userId = String(me?.data?.id || ""); if (!userId) throw new Error("X_MARKETING_AUTH_FAILED");
  const maxPostsPerAccount = Math.max(1, Math.min(100, normalizeCount(settings.maxPostsPerAccount, 1)));
  const timelineMaxResults = Math.max(5, maxPostsPerAccount);
  const tweets = signedGet(authInfo, `https://api.x.com/2/users/${userId}/tweets`, { max_results: String(timelineMaxResults), start_time: new Date(Date.now() - settings.trackingDays * 86400000).toISOString(), exclude: "retweets", "tweet.fields": "created_at,public_metrics" });
  const interactions: FetchedInteraction[] = [];
  const partialErrors: string[] = [];
  const tweetData = Array.isArray(tweets?.data) ? tweets.data : [];
  let postReads = tweetData.length;
  let userReads = 1;
  const likingUsersLimit = Math.max(1, Math.min(100, normalizeCount(settings.maxLikingUsersPerPost, 1)));
  for (const post of tweetData.filter((post: any) => post?.id).slice(0, maxPostsPerAccount)) {
    try {
      const likes = signedGet(authInfo, `https://api.x.com/2/tweets/${post.id}/liking_users`, { max_results: String(likingUsersLimit), "user.fields": "name,username" });
      const likeData = Array.isArray(likes?.data) ? likes.data : [];
      userReads += likeData.length;
      for (const user of likeData.filter((user: any) => user?.id).slice(0, likingUsersLimit)) {
        interactions.push({ interactionId: `${accountId}:${post.id}:${user.id}:like`, accountId, userId: String(user.id || ""), username: String(user.username || ""), name: String(user.name || ""), reactionType: "like", postId: String(post.id || ""), postText: String(post.text || "").substring(0, 180), occurredAt: String(post.created_at || "") });
      }
    } catch (error) {
      const message = `Failed to fetch liking users for post ${post.id}: ${String(error)}`.substring(0, 240);
      partialErrors.push(message);
      Logger.log(message);
    }
  }
  try {
    const mentions = signedGet(authInfo, `https://api.x.com/2/users/${userId}/mentions`, { max_results: String(timelineMaxResults), start_time: new Date(Date.now() - settings.trackingDays * 86400000).toISOString(), expansions: "author_id", "tweet.fields": "author_id,created_at", "user.fields": "name,username" });
    const mentionData = Array.isArray(mentions?.data) ? mentions.data : [];
    const includedUsers = Array.isArray(mentions?.includes?.users) ? mentions.includes.users : [];
    const mentionUsers = new Map<string, any>(includedUsers
      .filter((user: any) => user?.id)
      .map((user: any) => [String(user.id), user]));
    postReads += mentionData.length;
    userReads += mentionUsers.size;
    for (const mention of mentionData) {
      if (!mention?.id || !mention?.author_id) continue;
      const user: any = mentionUsers.get(String(mention.author_id));
      if (!user) continue;
      interactions.push({ interactionId: `${accountId}:${mention.id}:${user.id}:reply`, accountId, userId: String(user.id || ""), username: String(user.username || ""), name: String(user.name || ""), reactionType: "reply", postId: String(mention.id || ""), postText: String(mention.text || "").substring(0, 180), occurredAt: String(mention.created_at || "") });
    }
  } catch (error) {
    const message = `Failed to fetch mentions for account ${accountId}: ${String(error)}`.substring(0, 240);
    partialErrors.push(message);
    Logger.log(message);
  }
  const costUsd = postReads * OWNED_POST_READ_USD + userReads * USER_READ_USD;
  const resources = postReads + userReads;
  return { accountId, interactions, resources, costUsd, partialErrors };
}

function normalizeCount(value: any, fallback: number) {
  if (value === "" || value === null || value === undefined) return fallback;
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : fallback;
}

function getInteractionTimestamp(row: any) {
  const occurredAt = row?.occurredAt;
  if (occurredAt instanceof Date) {
    const timestamp = occurredAt.getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
  const timestamp = Date.parse(String(occurredAt || ""));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function mergeFetchedInteractions(existingRows: any[], fetched: FetchedInteraction[]) {
  const merged = new Map(existingRows.map((row) => [String(row.interactionId), row]));
  for (const interaction of fetched) {
    const previous = merged.get(interaction.interactionId);
    const isLike = interaction.reactionType === "like";
    const likeCount = normalizeCount(previous?.likeCount, isLike ? 1 : 0);
    const replyCount = normalizeCount(previous?.replyCount, isLike ? 0 : 1);
    merged.set(interaction.interactionId, {
      ...previous,
      ...interaction,
      score: isLike
        ? Math.min(100, 42 + likeCount * 2)
        : Math.min(100, 72 + replyCount * 5),
      stage: previous?.stage || "new",
      status: previous?.status || "unread",
      likeCount,
      replyCount,
      quoteCount: normalizeCount(previous?.quoteCount, 0),
      repostCount: normalizeCount(previous?.repostCount, 0),
      tags: previous?.tags || "",
      memo: previous?.memo || "",
      updatedAt: new Date().toISOString(),
    });
  }
  return Array.from(merged.values())
    .sort((a, b) => getInteractionTimestamp(a) - getInteractionTimestamp(b))
    .slice(-MAX_STORED_INTERACTIONS);
}

function startRefreshLease() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return "";
  try {
    const properties = PropertiesService.getScriptProperties();
    const raw = properties.getProperty(REFRESH_LEASE_KEY);
    if (raw) {
      try {
        const lease = JSON.parse(raw);
        if (Date.now() - Number(lease.startedAt) < REFRESH_LEASE_TTL_MS) return "";
      } catch (_) { /* Replace an invalid lease below. */ }
    }
    const id = Utilities.getUuid();
    properties.setProperty(REFRESH_LEASE_KEY, JSON.stringify({ id, startedAt: Date.now() }));
    return id;
  } finally { lock.releaseLock(); }
}

function clearRefreshLease(id: string) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const raw = properties.getProperty(REFRESH_LEASE_KEY);
    if (!raw) return;
    try {
      if (JSON.parse(raw).id === id) properties.deleteProperty(REFRESH_LEASE_KEY);
    } catch (_) { properties.deleteProperty(REFRESH_LEASE_KEY); }
  } finally { lock.releaseLock(); }
}

export function refreshXMarketingDaily() {
  const settings = getSettings(); if (!settings.enabled) return { status: "disabled" };
  const leaseId = startRefreshLease(); if (!leaseId) return { status: "already_running" };
  try {
    let currentCostUsd = monthlyUsage().costUsd;
    if (currentCostUsd >= settings.monthlyLimitUsd) return { status: "budget_stopped" };
    let resources = 0; const errors: any[] = []; const results: AccountFetchResult[] = []; const runs: RunEntry[] = [];
    for (const account of getXAuthAll()) {
      if (currentCostUsd >= settings.monthlyLimitUsd) {
        const message = "Monthly budget limit reached during execution";
        errors.push({ accountId: account.accountId, message });
        runs.push({ accountId: account.accountId, resources: 0, costUsd: 0, status: "budget_stopped", message });
        break;
      }
      try {
        const result = fetchAccount(account.accountId, settings);
        results.push(result); resources += result.resources; currentCostUsd += result.costUsd;
        runs.push({ accountId: account.accountId, resources: result.resources, costUsd: result.costUsd, status: result.partialErrors.length ? "warning" : "success", message: result.partialErrors.join(" | ").substring(0, 500) });
      } catch (error: any) {
        const message = String(error.message || error).substring(0, 240);
        errors.push({ accountId: account.accountId, message });
        runs.push({ accountId: account.accountId, resources: 0, costUsd: 0, status: "error", message });
      }
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error("X_MARKETING_WRITE_LOCK_TIMEOUT");
    try {
      const fetched = results.flatMap((result) => result.interactions);
      if (fetched.length) replaceRows(mergeFetchedInteractions(readRows(), fetched));
      appendRuns(runs);
    } finally { lock.releaseLock(); }

    const hasPartialErrors = results.some((result) => result.partialErrors.length > 0);
    return { status: errors.length || hasPartialErrors ? "warning" : "success", resources, errors };
  } finally { clearRefreshLease(leaseId); }
}

function serializeDate(value: any) {
  if (!(value instanceof Date)) return String(value || "");
  return Number.isNaN(value.getTime()) ? "" : value.toISOString();
}

function publicInteraction(row: any) { return { id: String(row.interactionId || ""), accountId: String(row.accountId || ""), userId: String(row.userId || ""), username: String(row.username || ""), name: String(row.name || ""), reactionType: String(row.reactionType || ""), postId: String(row.postId || ""), postText: String(row.postText || ""), occurredAt: serializeDate(row.occurredAt), score: Number(row.score) || 0, stage: String(row.stage || "new"), status: String(row.status || "unread"), counts: { likes: Number(row.likeCount) || 0, replies: Number(row.replyCount) || 0, quotes: Number(row.quoteCount) || 0, reposts: Number(row.repostCount) || 0 }, tags: String(row.tags || "").split(",").map((v) => v.trim()).filter(Boolean), memo: String(row.memo || "") }; }

export function getXMarketingDashboard(params: any = {}) {
  const accountId = String(params.accountId || "all");
  const usage = monthlyUsage();
  const settings = getSettings();
  return {
    settings,
    accounts: getXAuthAll().map((account) => ({
      accountId: account.accountId,
      estimatedCostUsd: usage.byAccount[account.accountId] || 0,
    })),
    globalCost: {
      estimatedUsd: usage.costUsd,
      limitUsd: settings.monthlyLimitUsd,
      resources: usage.resources,
    },
    interactions: readRows()
      .filter((row) => accountId === "all" || String(row.accountId) === accountId)
      .slice(-1000)
      .map(publicInteraction),
    lastSyncedAt: new Date().toISOString(),
  };
}

export function updateXMarketingProspect(input: any) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("X_MARKETING_UPDATE_LOCK_TIMEOUT");
  try {
    if (!input?.interactionId) throw new Error("Missing interactionId");
    const targetSheet = getSheet(INTERACTIONS_SHEET, HEADERS);
    const rowCount = targetSheet.getLastRow() - 1;
    if (rowCount < 1) throw new Error("X_MARKETING_INTERACTION_NOT_FOUND");
    const interactionIdColumn = HEADERS.indexOf("interactionId") + 1;
    const matchingCell = targetSheet.getRange(2, interactionIdColumn, rowCount, 1)
      .createTextFinder(String(input.interactionId))
      .matchEntireCell(true)
      .useRegularExpression(false)
      .findNext();
    if (!matchingCell) throw new Error("X_MARKETING_INTERACTION_NOT_FOUND");
    const sheetRow = matchingCell.getRow();
    const rowValues = targetSheet.getRange(sheetRow, 1, 1, HEADERS.length).getValues()[0];
    const target = Object.fromEntries(HEADERS.map((header, index) => [header, rowValues[index]]));
    if (["new", "interested", "conversation", "completed"].includes(input.stage)) target.stage = input.stage;
    if (["unread", "read", "handled"].includes(input.status)) target.status = input.status;
    if (Array.isArray(input.tags)) target.tags = input.tags.slice(0, 10).join(",");
    if (typeof input.memo === "string") target.memo = input.memo.substring(0, 500);
    target.updatedAt = new Date().toISOString();
    targetSheet.getRange(sheetRow, 1, 1, HEADERS.length).setValues([
      HEADERS.map((header) => target[header] ?? ""),
    ]);
    return { status: "success", interaction: publicInteraction(target) };
  } finally { lock.releaseLock(); }
}
