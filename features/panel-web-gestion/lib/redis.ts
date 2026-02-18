import Redis from "ioredis";

let publisher: Redis | null = null;

export function getRedisPublisher(): Redis | null {
  const redisUrl = process.env.PANEL_REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  if (publisher) {
    return publisher;
  }

  publisher = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  publisher.on("error", (error) => {
    console.error("[PANEL REDIS] Erreur", error.message);
  });

  return publisher;
}

export async function publishFeatureUpdate(payload: unknown): Promise<void> {
  const redis = getRedisPublisher();
  if (!redis) {
    return;
  }

  const channel = process.env.PANEL_REDIS_CHANNEL || "revenge:feature:update";
  await redis.publish(channel, JSON.stringify(payload));
}
