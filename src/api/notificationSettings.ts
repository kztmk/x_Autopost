type NotificationSettingsRequest = {
  enabled: boolean;
  webhookUrl?: string;
};

const DISCORD_NOTIFICATION_ENABLED_KEY = "discord_notification_enabled";
const DISCORD_WEBHOOK_URL_KEY = "discord_webhook_url";
const DISCORD_WEBHOOK_URL_PATTERN =
  /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/;

function isValidDiscordWebhookUrl(url: string): boolean {
  return DISCORD_WEBHOOK_URL_PATTERN.test(url);
}

function upsertNotificationSettings(request: NotificationSettingsRequest): {
  enabled: boolean;
  hasWebhookUrl: boolean;
} {
  if (!request || typeof request.enabled !== "boolean") {
    throw new Error("Missing or invalid notification setting: enabled.");
  }

  const properties = PropertiesService.getScriptProperties();
  const webhookUrl =
    typeof request.webhookUrl === "string" ? request.webhookUrl.trim() : "";

  if (request.enabled) {
    const currentWebhookUrl = properties.getProperty(DISCORD_WEBHOOK_URL_KEY);
    if (!webhookUrl) {
      if (!currentWebhookUrl) {
        throw new Error("Discord Webhook URL is required when notification is enabled.");
      }
      properties.setProperty(DISCORD_NOTIFICATION_ENABLED_KEY, "true");
      return {
        enabled: true,
        hasWebhookUrl: true,
      };
    }

    if (!isValidDiscordWebhookUrl(webhookUrl)) {
      throw new Error("Invalid Discord Webhook URL.");
    }

    properties.setProperties({
      [DISCORD_NOTIFICATION_ENABLED_KEY]: "true",
      [DISCORD_WEBHOOK_URL_KEY]: webhookUrl,
    });

    return {
      enabled: true,
      hasWebhookUrl: true,
    };
  }

  properties.setProperty(DISCORD_NOTIFICATION_ENABLED_KEY, "false");
  properties.deleteProperty(DISCORD_WEBHOOK_URL_KEY);

  return {
    enabled: false,
    hasWebhookUrl: false,
  };
}

export { upsertNotificationSettings };
