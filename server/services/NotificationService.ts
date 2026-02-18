const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let hasLoggedMissingConfig = false;

export class NotificationService {
  /**
   * Low-level method to send a message via Telegram Bot API
   * Fire-and-forget: catches and logs errors without throwing
   */
  static async sendTelegramMessage(message: string): Promise<void> {
    try {
      // Silently skip if configuration is missing
      if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        if (!hasLoggedMissingConfig) {
          console.log(
            "[NotificationService] Telegram configuration not found (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID). Notifications disabled."
          );
          hasLoggedMissingConfig = true;
        }
        return;
      }

      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(
          `[NotificationService] Failed to send Telegram message. Status: ${response.status}, Body: ${errorData}`
        );
      } else {
        console.log("[NotificationService] Telegram message sent successfully");
      }
    } catch (error) {
      console.error(
        "[NotificationService] Error sending Telegram message:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Notify about a new user registration
   * Fire-and-forget: catches and logs errors without throwing
   */
  static async notifyNewUser(
    username: string,
    email: string,
    totalUsers: number
  ): Promise<void> {
    try {
      const message = `🎉 *New User Registered*\n\n` +
        `👤 Username: \`${username}\`\n` +
        `📧 Email: \`${email}\`\n` +
        `👥 Total Users: *${totalUsers}*`;

      await this.sendTelegramMessage(message);
    } catch (error) {
      console.error(
        "[NotificationService] Error in notifyNewUser:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Notify about token usage threshold (80% of monthly limit)
   * Fire-and-forget: catches and logs errors without throwing
   */
  static async notifyTokenThreshold(
    username: string,
    email: string | null,
    plan: string,
    usagePercent: number
  ): Promise<void> {
    try {
      const emailDisplay = email ? `\`${email}\`` : "_Not available_";
      const message = `⚠️ *Token Usage Alert*\n\n` +
        `👤 Username: \`${username}\`\n` +
        `📧 Email: ${emailDisplay}\n` +
        `📊 Plan: *${plan}*\n` +
        `💾 Usage: *${usagePercent.toFixed(1)}%* of monthly limit\n\n` +
        `_User is approaching their monthly token limit._`;

      await this.sendTelegramMessage(message);
    } catch (error) {
      console.error(
        "[NotificationService] Error in notifyTokenThreshold:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Notify about system errors
   * Fire-and-forget: catches and logs errors without throwing
   */
  static async notifySystemError(
    source: string,
    errorMessage: string
  ): Promise<void> {
    try {
      const message = `🚨 *System Error*\n\n` +
        `📍 Source: \`${source}\`\n` +
        `❌ Error: \`${errorMessage}\`\n\n` +
        `_Immediate attention may be required._`;

      await this.sendTelegramMessage(message);
    } catch (error) {
      console.error(
        "[NotificationService] Error in notifySystemError:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
