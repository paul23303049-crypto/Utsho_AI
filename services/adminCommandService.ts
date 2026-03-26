
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
  isAdmin: boolean
): Promise<AdminCommandResult> => {
  const trimmed = message.trim();
  
  // Only process messages starting with /
  if (!trimmed.startsWith("/")) {
    return { handled: false, response: "" };
  }

  // Non-admin users can't use admin commands
  if (!isAdmin) {
    // Allow /status for admin only, ignore for others
    return { handled: false, response: "" };
  }

  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const subCommand = parts[1]?.toLowerCase() || "";
  const rest = parts.slice(2).join(" ").trim();

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

    // /status
    if (command === "/status") {
      const [directives, knowledge, config] = await Promise.all([
        db.getAdminDirectives(),
        db.getKnowledgeBase(),
        db.getAdminConfig(),
      ]);
      const configStr = Object.entries(config).map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v.slice(0, 60) : v}`).join("\n") || "  (none)";
      return {
        handled: true,
        response: `System Status:\n\nDirectives: ${directives.length} active\nKnowledge entries: ${knowledge.length}\n\nConfig:\n${configStr}\n\nCommands:\n/set directive <text>\n/set personality <text>\n/set greeting <text>\n/set config <key> <value>\n/train <topic> :: <content>\n/list directives\n/list knowledge\n/remove directive <id>\n/remove knowledge <id>`
      };
    }

    // /help
    if (command === "/help") {
      return {
        handled: true,
        response: `Admin Commands:\n\n/set directive <text> - Add global behavioral rule\n/set personality <text> - Set AI personality\n/set greeting <text> - Set greeting style\n/set config <key> <value> - Set config value\n/train <topic> :: <content> - Add to knowledge base\n/list directives - Show all directives\n/list knowledge - Show knowledge base\n/remove directive <id> - Remove a directive\n/remove knowledge <id> - Remove knowledge entry\n/status - Show system status\n/help - Show this help`
      };
    }

  } catch (error: any) {
    return { handled: true, response: `Command failed: ${error.message}` };
  }

  return { handled: false, response: "" };
};
