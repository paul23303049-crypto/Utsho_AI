
import * as db from "./firebaseService";

/**
 * Admin Command Service
 * 
 * Allows the admin (Shakkhor) to configure the AI's behavior
 * directly through chat commands without touching code.
 * 
 * Commands:
 *   /set directive <text>       - Add a global behavioral rule
 *   /remove directive <id>      - Remove a directive by ID
 *   /list directives            - Show all active directives
 *   /set personality <text>     - Set global personality description
 *   /set greeting <text>        - Set default greeting message
 *   /set config <key> <value>   - Set any global config value
 *   /train <topic> :: <content> - Add knowledge to the global knowledge base
 *   /remove knowledge <id>      - Remove knowledge entry
 *   /list knowledge             - Show all knowledge entries
 *   /status                     - Show system configuration status
 */

export interface AdminCommandResult {
  handled: boolean;
  response: string;
}

// Cache for directives and knowledge to avoid repeated Firebase reads
let cachedDirectives: { id: string; type: string; content: string }[] | null = null;
let cachedKnowledge: { id: string; topic: string; content: string; source: string }[] | null = null;
let cachedConfig: Record<string, string> | null = null;
let lastCacheRefresh = 0;
const CACHE_TTL = 60 * 1000; // 1 minute cache

/**
 * Refresh the cached directives, knowledge, and config from Firebase.
 */
export const refreshCache = async (): Promise<void> => {
  try {
    const [directives, knowledge, config] = await Promise.all([
      db.getAdminDirectives(),
      db.getKnowledgeBase(),
      db.getAdminConfig(),
    ]);
    cachedDirectives = directives;
    cachedKnowledge = knowledge;
    cachedConfig = config;
    lastCacheRefresh = Date.now();
  } catch (e) {
    console.warn("ADMIN_CMD: Cache refresh failed:", e);
  }
};

/**
 * Get cached directives (refreshes if stale).
 */
export const getDirectives = async (): Promise<{ id: string; type: string; content: string }[]> => {
  if (!cachedDirectives || Date.now() - lastCacheRefresh > CACHE_TTL) {
    await refreshCache();
  }
  return cachedDirectives || [];
};

/**
 * Get cached knowledge base (refreshes if stale).
 */
export const getKnowledge = async (): Promise<{ id: string; topic: string; content: string; source: string }[]> => {
  if (!cachedKnowledge || Date.now() - lastCacheRefresh > CACHE_TTL) {
    await refreshCache();
  }
  return cachedKnowledge || [];
};

/**
 * Get cached admin config (refreshes if stale).
 */
export const getConfig = async (): Promise<Record<string, string>> => {
  if (!cachedConfig || Date.now() - lastCacheRefresh > CACHE_TTL) {
    await refreshCache();
  }
  return cachedConfig || {};
};

/**
 * Format directives and knowledge for injection into the system prompt.
 */
export const formatForSystemPrompt = async (): Promise<string> => {
  const [directives, knowledge, config] = await Promise.all([
    getDirectives(),
    getKnowledge(),
    getConfig(),
  ]);

  const parts: string[] = [];

  // Global personality override
  if (config.personality) {
    parts.push(`GLOBAL PERSONALITY: ${config.personality}`);
  }

  // Global greeting
  if (config.greeting) {
    parts.push(`DEFAULT GREETING STYLE: ${config.greeting}`);
  }

  // Admin directives (behavioral rules)
  if (directives.length > 0) {
    const rules = directives.map(d => `- ${d.content}`).join("\n");
    parts.push(`ADMIN DIRECTIVES (follow these strictly):\n${rules}`);
  }

  // Knowledge base
  if (knowledge.length > 0) {
    const kb = knowledge.slice(-20).map(k => `- ${k.topic}: ${k.content}`).join("\n");
    parts.push(`KNOWLEDGE BASE (reference when relevant):\n${kb}`);
  }

  // Any other config values
  const skipKeys = new Set(["personality", "greeting"]);
  const otherConfig = Object.entries(config).filter(([k]) => !skipKeys.has(k));
  if (otherConfig.length > 0) {
    const extras = otherConfig.map(([k, v]) => `- ${k}: ${v}`).join("\n");
    parts.push(`ADDITIONAL CONFIG:\n${extras}`);
  }

  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
};

/**
 * Process an admin command from chat input.
 * Returns { handled: true, response } if the message was a command,
 * or { handled: false, response: "" } if it was a normal message.
 */
export const processAdminCommand = async (
  message: string,
  isAdmin: boolean,
  userEmail?: string,
  userName?: string
): Promise<AdminCommandResult> => {
  const trimmed = message.trim();
  
  // Only process messages starting with /
  if (!trimmed.startsWith("/")) {
    return { handled: false, response: "" };
  }

  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const subCommand = parts[1]?.toLowerCase() || "";
  const rest = parts.slice(2).join(" ").trim();

  // === USER COMMANDS (available to ALL users) ===
  try {
    // /feedback <message> -- Send feedback to admin
    if (command === "/feedback") {
      const feedbackText = parts.slice(1).join(" ").trim();
      if (!feedbackText) return { handled: true, response: "Usage: /feedback <your message>\n\nSend feedback, suggestions, or report issues directly to the admin." };
      const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.saveFeedback({
        id,
        fromEmail: (userEmail || "anonymous").toLowerCase(),
        fromName: userName || "Anonymous",
        message: feedbackText,
        createdAt: new Date(),
        read: false,
      });
      return { handled: true, response: "Your feedback has been sent to the admin. Thank you!" };
    }

    // /myreplies -- Check if admin has replied to your feedback
    if (command === "/myreplies") {
      if (!userEmail) return { handled: true, response: "You need to be logged in to check replies." };
      const replies = await db.getUserFeedbackReplies(userEmail);
      if (replies.length === 0) return { handled: true, response: "No replies from the admin yet. Use /feedback <message> to send feedback." };
      const list = replies.map((r, i) => `${i + 1}. You said: "${r.message.slice(0, 60)}${r.message.length > 60 ? '...' : ''}"\n   Admin replied: "${r.reply}"\n   (${r.repliedAt.toLocaleDateString()})`).join("\n\n");
      return { handled: true, response: `Admin Replies (${replies.length}):\n\n${list}` };
    }
  } catch (error: any) {
    return { handled: true, response: `Command failed: ${error.message}` };
  }

  // === ADMIN-ONLY COMMANDS ===
  if (!isAdmin) {
    return { handled: false, response: "" };
  }

  try {
    // /set directive <text>
    if (command === "/set" && subCommand === "directive") {
      if (!rest) return { handled: true, response: "Usage: /set directive <rule text>" };
      const id = `dir_${Date.now()}`;
      await db.saveAdminDirective(id, { type: "directive", content: rest, createdAt: new Date() });
      cachedDirectives = null; // Invalidate cache
      return { handled: true, response: `Directive added (ID: ${id}):\n"${rest}"\n\nThis rule is now active for all users.` };
    }

    // /remove directive <id>
    if (command === "/remove" && subCommand === "directive") {
      if (!rest) return { handled: true, response: "Usage: /remove directive <id>" };
      await db.removeAdminDirective(rest);
      cachedDirectives = null;
      return { handled: true, response: `Directive "${rest}" removed.` };
    }

    // /list directives
    if (command === "/list" && subCommand === "directives") {
      const directives = await db.getAdminDirectives();
      cachedDirectives = directives;
      if (directives.length === 0) return { handled: true, response: "No directives set. Use /set directive <text> to add one." };
      const list = directives.map((d, i) => `${i + 1}. [${d.id}] ${d.content}`).join("\n");
      return { handled: true, response: `Active Directives (${directives.length}):\n${list}` };
    }

    // /set personality <text>
    if (command === "/set" && subCommand === "personality") {
      if (!rest) return { handled: true, response: "Usage: /set personality <description>" };
      await db.saveAdminConfig("personality", rest);
      cachedConfig = null;
      return { handled: true, response: `Global personality set to:\n"${rest}"\n\nApplies to all users immediately.` };
    }

    // /set greeting <text>
    if (command === "/set" && subCommand === "greeting") {
      if (!rest) return { handled: true, response: "Usage: /set greeting <greeting style>" };
      await db.saveAdminConfig("greeting", rest);
      cachedConfig = null;
      return { handled: true, response: `Greeting style set to:\n"${rest}"` };
    }

    // /set config <key> <value>
    if (command === "/set" && subCommand === "config") {
      const configKey = parts[2] || "";
      const configValue = parts.slice(3).join(" ").trim();
      if (!configKey || !configValue) return { handled: true, response: "Usage: /set config <key> <value>" };
      await db.saveAdminConfig(configKey, configValue);
      cachedConfig = null;
      return { handled: true, response: `Config "${configKey}" set to: "${configValue}"` };
    }

    // /train <topic> :: <content>
    if (command === "/train") {
      const trainContent = parts.slice(1).join(" ");
      const separator = trainContent.indexOf("::");
      if (separator === -1) return { handled: true, response: "Usage: /train <topic> :: <knowledge content>" };
      const topic = trainContent.slice(0, separator).trim();
      const content = trainContent.slice(separator + 2).trim();
      if (!topic || !content) return { handled: true, response: "Usage: /train <topic> :: <knowledge content>" };
      const id = `kb_${Date.now()}`;
      await db.saveKnowledge(id, { topic, content, source: "admin", createdAt: new Date() });
      cachedKnowledge = null;
      return { handled: true, response: `Knowledge added (ID: ${id}):\nTopic: ${topic}\nContent: ${content}` };
    }

    // /remove knowledge <id>
    if (command === "/remove" && subCommand === "knowledge") {
      if (!rest) return { handled: true, response: "Usage: /remove knowledge <id>" };
      await db.removeKnowledge(rest);
      cachedKnowledge = null;
      return { handled: true, response: `Knowledge entry "${rest}" removed.` };
    }

    // /list knowledge
    if (command === "/list" && subCommand === "knowledge") {
      const knowledge = await db.getKnowledgeBase();
      cachedKnowledge = knowledge;
      if (knowledge.length === 0) return { handled: true, response: "Knowledge base is empty. Use /train <topic> :: <content> to add entries." };
      const list = knowledge.map((k, i) => `${i + 1}. [${k.id}] ${k.topic}: ${k.content.slice(0, 100)}${k.content.length > 100 ? '...' : ''}`).join("\n");
      return { handled: true, response: `Knowledge Base (${knowledge.length} entries):\n${list}` };
    }

    // /inbox -- View all user feedback
    if (command === "/inbox") {
      const feedback = await db.getAllFeedback();
      if (feedback.length === 0) return { handled: true, response: "No feedback messages yet." };
      const unread = feedback.filter(f => !f.read).length;
      const list = feedback.slice(0, 20).map((f, i) => {
        const status = f.read ? (f.reply ? 'replied' : 'read') : 'NEW';
        return `${i + 1}. [${status}] ${f.fromName} (${f.fromEmail})\n   "${f.message.slice(0, 80)}${f.message.length > 80 ? '...' : ''}"\n   ID: ${f.id} | ${f.createdAt.toLocaleDateString()}${f.reply ? '\n   Your reply: "' + f.reply.slice(0, 60) + '"' : ''}`;
      }).join("\n\n");
      return { handled: true, response: `Inbox (${unread} unread / ${feedback.length} total):\n\n${list}\n\nUse /reply <feedback-id> <message> to respond.` };
    }

    // /reply <feedback-id> <message> -- Reply to user feedback
    if (command === "/reply") {
      const feedbackId = parts[1] || "";
      const replyText = parts.slice(2).join(" ").trim();
      if (!feedbackId || !replyText) return { handled: true, response: "Usage: /reply <feedback-id> <message>\n\nCheck /inbox for feedback IDs." };
      await db.replyToFeedback(feedbackId, replyText);
      return { handled: true, response: `Reply sent to feedback ${feedbackId}:\n"${replyText}"\n\nThe user can see your reply with /myreplies.` };
    }

    // /read <feedback-id> -- Mark feedback as read
    if (command === "/read") {
      const feedbackId = parts[1] || "";
      if (!feedbackId) return { handled: true, response: "Usage: /read <feedback-id>" };
      await db.markFeedbackRead(feedbackId);
      return { handled: true, response: `Feedback ${feedbackId} marked as read.` };
    }

    // /status
    if (command === "/status") {
      const [directives, knowledge, config, unreadCount] = await Promise.all([
        db.getAdminDirectives(),
        db.getKnowledgeBase(),
        db.getAdminConfig(),
        db.getUnreadFeedbackCount(),
      ]);
      const configStr = Object.entries(config).map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v.slice(0, 60) : v}`).join("\n") || "  (none)";
      return {
        handled: true,
        response: `System Status:\n\nDirectives: ${directives.length} active\nKnowledge entries: ${knowledge.length}\nUnread feedback: ${unreadCount}\n\nConfig:\n${configStr}`
      };
    }

    // /help
    if (command === "/help") {
      return {
        handled: true,
        response: `Admin Commands:\n\n--- Configuration ---\n/set directive <text> - Add global behavioral rule\n/set personality <text> - Set AI personality\n/set greeting <text> - Set greeting style\n/set config <key> <value> - Set config value\n/train <topic> :: <content> - Add to knowledge base\n/list directives - Show all directives\n/list knowledge - Show knowledge base\n/remove directive <id> - Remove a directive\n/remove knowledge <id> - Remove knowledge entry\n\n--- Feedback ---\n/inbox - View user feedback messages\n/reply <id> <message> - Reply to feedback\n/read <id> - Mark feedback as read\n\n--- System ---\n/status - Show system status\n/help - Show this help\n\n--- User Commands (all users) ---\n/feedback <message> - Send feedback to admin\n/myreplies - Check admin replies`
      };
    }

  } catch (error: any) {
    return { handled: true, response: `Command failed: ${error.message}` };
  }

  return { handled: false, response: "" };
};
