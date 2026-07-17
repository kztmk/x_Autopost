import * as auth from "../auth";
import { XAuthInfo } from "../types";
import { getXAuthAll } from "./xauth";

const INTERACTIONS_SHEET = "XMarketingInteractions";
const RUNS_SHEET = "XMarketingRuns";
const POSTS_SHEET = "XMarketingPosts";
const DAILY_SHEET = "XMarketingPostDaily";
const RUN_HEADERS = ["timestamp", "month", "accountId", "resources", "estimatedCostUsd", "status", "message"];
const SETTINGS_KEY = "x_marketing_settings";
const REFRESH_LEASE_KEY = "x_marketing_refresh_lease";
const SAMPLE_PREFIX = "torai-sample:";
const SAMPLE_RUN_MARKER = "TORAI_X_MARKETING_SAMPLE_DATA";
const REFRESH_LEASE_TTL_MS = 15 * 60 * 1000;
const OWNED_POST_READ_USD = 0.001;
const USER_READ_USD = 0.01;
const MAX_STORED_INTERACTIONS = 2000;
const MAX_STORED_POSTS = 2000;
const MAX_STORED_DAILY_SNAPSHOTS = 20000;
const HEADERS = ["interactionId", "accountId", "userId", "username", "name", "reactionType", "postId", "postText", "occurredAt", "score", "stage", "status", "likeCount", "replyCount", "quoteCount", "repostCount", "tags", "memo", "updatedAt"];
const POST_HEADERS = ["analyticsId", "accountId", "postId", "postText", "createdAt", "capturedAt", "impressions", "engagements", "likes", "replies", "reposts", "quotes", "bookmarks", "profileClicks", "urlClicks", "metricSource", "impressionsAvailable", "profileClicksAvailable", "urlClicksAvailable"];
const DAILY_HEADERS = ["snapshotId", "snapshotDate", "accountId", "postId", "postText", "createdAt", "capturedAt", "impressions", "engagements", "likes", "replies", "reposts", "quotes", "bookmarks", "profileClicks", "urlClicks", "metricSource", "impressionsAvailable", "profileClicksAvailable", "urlClicksAvailable"];
type Query = Record<string, string>;
type MarketingSettings = { enabled: boolean; analyticsEnabled: boolean; trackingDays: number; maxPostsPerAccount: number; maxLikingUsersPerPost: number; monthlyLimitUsd: number };
type FetchedInteraction = { interactionId: string; accountId: string; userId: string; username: string; name: string; reactionType: "like" | "reply"; postId: string; postText: string; occurredAt: string };
type FetchedPostAnalytics = { analyticsId: string; accountId: string; postId: string; postText: string; createdAt: string; capturedAt: string; impressions: number; engagements: number; likes: number; replies: number; reposts: number; quotes: number; bookmarks: number; profileClicks: number; urlClicks: number; metricSource: "non_public" | "organic" | "public"; impressionsAvailable: boolean; profileClicksAvailable: boolean; urlClicksAvailable: boolean };
type AccountFetchResult = { accountId: string; interactions: FetchedInteraction[]; posts: FetchedPostAnalytics[]; resources: number; costUsd: number; partialErrors: string[] };
type RunEntry = { accountId: string; resources: number; costUsd: number; status: string; message?: string };
type XMarketingSampleData = { interactions: any[]; posts: any[]; daily: any[]; runs: RunEntry[] };
const defaults: MarketingSettings = { enabled: false, analyticsEnabled: false, trackingDays: 7, maxPostsPerAccount: 10, maxLikingUsersPerPost: 25, monthlyLimitUsd: 25 };

function getSettings(): MarketingSettings {
  const raw = PropertiesService.getScriptProperties().getProperty(SETTINGS_KEY);
  if (!raw) return defaults;
  try { return { ...defaults, ...JSON.parse(raw) }; } catch (_) { return defaults; }
}

export function upsertXMarketingSettings(input: Partial<MarketingSettings>) {
  const current = getSettings();
  const next: MarketingSettings = {
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    analyticsEnabled: typeof input.analyticsEnabled === "boolean" ? input.analyticsEnabled : current.analyticsEnabled,
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
  if (next.enabled || next.analyticsEnabled) {
    ScriptApp.newTrigger(handler).timeBased().everyDays(1).atHour(8).create();
  }
  return { status: "success", settings: next };
}

function getSheet(name: string, headers: string[]) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let target = ss.getSheetByName(name);
  if (!target) {
    try {
      target = ss.insertSheet(name);
    } catch (error) {
      target = ss.getSheetByName(name);
      if (!target) throw error;
    }
  }
  const maxColumns = target.getMaxColumns();
  if (maxColumns < headers.length) {
    target.insertColumnsAfter(maxColumns, headers.length - maxColumns);
  }
  const currentHeaders = target.getRange(1, 1, 1, headers.length).getValues()[0];
  if (headers.some((header, index) => String(currentHeaders[index] || "") !== header)) {
    target.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  target.setFrozenRows(1);
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

function readSheetRows(name: string, headers: string[], idHeader: string): any[] {
  const target = getSheet(name, headers);
  if (target.getLastRow() < 2) return [];
  return target.getRange(2, 1, target.getLastRow() - 1, headers.length).getValues()
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])))
    .filter((row) => String(row[idHeader] || "").trim());
}

function readRows() { return readSheetRows(INTERACTIONS_SHEET, HEADERS, "interactionId"); }
function readPostRows() { return readSheetRows(POSTS_SHEET, POST_HEADERS, "analyticsId"); }
function readDailyRows() { return readSheetRows(DAILY_SHEET, DAILY_HEADERS, "snapshotId"); }

function ensureRowCapacity(target: GoogleAppsScript.Spreadsheet.Sheet, requiredRows: number) {
  const maxRows = target.getMaxRows();
  if (requiredRows > maxRows) target.insertRowsAfter(maxRows, requiredRows - maxRows);
}

function replaceSheetRows(name: string, headers: string[], source: any[]) {
  const target = getSheet(name, headers);
  const rows = source.map((row) => headers.map((header) => row[header] ?? ""));
  const lastRow = target.getLastRow();
  if (rows.length) {
    ensureRowCapacity(target, rows.length + 1);
    target.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  if (lastRow > rows.length + 1) {
    target.getRange(rows.length + 2, 1, lastRow - (rows.length + 1), headers.length).clearContent();
  }
}

function replaceRows(source: any[]) { replaceSheetRows(INTERACTIONS_SHEET, HEADERS, source); }
function replacePostRows(source: any[]) { replaceSheetRows(POSTS_SHEET, POST_HEADERS, source); }
function replaceDailyRows(source: any[]) { replaceSheetRows(DAILY_SHEET, DAILY_HEADERS, source); }

function mergeSampleRows(existingRows: any[], sampleRows: any[], idHeader: string) {
  const merged = new Map(existingRows.map((row) => [String(row[idHeader]), row]));
  sampleRows.forEach((row) => merged.set(String(row[idHeader]), row));
  return Array.from(merged.values());
}

function removeSampleRuns() {
  const target = getSheet(RUNS_SHEET, RUN_HEADERS);
  const lastRow = target.getLastRow();
  if (lastRow < 2) return 0;
  const rows = target.getRange(2, 1, lastRow - 1, RUN_HEADERS.length).getValues();
  const remainingRows = rows.filter((row) => String(row[6] || "") !== SAMPLE_RUN_MARKER);
  replaceSheetRows(
    RUNS_SHEET,
    RUN_HEADERS,
    remainingRows.map((row) => Object.fromEntries(RUN_HEADERS.map((header, index) => [header, row[index]])))
  );
  return rows.length - remainingRows.length;
}

function sampleTimestamp(daysAgo: number, hour = 10) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function buildXMarketingSampleData(accountIds: string[]): XMarketingSampleData {
  const now = new Date().toISOString();
  const accountFor = (index: number) => accountIds[index % accountIds.length];
  const interactionSeeds = [
    { username: "yamada_taro_", name: "山田 太郎", reactionType: "reply", score: 92, stage: "conversation", status: "unread", text: "具体的な設定方法を教えていただけますか？", likes: 6, replies: 3, quotes: 0, reposts: 0, tags: "SNS運用,中小企業", memo: "導入時期を確認する" },
    { username: "misa_works", name: "佐藤 美咲", reactionType: "like", score: 64, stage: "interested", status: "unread", text: "X運用で最初に整えたい3つのポイントをまとめました。", likes: 4, replies: 0, quotes: 0, reposts: 0, tags: "マーケティング", memo: "" },
    { username: "suzuki_biz", name: "鈴木 健太", reactionType: "repost", score: 78, stage: "interested", status: "unread", text: "投稿作成を効率化するためのチェックリストです。", likes: 2, replies: 0, quotes: 0, reposts: 2, tags: "業務改善", memo: "資料送付を検討" },
    { username: "hanako_tanaka", name: "田中 花子", reactionType: "follow", score: 55, stage: "new", status: "read", text: "", likes: 0, replies: 0, quotes: 0, reposts: 0, tags: "", memo: "" },
    { username: "ito_sho_market", name: "伊藤 翔", reactionType: "reply", score: 85, stage: "conversation", status: "read", text: "チームで利用する場合のおすすめ設定を知りたいです。", likes: 3, replies: 2, quotes: 0, reposts: 0, tags: "SNS運用,リード獲得", memo: "次回の返信で料金プランを案内" },
    { username: "growth_co_ltd", name: "株式会社グロース", reactionType: "like", score: 42, stage: "new", status: "read", text: "反応を見逃さないための運用フローをご紹介します。", likes: 1, replies: 0, quotes: 0, reposts: 0, tags: "中小企業", memo: "" },
    { username: "d_nakamura", name: "中村 大輔", reactionType: "quote", score: 71, stage: "interested", status: "handled", text: "投稿分析の見方を7日間のデータで解説します。", likes: 2, replies: 0, quotes: 2, reposts: 0, tags: "マーケティング", memo: "対応済み" },
    { username: "aoi_design", name: "青井デザイン", reactionType: "like", score: 58, stage: "new", status: "unread", text: "画像付き投稿を作るときの確認ポイントです。", likes: 3, replies: 0, quotes: 0, reposts: 0, tags: "SNS運用", memo: "" },
    { username: "startup_kei", name: "高橋 慧", reactionType: "reply", score: 88, stage: "conversation", status: "unread", text: "無料相談はどこから申し込めますか？", likes: 5, replies: 3, quotes: 0, reposts: 0, tags: "リード獲得,高確度", memo: "優先して返信" },
    { username: "office_mori", name: "森オフィス", reactionType: "repost", score: 59, stage: "new", status: "read", text: "毎日のX運用を短時間で続けるコツをまとめました。", likes: 1, replies: 0, quotes: 0, reposts: 1, tags: "業務改善", memo: "" },
    { username: "kikuchi_pr", name: "菊池 広報", reactionType: "quote", score: 76, stage: "interested", status: "read", text: "担当者間で反応者を共有する方法をご紹介します。", likes: 2, replies: 1, quotes: 1, reposts: 0, tags: "SNS運用,要フォロー", memo: "来週フォロー" },
    { username: "local_cafe_sora", name: "カフェ空", reactionType: "follow", score: 48, stage: "completed", status: "handled", text: "", likes: 0, replies: 0, quotes: 0, reposts: 0, tags: "中小企業", memo: "導入済み" },
  ];
  const interactions = interactionSeeds.map((seed, index) => ({
    interactionId: `${SAMPLE_PREFIX}interaction:${index + 1}`,
    accountId: accountFor(index),
    userId: `${SAMPLE_PREFIX}user:${index + 1}`,
    username: seed.username,
    name: seed.name,
    reactionType: seed.reactionType,
    postId: seed.reactionType === "follow" ? "" : `190000000000000${String(index + 1).padStart(3, "0")}`,
    postText: seed.text,
    occurredAt: sampleTimestamp(Math.floor(index / 3), 9 + index % 8),
    score: seed.score,
    stage: seed.stage,
    status: seed.status,
    likeCount: seed.likes,
    replyCount: seed.replies,
    quoteCount: seed.quotes,
    repostCount: seed.reposts,
    tags: seed.tags,
    memo: seed.memo,
    updatedAt: now,
  }));

  const postSeeds = [
    { text: "X運用で最初に整えたい3つのポイントをまとめました。", impressions: 12840, engagements: 932, likes: 486, replies: 42, reposts: 61, quotes: 18, bookmarks: 34, profileClicks: 76, urlClicks: 48 },
    { text: "投稿作成を効率化するためのチェックリストです。", impressions: 8640, engagements: 511, likes: 302, replies: 28, reposts: 35, quotes: 9, bookmarks: 26, profileClicks: 63, urlClicks: 39 },
    { text: "虎威の取得設定について、よくある質問をご紹介します。", impressions: 6240, engagements: 384, likes: 221, replies: 31, reposts: 22, quotes: 7, bookmarks: 19, profileClicks: 51, urlClicks: 32 },
    { text: "反応を見逃さないための運用フローをご紹介します。", impressions: 4980, engagements: 318, likes: 184, replies: 24, reposts: 28, quotes: 6, bookmarks: 16, profileClicks: 44, urlClicks: 27 },
    { text: "毎日のX運用を短時間で続けるコツをまとめました。", impressions: 3860, engagements: 244, likes: 149, replies: 18, reposts: 19, quotes: 5, bookmarks: 13, profileClicks: 37, urlClicks: 22 },
    { text: "投稿分析の数字から次の企画を考える方法です。", impressions: 2940, engagements: 181, likes: 112, replies: 14, reposts: 13, quotes: 4, bookmarks: 10, profileClicks: 29, urlClicks: 18 },
  ];
  const posts = postSeeds.map((seed, index) => ({
    analyticsId: `${SAMPLE_PREFIX}post:${index + 1}`,
    accountId: accountFor(index),
    postId: `189000000000000${String(index + 1).padStart(3, "0")}`,
    postText: seed.text,
    createdAt: sampleTimestamp(index + 1, 8 + index),
    capturedAt: now,
    ...seed,
    metricSource: "non_public",
    impressionsAvailable: true,
    profileClicksAvailable: true,
    urlClicksAvailable: true,
  }));

  const daily = Array.from({ length: 7 }, (_, dayIndex) => {
    const capturedAt = sampleTimestamp(6 - dayIndex, 18);
    const factor = dayIndex + 1;
    return accountIds.map((accountId, accountIndex) => ({
      snapshotId: `${SAMPLE_PREFIX}daily:${accountIndex + 1}:${dayIndex + 1}`,
      snapshotDate: snapshotDate(capturedAt),
      accountId,
      postId: `188000000000000${accountIndex + 1}`,
      postText: accountIndex === 0 ? "Xマーケティングの日別推移サンプル" : "サポート投稿の日別推移サンプル",
      createdAt: sampleTimestamp(7, 9),
      capturedAt,
      impressions: (2400 + accountIndex * 800) + factor * (980 + accountIndex * 260),
      engagements: (120 + accountIndex * 35) + factor * (64 + accountIndex * 18),
      likes: (78 + accountIndex * 20) + factor * (38 + accountIndex * 10),
      replies: 8 + accountIndex * 3 + factor * 4,
      reposts: 11 + accountIndex * 4 + factor * 5,
      quotes: 3 + accountIndex + factor * 2,
      bookmarks: 7 + factor * 2,
      profileClicks: 18 + factor * 5,
      urlClicks: 12 + factor * 4,
      metricSource: "non_public",
      impressionsAvailable: true,
      profileClicksAvailable: true,
      urlClicksAvailable: true,
    }));
  }).flat();

  const runs = accountIds.map((accountId, index) => ({
    accountId,
    resources: accountIds.length === 1 ? 8450 : index === 0 ? 5250 : 3200,
    costUsd: accountIds.length === 1 ? 8.45 : index === 0 ? 5.25 : 3.2,
    status: "sample",
    message: SAMPLE_RUN_MARKER,
  }));
  return { interactions, posts, daily, runs };
}

export function importXMarketingSampleData() {
  const accountIds = getXAuthAll().map((account) => String(account.accountId || "")).filter(Boolean).slice(0, 2);
  if (!accountIds.length) throw new Error("X_MARKETING_SAMPLE_REQUIRES_X_ACCOUNT");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("X_MARKETING_SAMPLE_LOCK_TIMEOUT");
  try {
    const sample = buildXMarketingSampleData(accountIds);
    replaceRows(mergeSampleRows(readRows(), sample.interactions, "interactionId"));
    replacePostRows(mergeSampleRows(readPostRows(), sample.posts, "analyticsId"));
    replaceDailyRows(mergeSampleRows(readDailyRows(), sample.daily, "snapshotId"));
    removeSampleRuns();
    appendRuns(sample.runs);
    return {
      status: "success",
      accountIds,
      counts: { interactions: sample.interactions.length, posts: sample.posts.length, daily: sample.daily.length, runs: sample.runs.length },
    };
  } finally { lock.releaseLock(); }
}

export function deleteXMarketingSampleData() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("X_MARKETING_SAMPLE_LOCK_TIMEOUT");
  try {
    const interactions = readRows();
    const posts = readPostRows();
    const daily = readDailyRows();
    const remainingInteractions = interactions.filter((row) => !String(row.interactionId || "").startsWith(SAMPLE_PREFIX));
    const remainingPosts = posts.filter((row) => !String(row.analyticsId || "").startsWith(SAMPLE_PREFIX));
    const remainingDaily = daily.filter((row) => !String(row.snapshotId || "").startsWith(SAMPLE_PREFIX));
    replaceRows(remainingInteractions);
    replacePostRows(remainingPosts);
    replaceDailyRows(remainingDaily);
    const removedRuns = removeSampleRuns();
    return {
      status: "success",
      removed: {
        interactions: interactions.length - remainingInteractions.length,
        posts: posts.length - remainingPosts.length,
        daily: daily.length - remainingDaily.length,
        runs: removedRuns,
      },
    };
  } finally { lock.releaseLock(); }
}

function monthKey(date = new Date()) { return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM"); }
function parseSheetDate(value: any) {
  if (value === "" || value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function appendRuns(entries: RunEntry[]) {
  if (!entries.length) return;
  const target = getSheet(RUNS_SHEET, RUN_HEADERS);
  const timestamp = new Date();
  const month = monthKey(timestamp);
  const firstRow = target.getLastRow() + 1;
  ensureRowCapacity(target, firstRow + entries.length - 1);
  target.getRange(firstRow, 1, entries.length, RUN_HEADERS.length).setValues(
    entries.map((entry) => [timestamp, month, entry.accountId, entry.resources, entry.costUsd, entry.status, entry.message || ""])
  );
}
function monthlyUsage() {
  const target = getSheet(RUNS_SHEET, RUN_HEADERS);
  const byAccount: Record<string, number> = {}; let resources = 0;
  let costUsd = 0;
  let lastSyncedAt = "";
  const lastRow = target.getLastRow();
  if (lastRow < 2) return { resources, costUsd, byAccount, lastSyncedAt };
  const currentMonth = monthKey();
  const timestamps = target.getRange(2, 1, lastRow - 1, 1).getValues();
  let firstMatchingRow = 0;
  let lastMatchingRow = 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    const date = parseSheetDate(timestamps[index][0]);
    if (!date || monthKey(date) !== currentMonth) continue;
    const sheetRow = index + 2;
    if (!firstMatchingRow) firstMatchingRow = sheetRow;
    lastMatchingRow = sheetRow;
  }
  if (!firstMatchingRow) return { resources, costUsd, byAccount, lastSyncedAt };
  const rows = target.getRange(firstMatchingRow, 1, lastMatchingRow - firstMatchingRow + 1, 7).getValues();
  let lastSyncedTime = 0;
  for (const row of rows) {
    const date = parseSheetDate(row[0]);
    if (!date || monthKey(date) !== currentMonth) continue;
    const time = date.getTime();
    if (time > lastSyncedTime) {
      lastSyncedTime = time;
      lastSyncedAt = date.toISOString();
    }
    const count = Number(row[3]) || 0;
    const cost = Number(row[4]) || 0;
    const accountId = String(row[2]);
    resources += count;
    costUsd += cost;
    byAccount[accountId] = (byAccount[accountId] || 0) + cost;
  }
  return { resources, costUsd, byAccount, lastSyncedAt };
}

function firstMetric(fallback: number, ...values: any[]) {
  for (const value of values) {
    if (value === "" || value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.floor(number));
  }
  return fallback;
}

function hasMetric(...values: any[]) {
  return values.some((value) => value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value)));
}

function toPostAnalytics(accountId: string, post: any, capturedAt: string): FetchedPostAnalytics {
  const publicMetrics = post?.public_metrics || {};
  const nonPublicMetrics = post?.non_public_metrics || {};
  const organicMetrics = post?.organic_metrics || {};
  const hasNonPublicMetrics = post?.non_public_metrics && typeof post.non_public_metrics === "object";
  const hasOrganicMetrics = post?.organic_metrics && typeof post.organic_metrics === "object";
  const metricSource: FetchedPostAnalytics["metricSource"] = hasNonPublicMetrics
    ? "non_public"
    : hasOrganicMetrics
      ? "organic"
      : "public";
  const likes = firstMetric(0, publicMetrics.like_count, organicMetrics.like_count);
  const replies = firstMetric(0, publicMetrics.reply_count, organicMetrics.reply_count);
  const reposts = firstMetric(0, publicMetrics.retweet_count, organicMetrics.retweet_count);
  const quotes = firstMetric(0, publicMetrics.quote_count, organicMetrics.quote_count);
  const bookmarks = firstMetric(0, publicMetrics.bookmark_count, organicMetrics.bookmark_count);
  const fallbackEngagements = likes + replies + reposts + quotes + bookmarks;
  return {
    analyticsId: `${accountId}:${post.id}`,
    accountId,
    postId: String(post.id || ""),
    postText: String(post.text || "").substring(0, 500),
    createdAt: String(post.created_at || ""),
    capturedAt,
    impressions: firstMetric(0, nonPublicMetrics.impression_count, organicMetrics.impression_count, publicMetrics.impression_count),
    engagements: firstMetric(fallbackEngagements, nonPublicMetrics.engagements, organicMetrics.engagements),
    likes,
    replies,
    reposts,
    quotes,
    bookmarks,
    profileClicks: firstMetric(0, nonPublicMetrics.user_profile_clicks, organicMetrics.user_profile_clicks),
    urlClicks: firstMetric(0, nonPublicMetrics.url_link_clicks, nonPublicMetrics.url_clicks, organicMetrics.url_link_clicks, organicMetrics.url_clicks),
    metricSource,
    impressionsAvailable: hasMetric(nonPublicMetrics.impression_count, organicMetrics.impression_count, publicMetrics.impression_count),
    profileClicksAvailable: hasMetric(nonPublicMetrics.user_profile_clicks, organicMetrics.user_profile_clicks),
    urlClicksAvailable: hasMetric(nonPublicMetrics.url_link_clicks, nonPublicMetrics.url_clicks, organicMetrics.url_link_clicks, organicMetrics.url_clicks),
  };
}

function fetchAccount(accountId: string, settings: MarketingSettings): AccountFetchResult {
  const authInfo = auth.getXAuthById(accountId);
  const me = signedGet(authInfo, "https://api.x.com/2/users/me", { "user.fields": "name,username" });
  const userId = String(me?.data?.id || ""); if (!userId) throw new Error("X_MARKETING_AUTH_FAILED");
  const maxPostsPerAccount = Math.max(1, Math.min(100, normalizeCount(settings.maxPostsPerAccount, 1)));
  const timelineMaxResults = Math.max(5, maxPostsPerAccount);
  const partialErrors: string[] = [];
  const timelineEndpoint = `https://api.x.com/2/users/${userId}/tweets`;
  const timelineQuery = { max_results: String(timelineMaxResults), start_time: new Date(Date.now() - settings.trackingDays * 86400000).toISOString(), exclude: "retweets" };
  let tweets: any;
  if (settings.analyticsEnabled) {
    try {
      tweets = signedGet(authInfo, timelineEndpoint, { ...timelineQuery, "tweet.fields": "created_at,public_metrics,non_public_metrics,organic_metrics" });
    } catch (error) {
      const message = String(error);
      if (!message.includes("X_MARKETING_X_API_ERROR:400:") && !message.includes("X_MARKETING_X_API_ERROR:403:")) throw error;
      Logger.log(`Private X metrics are unavailable for ${accountId}; retrying with public metrics.`);
      tweets = signedGet(authInfo, timelineEndpoint, { ...timelineQuery, "tweet.fields": "created_at,public_metrics" });
    }
  } else {
    tweets = signedGet(authInfo, timelineEndpoint, { ...timelineQuery, "tweet.fields": "created_at" });
  }
  const interactions: FetchedInteraction[] = [];
  const tweetData = Array.isArray(tweets?.data) ? tweets.data : [];
  const capturedAt = new Date().toISOString();
  const posts = settings.analyticsEnabled
    ? tweetData
        .filter((post: any) => post?.id)
        .slice(0, maxPostsPerAccount)
        .map((post: any) => toPostAnalytics(accountId, post, capturedAt))
    : [];
  let postReads = tweetData.length;
  let userReads = 1;
  if (settings.enabled) {
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
  }
  const costUsd = postReads * OWNED_POST_READ_USD + userReads * USER_READ_USD;
  const resources = postReads + userReads;
  return { accountId, interactions, posts, resources, costUsd, partialErrors };
}

function normalizeCount(value: any, fallback: number) {
  if (value === "" || value === null || value === undefined) return fallback;
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : fallback;
}

function isTrueCellValue(value: any) {
  return value === true || (typeof value === "string" && value.trim().toUpperCase() === "TRUE");
}

function getInteractionTimestamp(row: any) {
  return getTimestamp(row?.occurredAt);
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

function getTimestamp(value: any) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (text === "") return 0;
  const numericTimestamp = Number(text);
  if (Number.isFinite(numericTimestamp)) return numericTimestamp;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function mergePostAnalytics(existingRows: any[], fetched: FetchedPostAnalytics[]) {
  const merged = new Map(existingRows.map((row) => [String(row.analyticsId), row]));
  fetched.forEach((post) => merged.set(post.analyticsId, { ...merged.get(post.analyticsId), ...post }));
  return Array.from(merged.values())
    .sort((a, b) => getTimestamp(a.createdAt) - getTimestamp(b.createdAt))
    .slice(-MAX_STORED_POSTS);
}

function snapshotDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return Utilities.formatDate(validDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function normalizeSnapshotDate(value: any) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  const date = parseSheetDate(value);
  return date ? snapshotDate(date) : "";
}

function mergeDailyAnalytics(existingRows: any[], fetched: FetchedPostAnalytics[]) {
  const merged = new Map(existingRows.map((row) => [String(row.snapshotId), row]));
  fetched.forEach((post) => {
    const date = snapshotDate(post.capturedAt);
    const snapshotId = `${date}:${post.analyticsId}`;
    merged.set(snapshotId, { ...merged.get(snapshotId), ...post, snapshotId, snapshotDate: date });
  });
  const retentionStart = Date.now() - 32 * 86400000;
  return Array.from(merged.values())
    .filter((row) => getTimestamp(row.capturedAt) >= retentionStart)
    .sort((a, b) => getTimestamp(a.capturedAt) - getTimestamp(b.capturedAt))
    .slice(-MAX_STORED_DAILY_SNAPSHOTS);
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
  const settings = getSettings(); if (!settings.enabled && !settings.analyticsEnabled) return { status: "disabled" };
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
      const fetchedPosts = results.flatMap((result) => result.posts);
      if (fetchedPosts.length) {
        replacePostRows(mergePostAnalytics(readPostRows(), fetchedPosts));
        replaceDailyRows(mergeDailyAnalytics(readDailyRows(), fetchedPosts));
      }
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

function publicPostAnalytics(row: any) {
  const impressions = normalizeCount(row.impressions, 0);
  const engagements = normalizeCount(row.engagements, 0);
  const impressionsAvailable = isTrueCellValue(row.impressionsAvailable);
  return {
    id: String(row.analyticsId || ""),
    accountId: String(row.accountId || ""),
    postId: String(row.postId || ""),
    text: String(row.postText || ""),
    createdAt: serializeDate(row.createdAt),
    capturedAt: serializeDate(row.capturedAt),
    metrics: {
      impressions,
      engagements,
      likes: normalizeCount(row.likes, 0),
      replies: normalizeCount(row.replies, 0),
      reposts: normalizeCount(row.reposts, 0),
      quotes: normalizeCount(row.quotes, 0),
      bookmarks: normalizeCount(row.bookmarks, 0),
      profileClicks: normalizeCount(row.profileClicks, 0),
      urlClicks: normalizeCount(row.urlClicks, 0),
    },
    engagementRate: impressionsAvailable && impressions > 0 ? engagements / impressions * 100 : null,
    metricSource: ["non_public", "organic"].includes(String(row.metricSource)) ? String(row.metricSource) : "public",
    availability: {
      impressions: impressionsAvailable,
      profileClicks: isTrueCellValue(row.profileClicksAvailable),
      urlClicks: isTrueCellValue(row.urlClicksAvailable),
    },
  };
}

function aggregateDailyAnalytics(rows: any[], accountId: string, trackingDays: number) {
  const startDate = snapshotDate(new Date(Date.now() - Math.max(0, trackingDays - 1) * 86400000));
  const grouped = new Map<string, any>();
  rows.forEach((row) => {
    const rowAccountId = String(row.accountId || "");
    const date = normalizeSnapshotDate(row.snapshotDate);
    if (!date || date < startDate || (accountId !== "all" && rowAccountId !== accountId)) return;
    const key = `${rowAccountId}:${date}`;
    const current = grouped.get(key) || { accountId: rowAccountId, date, postCount: 0, impressions: 0, engagements: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, impressionsAvailable: true };
    current.postCount += 1;
    current.impressions += normalizeCount(row.impressions, 0);
    current.engagements += normalizeCount(row.engagements, 0);
    current.likes += normalizeCount(row.likes, 0);
    current.replies += normalizeCount(row.replies, 0);
    current.reposts += normalizeCount(row.reposts, 0);
    current.quotes += normalizeCount(row.quotes, 0);
    current.impressionsAvailable = current.impressionsAvailable && isTrueCellValue(row.impressionsAvailable);
    grouped.set(key, current);
  });
  return Array.from(grouped.values())
    .map((row) => ({ ...row, engagementRate: row.impressionsAvailable && row.impressions > 0 ? row.engagements / row.impressions * 100 : null }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId));
}

export function getXMarketingDashboard(params: any = {}) {
  const accountId = String(params.accountId || "all");
  const usage = monthlyUsage();
  const settings = getSettings();
  const trackingStart = Date.now() - settings.trackingDays * 86400000;
  const posts = readPostRows()
    .filter((row) => (accountId === "all" || String(row.accountId) === accountId) && getTimestamp(row.createdAt) >= trackingStart)
    .slice(-1000)
    .map(publicPostAnalytics);
  const daily = aggregateDailyAnalytics(readDailyRows(), accountId, settings.trackingDays);
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
    analytics: { posts, daily },
    lastSyncedAt: usage.lastSyncedAt,
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
