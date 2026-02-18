type DiscordGuildRole = {
  id: string;
  name: string;
  position: number;
  managed: boolean;
};

type DiscordGuildChannel = {
  id: string;
  name: string;
  type: number;
  position: number;
};

export type GuildMetaRole = {
  id: string;
  name: string;
};

export type GuildMetaChannel = {
  id: string;
  name: string;
};

export type GuildMetaResult = {
  roles: GuildMetaRole[];
  channels: GuildMetaChannel[];
  warning?: string;
};

function getBotToken(): string {
  const token = (process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN manquant");
  }
  return token;
}

async function fetchDiscord<T>(path: string): Promise<T> {
  const token = getBotToken();
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Discord API ${path} -> ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchGuildMeta(guildId: string): Promise<GuildMetaResult> {
  try {
    const [rolesRaw, channelsRaw] = await Promise.all([
      fetchDiscord<DiscordGuildRole[]>(`/guilds/${guildId}/roles`),
      fetchDiscord<DiscordGuildChannel[]>(`/guilds/${guildId}/channels`),
    ]);

    const roles = rolesRaw
      .filter((role) => role.id !== guildId && !role.managed)
      .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
      .map((role) => ({ id: role.id, name: role.name }));

    const channels = channelsRaw
      .filter((channel) => channel.type === 0)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((channel) => ({ id: channel.id, name: channel.name }));

    return { roles, channels };
  } catch (error) {
    return {
      roles: [],
      channels: [],
      warning: `Impossible de charger les rôles/salons Discord: ${String(error)}`,
    };
  }
}
