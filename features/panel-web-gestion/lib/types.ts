export const FEATURE_KEY_ROLES_REACTION = "roles-reaction";

export type RoleReactionEntry = {
  key: string;
  label: string;
  roleId: string;
};

export type RoleReactionFeatureConfig = {
  channelId: string;
  roles: RoleReactionEntry[];
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
    { key: "events", label: "🎉┃Événements", roleId: "1472050710186033254" }
  ]
};
