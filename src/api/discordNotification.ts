type PostNotificationStatus = "success" | "error" | "critical";

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
  /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+(\?[\w=&-]+)?$/;
const DISCORD_MESSAGE_LIMIT = 1900;

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

function postDiscordWebhook(webhookUrl: string, content: string): void {
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
    throw new Error(
      `Discord webhook returned ${responseCode}: ${truncate(
        response.getContentText(),
        300
      )}`
    );
  }
}

function sendDiscordPostNotification(payload: PostNotificationPayload): void {
  const properties = PropertiesService.getScriptProperties();
  const enabled = properties.getProperty(DISCORD_NOTIFICATION_ENABLED_KEY) === "true";
  const webhookUrl = properties.getProperty(DISCORD_WEBHOOK_URL_KEY);

  if (!enabled || !webhookUrl) {
    return;
  }

  try {
    postDiscordWebhook(webhookUrl, buildDiscordMessage(payload));
  } catch (error: any) {
    Logger.log(`Failed to send Discord notification: ${error.message || error}`);
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

  postDiscordWebhook(
    targetWebhookUrl,
    [
      "**虎威 Discord通知テスト**",
      "このメッセージが届いていれば、Webhook URLは正しく設定されています。",
      `送信日時: ${formatDiscordDateTime(new Date())}`,
    ].join("\n")
  );

  return {
    sent: true,
    hasWebhookUrl: true,
  };
}

export { formatDiscordDateTime, sendDiscordPostNotification, sendDiscordTestNotification };
export type { PostNotificationPayload };
