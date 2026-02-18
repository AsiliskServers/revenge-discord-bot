export const FEATURE_KEY_ROLES_REACTION = "roles-reaction";
export const FEATURE_KEY_VOICE_CREATOR = "voice-creator";

export type RoleReactionEntry = {
  key: string;
  label: string;
  roleId: string;
};

export type RoleReactionFeatureConfig = {
  channelId: string;
  roles: RoleReactionEntry[];
};

export type VoiceCreatorFeatureConfig = {
  creatorChannelId: string;
  targetCategoryId: string;
  emptyDeleteDelayMs: number;
  tempVoiceNamePrefix: string;
};

export type FeatureRecord<TConfig> = {
  guildId: string;
  featureKey: string;
  enabled: boolean;
  config: TConfig;
  updatedAt: string;
};

export const DEFAULT_ROLE_REACTION_CONFIG: RoleReactionFeatureConfig = {
  channelId: "1470813116395946229",
  roles: [
    { key: "giveaways", label: "🎁┃Giveaways", roleId: "1379156738346848297" },
    { key: "annonces", label: "📢┃Annonces", roleId: "1472050708474761502" },
    { key: "sondages", label: "📊┃Sondages", roleId: "1472050709158432862" },
    { key: "events", label: "🎉┃Événements", roleId: "1472050710186033254" },
  ],
};

export const DEFAULT_VOICE_CREATOR_CONFIG: VoiceCreatorFeatureConfig = {
  creatorChannelId: "1473103122321903789",
  targetCategoryId: "1382993339728789595",
  emptyDeleteDelayMs: 5000,
  tempVoiceNamePrefix: "🔊・Salon de ",
};
