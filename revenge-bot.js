const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
dotenv.config();

function loadPanelEnvFallback() {
  const panelEnvPath = path.join(__dirname, "features", "panel-web-gestion", ".env");
  if (!fs.existsSync(panelEnvPath)) {
    return;
  }

  try {
    const parsed = dotenv.parse(fs.readFileSync(panelEnvPath));
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.error(`[CONFIG] Impossible de charger ${panelEnvPath}`);
    console.error(error);
  }
}

loadPanelEnvFallback();
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
} = require("discord.js");

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const VERBOSE_BOOT = process.env.BOT_VERBOSE_BOOT === "1";
const SKIP_DIRECTORY_NAMES = new Set([
  "controls",
  ".cache",
  ".runtime",
  "_shared",
  "panel-web-gestion",
  "node_modules",
  ".next",
  "dist",
]);

const MODULE_DIRECTORIES = ["features", "commands", "events"];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.modules = new Collection();
client.config = {
  guildId: GUILD_ID,
};

function getJsFilesRecursively(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      files.push(...getJsFilesRecursively(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function initializeLoadedModule(loadedModule, filePath) {
  const moduleName =
    loadedModule?.name || path.relative(__dirname, filePath).replace(/\\/g, "/");

  if (typeof loadedModule === "function") {
    await loadedModule(client, client.config);
    client.modules.set(moduleName, loadedModule);
    return moduleName;
  }

  if (loadedModule && typeof loadedModule === "object") {
    const lifecycleMethods = ["init", "setup", "register", "start"];

    for (const method of lifecycleMethods) {
      if (typeof loadedModule[method] === "function") {
        await loadedModule[method](client, client.config);
        client.modules.set(moduleName, loadedModule);
        return moduleName;
      }
    }
  }

  console.warn(
    `[SKIP] ${path.relative(__dirname, filePath)}: export invalide (fonction ou objet avec init/setup/register/start requis).`
  );
  return null;
}

async function loadModulesFromDirectories() {
  let loadedCount = 0;

  for (const directory of MODULE_DIRECTORIES) {
    const absoluteDirectory = path.join(__dirname, directory);

    if (!fs.existsSync(absoluteDirectory)) {
      if (VERBOSE_BOOT) {
        console.log(`[INFO] Dossier absent, ignoré: ${directory}/`);
      }
      continue;
    }

    const files = getJsFilesRecursively(absoluteDirectory);

    if (files.length === 0) {
      if (VERBOSE_BOOT) {
        console.log(`[INFO] Aucun fichier .js trouvé dans ${directory}/`);
      }
      continue;
    }

    for (const filePath of files) {
      try {
        const required = require(filePath);
        const moduleExport = required?.default ?? required;
        const initializedName = await initializeLoadedModule(moduleExport, filePath);

        if (initializedName) {
          loadedCount += 1;
          console.log(`[LOAD] ${initializedName}`);
        }
      } catch (error) {
        console.error(
          `[ERROR] Impossible de charger ${path.relative(__dirname, filePath)}`
        );
        console.error(error);
      }
    }
  }

  console.log(`[INFO] Modules chargés: ${loadedCount}`);
}

client.once("clientReady", () => {
  console.log(`[READY] Connecté en tant que ${client.user.tag}`);
});

client.on("error", (error) => {
  console.error("[DISCORD CLIENT ERROR]");
  console.error(error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]");
  console.error(reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT EXCEPTION]");
  console.error(error);
});

async function bootstrap() {
  await loadModulesFromDirectories();

  if (!TOKEN || !GUILD_ID) {
    console.error("[CONFIG] Renseigne DISCORD_BOT_TOKEN et DISCORD_GUILD_ID dans .env.");
    return;
  }

  await client.login(TOKEN);
}

bootstrap().catch((error) => {
  console.error("[BOOTSTRAP ERROR]");
  console.error(error);
});
