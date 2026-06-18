import {
  DISCORD_NOTIFICATION_ENABLED_KEY,
  DISCORD_WEBHOOK_URL_KEY,
  DISCORD_WEBHOOK_URL_PATTERN,
} from "./discordNotification";

type NotificationSettingsRequest = {
  enabled: boolean;
  webhookUrl?: string;
};

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
  const currentWebhookUrl = properties.getProperty(DISCORD_WEBHOOK_URL_KEY);
  const webhookUrl =
    typeof request.webhookUrl === "string" ? request.webhookUrl.trim() : "";

  if (request.enabled) {
    if (!webhookUrl) {
      if (!currentWebhookUrl) {
        throw new Error("Discord Webhook URL is required when notification is enabled.");
      }
      if (!isValidDiscordWebhookUrl(currentWebhookUrl)) {
        throw new Error("Saved Discord Webhook URL is invalid.");
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

  const propertiesToSet: Record<string, string> = {
    [DISCORD_NOTIFICATION_ENABLED_KEY]: "false",
  };
  if (webhookUrl) {
    if (!isValidDiscordWebhookUrl(webhookUrl)) {
      throw new Error("Invalid Discord Webhook URL.");
    }
    propertiesToSet[DISCORD_WEBHOOK_URL_KEY] = webhookUrl;
  }
  properties.setProperties(propertiesToSet);

  return {
    enabled: false,
    hasWebhookUrl: Boolean(webhookUrl || currentWebhookUrl),
  };
}

export { upsertNotificationSettings };
