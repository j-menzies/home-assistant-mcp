import { config } from "dotenv";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

config();

const configSchema = z.object({
  MCP_API_KEY: z.string().min(1, "MCP_API_KEY is required"),
  MCP_PORT: z.coerce.number().int().positive().default(3000),
  MCP_HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  HA_BASE_URL: z.string().url("HA_BASE_URL must be a valid URL"),
  HA_TOKEN: z.string().min(1, "HA_TOKEN is required"),
  MCP_SKIP_AUTH: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof configSchema>;

function ensureApiKey(): string {
  const envPath = resolve(process.cwd(), ".env");
  const existingKey = process.env["MCP_API_KEY"];

  if (existingKey && existingKey.length > 0) {
    return existingKey;
  }

  // Generate a new 256-bit key
  const newKey = randomBytes(32).toString("hex");
  console.log("Generated new MCP API key. Add this to your MCP client configuration.");
  console.log(`MCP_API_KEY=${newKey}`);

  // Append to .env if it exists, or create it
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    if (!content.includes("MCP_API_KEY=")) {
      writeFileSync(envPath, `${content}\nMCP_API_KEY=${newKey}\n`);
    }
  } else {
    writeFileSync(envPath, `MCP_API_KEY=${newKey}\n`);
  }

  return newKey;
}

function loadConfig(): AppConfig {
  const apiKey = ensureApiKey();
  process.env["MCP_API_KEY"] = apiKey;

  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error("Configuration errors:\n" + errors);
    process.exit(1);
  }

  const cfg = result.data;

  if (cfg.MCP_SKIP_AUTH && cfg.NODE_ENV === "production") {
    console.error("MCP_SKIP_AUTH cannot be true in production.");
    process.exit(1);
  }

  return cfg;
}

export const appConfig = loadConfig();

export const isDev = appConfig.NODE_ENV === "development";
