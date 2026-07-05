type PostNotificationStatus = "success" | "error" | "critical";
type DiscordNotificationEventType = "post" | "test";
type DiscordNotificationLogStatus = "success" | "failure";

type PostNotificationPayload = {
  status: PostNotificationStatus;
  accountId?: string;
  internalId?: string;
  postId?: string;
  content?: string;
  scheduledAt?: string;
  errorMessage?: string;
};

export const DISCORD_NOTIFICATION_ENABLED_KEY = "discord_notification_enabled";
export const DISCORD_WEBHOOK_URL_KEY = "discord_webhook_url";
export const DISCORD_WEBHOOK_URL_PATTERN =
  /^https:\/\/((?:ptb|canary)\.)?(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+(\?[\w=&-]+)?$/;
const DISCORD_MESSAGE_LIMIT = 1900;
const DISCORD_LOG_SHEET_NAME = "discord_log";
const DISCORD_LOG_MAX_ROWS = 500;
const DISCORD_LOG_HEADERS = [
  "timestamp",
  "eventType",
  "status",
  "notificationStatus",
  "accountId",
  "internalId",
  "postId",
  "scheduledAt",
  "responseCode",
  "errorMessage",
];

type DiscordNotificationLogEntry = {
  eventType: DiscordNotificationEventType;
  status?: PostNotificationStatus;
  notificationStatus: DiscordNotificationLogStatus;
  accountId?: string;
  internalId?: string;
  postId?: string;
  scheduledAt?: string;
  responseCode?: number;
  errorMessage?: string;
};

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.substring(0, maxLength - 3)}...`;
}

function formatOptionalLine(label: string, value?: string): string {
  const normalizedValue = value ? String(value).trim() : "";
  return normalizedValue ? `${label}: ${normalizedValue}` : "";
}

function getScriptTimeZone(): string {
  try {
    return Session.getScriptTimeZone() || "Asia/Tokyo";
  } catch (error) {
    return "Asia/Tokyo";
  }
}

function formatDiscordDateTime(date: Date): string {
  return Utilities.formatDate(date, getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function safeLogValue(value?: string | number, maxLength: number = 120): string {
  if (value === undefined || value === null) {
    return "";
  }
  return truncate(String(value).replace(/\s+/g, " ").trim(), maxLength);
}

function getDiscordResponseCode(error: any): number | undefined {
  return typeof error?.responseCode === "number" ? error.responseCode : undefined;
}

function appendDiscordNotificationLog(entry: DiscordNotificationLogEntry): void {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      Logger.log("Discord notification sheet log skipped: active spreadsheet not found.");
      return;
    }

    const sheet =
      spreadsheet.getSheetByName(DISCORD_LOG_SHEET_NAME) ||
      spreadsheet.insertSheet(DISCORD_LOG_SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(DISCORD_LOG_HEADERS);
    }

    sheet.appendRow([
      formatDiscordDateTime(new Date()),
      entry.eventType,
      entry.status || "",
      entry.notificationStatus,
      safeLogValue(entry.accountId),
      safeLogValue(entry.internalId),
      safeLogValue(entry.postId),
      safeLogValue(entry.scheduledAt),
      entry.responseCode === undefined ? "" : entry.responseCode,
      safeLogValue(entry.errorMessage, 300),
    ]);

    const dataRowCount = sheet.getLastRow() - 1;
    if (dataRowCount > DISCORD_LOG_MAX_ROWS) {
      sheet.deleteRows(2, dataRowCount - DISCORD_LOG_MAX_ROWS);
    }
  } catch (logError: any) {
    Logger.log(`Discord notification sheet log failed: ${logError.message || logError}`);
  }
}

function buildDiscordMessage(payload: PostNotificationPayload): string {
  const titleByStatus: Record<PostNotificationStatus, string> = {
    success: "X自動投稿が完了しました",
    error: "X自動投稿に失敗しました",
    critical: "X自動投稿で重大エラーが発生しました",
  };

  const lines = [
    `**${titleByStatus[payload.status]}**`,
    formatOptionalLine("Xアカウント", payload.accountId),
    formatOptionalLine("内部ID", payload.internalId),
    formatOptionalLine("X投稿ID", payload.postId),
    formatOptionalLine("予約日時", payload.scheduledAt),
    formatOptionalLine(
      "本文",
      payload.content ? truncate(payload.content.replace(/\s+/g, " "), 300) : ""
    ),
    formatOptionalLine("エラー", payload.errorMessage),
  ].filter(Boolean);

  return truncate(lines.join("\n"), DISCORD_MESSAGE_LIMIT);
}

function postDiscordWebhook(webhookUrl: string, content: string): { responseCode: number } {
  const response = UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      content,
    }),
    muteHttpExceptions: true,
  });
  const responseCode = response.getResponseCode();
  if (responseCode < 200 || responseCode >= 300) {
    const error = new Error(
      `Discord webhook returned ${responseCode}: ${truncate(
        response.getContentText(),
        300
      )}`
    ) as Error & { responseCode?: number };
    error.responseCode = responseCode;
    throw error;
  }
  return { responseCode };
}

function sendDiscordPostNotification(payload: PostNotificationPayload): void {
  try {
    const properties = PropertiesService.getScriptProperties();
    const enabled = properties.getProperty(DISCORD_NOTIFICATION_ENABLED_KEY) === "true";
    const webhookUrl = properties.getProperty(DISCORD_WEBHOOK_URL_KEY);

    if (!enabled || !webhookUrl) {
      return;
    }

    const result = postDiscordWebhook(webhookUrl, buildDiscordMessage(payload));
    appendDiscordNotificationLog({
      eventType: "post",
      status: payload.status,
      notificationStatus: "success",
      accountId: payload.accountId,
      internalId: payload.internalId,
      postId: payload.postId,
      scheduledAt: payload.scheduledAt,
      responseCode: result.responseCode,
    });
  } catch (error: any) {
    Logger.log(`Failed to send Discord notification: ${error.message || error}`);
    appendDiscordNotificationLog({
      eventType: "post",
      status: payload.status,
      notificationStatus: "failure",
      accountId: payload.accountId,
      internalId: payload.internalId,
      postId: payload.postId,
      scheduledAt: payload.scheduledAt,
      responseCode: getDiscordResponseCode(error),
      errorMessage: error.message || String(error),
    });
  }
}

function sendDiscordTestNotification(webhookUrl?: string): {
  sent: boolean;
  hasWebhookUrl: boolean;
} {
  const properties = PropertiesService.getScriptProperties();
  const targetWebhookUrl =
    typeof webhookUrl === "string" && webhookUrl.trim()
      ? webhookUrl.trim()
      : properties.getProperty(DISCORD_WEBHOOK_URL_KEY);

  if (!targetWebhookUrl) {
    throw new Error("Discord Webhook URL is not configured.");
  }
  if (!DISCORD_WEBHOOK_URL_PATTERN.test(targetWebhookUrl)) {
    throw new Error("Invalid Discord Webhook URL.");
  }

  try {
    const result = postDiscordWebhook(
      targetWebhookUrl,
      [
        "**虎威 Discord通知テスト**",
        "このメッセージが届いていれば、Webhook URLは正しく設定されています。",
        `送信日時: ${formatDiscordDateTime(new Date())}`,
      ].join("\n")
    );
    appendDiscordNotificationLog({
      eventType: "test",
      notificationStatus: "success",
      responseCode: result.responseCode,
    });
  } catch (error: any) {
    appendDiscordNotificationLog({
      eventType: "test",
      notificationStatus: "failure",
      responseCode: getDiscordResponseCode(error),
      errorMessage: error.message || String(error),
    });
    throw error;
  }

  return {
    sent: true,
    hasWebhookUrl: true,
  };
}

export { formatDiscordDateTime, sendDiscordPostNotification, sendDiscordTestNotification };
export type { PostNotificationPayload };
