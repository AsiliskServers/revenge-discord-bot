const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");
const play = require("play-dl");
const {
  AudioPlayerStatus: VoiceAudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType: VoiceStreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require("@discordjs/voice");
const YTDlpWrap = require("yt-dlp-wrap").default;
const previousControl = require("./controls/previous-control");
const pauseControl = require("./controls/pause-control");
const resumeControl = require("./controls/resume-control");
const replayControl = require("./controls/replay-control");
const nextControl = require("./controls/next-control");
const clearQueueControl = require("./controls/clear-queue-control");
const stopControl = require("./controls/stop-control");
const {
  deleteGuildCommand,
  upsertGuildCommand,
} = require("../_shared/common");

const COMMAND_NAME = "play";
const LEGACY_COMMAND_NAME = "rplay";
const MAX_YOUTUBE_PLAYLIST_TRACKS = 100;
const YTDLP_BIN_DIR = path.join(__dirname, ".runtime");
const YTDLP_BIN_PATH =
  process.platform === "win32"
    ? path.join(YTDLP_BIN_DIR, "yt-dlp.exe")
    : path.join(YTDLP_BIN_DIR, "yt-dlp");
const MUSIC_CACHE_DIR = path.join(__dirname, ".cache", "downloads");
const MUSIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MUSIC_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MIN_VALID_AUDIO_BYTES = 1024;
const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH
  ? path.resolve(process.cwd(), process.env.YTDLP_COOKIES_PATH)
  : "";

const CONTROL_HANDLERS = [
  previousControl,
  pauseControl,
  resumeControl,
  replayControl,
  nextControl,
  clearQueueControl,
  stopControl,
];

const BUTTON_IDS = {
  PREVIOUS: previousControl.id,
  PAUSE: pauseControl.id,
  RESUME: resumeControl.id,
  REPLAY: replayControl.id,
  NEXT: nextControl.id,
  CLEAR_QUEUE: clearQueueControl.id,
  STOP: stopControl.id,
};

const BUTTON_CONTROL_BY_ID = new Map(
  CONTROL_HANDLERS.map((control) => [control.id, control])
);

const guildMusicStates = new Map();
let ytDlpWrapInstance = null;
let ytDlpInitPromise = null;

function getGuildMusicState(client, guildId) {
  let state = guildMusicStates.get(guildId);
  if (state) {
    return state;
  }

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });

  state = {
    client,
    guildId,
    player,
    queue: [],
    history: [],
    current: null,
    connection: null,
    voiceChannelId: null,
    textChannelId: null,
    controlMessageId: null,
    idleGuard: false,
    ignoreNextIdle: false,
    currentTranscodeProcess: null,
  };

  player.on(VoiceAudioPlayerStatus.Idle, async () => {
    await handleIdleState(state);
  });

  player.on("error", async (error) => {
    console.error(`[MUSIC] Audio player error on guild ${guildId}`);
    console.error(error);
    await handleIdleState(state);
  });

  guildMusicStates.set(guildId, state);
  return state;
}

async function ensureYtDlpWrap() {
  if (ytDlpWrapInstance) {
    return ytDlpWrapInstance;
  }

  if (ytDlpInitPromise) {
    return ytDlpInitPromise;
  }

  ytDlpInitPromise = (async () => {
    const fromPath = new YTDlpWrap("yt-dlp");
    try {
      await fromPath.getVersion();
      ytDlpWrapInstance = fromPath;
      console.log("[MUSIC] yt-dlp found in PATH");
      return ytDlpWrapInstance;
    } catch {
      // ignored: fallback to local binary download
    }

    fs.mkdirSync(YTDLP_BIN_DIR, { recursive: true });
    if (!fs.existsSync(YTDLP_BIN_PATH)) {
      console.log("[MUSIC] Downloading yt-dlp binary...");
      await YTDlpWrap.downloadFromGithub(
        YTDLP_BIN_PATH,
        undefined,
        process.platform
      );
    }
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(YTDLP_BIN_PATH, 0o755);
      } catch {
        // ignored
      }
    }

    const local = new YTDlpWrap(YTDLP_BIN_PATH);
    await local.getVersion();
    ytDlpWrapInstance = local;
    console.log("[MUSIC] yt-dlp ready");
    return ytDlpWrapInstance;
  })();

  try {
    return await ytDlpInitPromise;
  } finally {
    ytDlpInitPromise = null;
  }
}

function cleanupCurrentAudioProcess(state) {
  if (!state.currentTranscodeProcess) {
    return;
  }

  try {
    state.currentTranscodeProcess.kill("SIGKILL");
  } catch {
    // ignored
  }
  state.currentTranscodeProcess = null;
}

function ensureMusicCacheDir() {
  fs.mkdirSync(MUSIC_CACHE_DIR, { recursive: true });
}

function clearAllMusicCache() {
  try {
    fs.rmSync(MUSIC_CACHE_DIR, { recursive: true, force: true });
  } catch {
    // ignored
  }
  ensureMusicCacheDir();
}

function getTrackCacheKey(track) {
  return createHash("sha1").update(String(track.url)).digest("hex").slice(0, 24);
}

function isUsableAudioFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size >= MIN_VALID_AUDIO_BYTES;
  } catch {
    return false;
  }
}

function isFileFresh(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return (
      stats.isFile() &&
      stats.size >= MIN_VALID_AUDIO_BYTES &&
      Date.now() - stats.mtimeMs <= MUSIC_CACHE_TTL_MS
    );
  } catch {
    return false;
  }
}

function findCachedFileByKey(cacheKey) {
  ensureMusicCacheDir();
  const prefix = `${cacheKey}.`;
  const entries = fs.readdirSync(MUSIC_CACHE_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.startsWith(prefix)) {
      return path.join(MUSIC_CACHE_DIR, entry.name);
    }
  }

  return null;
}

function removeCachedFilesByKey(cacheKey) {
  ensureMusicCacheDir();
  const prefix = `${cacheKey}.`;
  const entries = fs.readdirSync(MUSIC_CACHE_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) {
      continue;
    }

    try {
      fs.unlinkSync(path.join(MUSIC_CACHE_DIR, entry.name));
    } catch {
      // ignored
    }
  }
}

function cleanupExpiredDownloads() {
  ensureMusicCacheDir();
  const now = Date.now();
  const entries = fs.readdirSync(MUSIC_CACHE_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(MUSIC_CACHE_DIR, entry.name);
    try {
      const stats = fs.statSync(fullPath);
      const age = now - stats.mtimeMs;
      if (age > MUSIC_CACHE_TTL_MS) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // ignored
    }
  }
}

function scheduleCacheCleanup() {
  const timer = setInterval(() => {
    try {
      cleanupExpiredDownloads();
    } catch (error) {
      console.error("[MUSIC] Cache cleanup failed");
      console.error(error);
    }
  }, MUSIC_CACHE_CLEANUP_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

async function downloadTrackToCache(track) {
  ensureMusicCacheDir();

  if (track?.cachedFilePath && isFileFresh(track.cachedFilePath)) {
    return track.cachedFilePath;
  }

  const cacheKey = getTrackCacheKey(track);
  const existing = findCachedFileByKey(cacheKey);
  if (existing && isFileFresh(existing)) {
    track.cachedFilePath = existing;
    return existing;
  }

  if (existing) {
    removeCachedFilesByKey(cacheKey);
  }

  const ytDlp = await ensureYtDlpWrap();
  const outputTemplate = path.join(MUSIC_CACHE_DIR, `${cacheKey}.%(ext)s`);
  const cookieArgs =
    YTDLP_COOKIES_PATH && fs.existsSync(YTDLP_COOKIES_PATH)
      ? ["--cookies", YTDLP_COOKIES_PATH]
      : [];
  const baseArgs = [
    track.url,
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    "--no-progress",
    "--force-ipv4",
    "--geo-bypass",
    "--extractor-retries",
    "5",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--concurrent-fragments",
    "1",
    "--no-continue",
    "--no-part",
    "--newline",
    "--print",
    "after_move:filepath",
    "-o",
    outputTemplate,
    ...cookieArgs,
  ];

  const strategies = [
    [
      "--format",
      "bestaudio[acodec*=opus]/bestaudio[ext=m4a]/bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "opus",
      "--audio-quality",
      "0",
      "--extractor-args",
      "youtube:player_client=web,android",
    ],
    [
      "--format",
      "bestaudio[acodec*=opus]/bestaudio[ext=m4a]/bestaudio/best",
      "--extractor-args",
      "youtube:player_client=web,android",
    ],
    ["--format", "bestaudio/best", "--extractor-args", "youtube:player_client=web"],
  ];

  let lastError = null;

  for (const strategyArgs of strategies) {
    try {
      const rawOutput = await ytDlp.execPromise([...baseArgs, ...strategyArgs]);
      const printedPath = String(rawOutput)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .reverse()
        .find((line) => isUsableAudioFile(line));

      if (printedPath) {
        return printedPath;
      }

      const downloaded = findCachedFileByKey(cacheKey);
      if (downloaded && isUsableAudioFile(downloaded)) {
        return downloaded;
      }

      removeCachedFilesByKey(cacheKey);
      throw new Error("Aucun fichier audio valide téléchargé.");
    } catch (error) {
      lastError = error;
      removeCachedFilesByKey(cacheKey);
      console.warn(
        `[MUSIC] yt-dlp strategy failed for ${track.url}: ${error?.message || error}`
      );
    }
  }

  throw new Error(
    `Échec du téléchargement audio yt-dlp. ${lastError?.message || ""}`.trim()
  );
}

async function ensureTrackCached(track) {
  if (!track) {
    return null;
  }

  if (track.cachedFilePath && isFileFresh(track.cachedFilePath)) {
    return track.cachedFilePath;
  }

  if (track.cachePromise) {
    return track.cachePromise;
  }

  track.cachePromise = downloadTrackToCache(track)
    .then((cachedPath) => {
      track.cachedFilePath = cachedPath;
      return cachedPath;
    })
    .finally(() => {
      track.cachePromise = null;
    });

  return track.cachePromise;
}

function prefetchNextTrack(state) {
  const nextTrack = state.queue[0];
  if (!nextTrack) {
    return;
  }

  void ensureTrackCached(nextTrack).catch((error) => {
    console.warn(
      `[MUSIC] Prefetch ignoré pour ${nextTrack.url}: ${error?.message || error}`
    );
  });
}

async function buildYtDlpResource(track, state) {
  const cachedFilePath = await ensureTrackCached(track);
  track.cachedFilePath = cachedFilePath;

  const ffmpegArgs = [
    "-nostdin",
    "-i",
    cachedFilePath,
    "-vn",
    "-loglevel",
    "error",
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1",
  ];

  const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (!ffmpegProcess.stdout) {
    throw new Error("Impossible d'ouvrir le flux ffmpeg.");
  }

  state.currentTranscodeProcess = ffmpegProcess;
  ffmpegProcess.once("close", () => {
    if (state.currentTranscodeProcess === ffmpegProcess) {
      state.currentTranscodeProcess = null;
    }
  });

  ffmpegProcess.once("error", (error) => {
    console.error("[MUSIC] ffmpeg process error");
    console.error(error);
  });

  return createAudioResource(ffmpegProcess.stdout, {
    inputType: VoiceStreamType.Raw,
  });
}

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds) || 0;
  if (seconds <= 0) {
    return "live";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatTrackLine(track, index) {
  return `\`${index}.\` [${track.title}](${track.url}) - \`${formatDuration(track.durationInSec)}\``;
}

function buildNowPlayingText(state) {
  if (!state.current) {
    return "Aucune musique en cours.";
  }

  const track = state.current;
  return (
    `[${track.title}](${track.url})\n` +
    `Source: \`${track.source}\` | Durée: \`${formatDuration(track.durationInSec)}\` | Demandé par: <@${track.requestedById}>`
  );
}

function buildQueueText(state) {
  if (state.queue.length === 0) {
    return "Queue vide.";
  }

  const preview = state.queue.slice(0, 5);
  const lines = preview.map((track, idx) => formatTrackLine(track, idx + 1));
  const remaining = state.queue.length - preview.length;

  if (remaining > 0) {
    lines.push(`... et ${remaining} autres titres`);
  }

  return lines.join("\n");
}

function formatPlayerStatus(status) {
  const map = {
    [VoiceAudioPlayerStatus.Idle]: "idle",
    [VoiceAudioPlayerStatus.Buffering]: "buffering",
    [VoiceAudioPlayerStatus.Playing]: "lecture",
    [VoiceAudioPlayerStatus.Paused]: "pause",
    [VoiceAudioPlayerStatus.AutoPaused]: "pause-auto",
  };
  return map[status] || String(status || "inconnu");
}

function buildMusicEmbed(state, notice) {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("REVENGE MUSIC")
    .setDescription(buildNowPlayingText(state))
    .addFields(
      {
        name: "Queue",
        value: buildQueueText(state),
      },
      {
        name: "Historique",
        value: `${state.history.length} titre(s)`,
        inline: true,
      },
      {
        name: "État",
        value: `\`${formatPlayerStatus(state.player.state.status)}\``,
        inline: true,
      }
    );

  if (state.current?.thumbnailUrl) {
    embed.setThumbnail(state.current.thumbnailUrl);
  }

  if (notice) {
    embed.setAuthor({ name: notice });
  }

  return embed;
}

function buildMusicButtons(state) {
  const paused =
    state.player.state.status === VoiceAudioPlayerStatus.Paused ||
    state.player.state.status === VoiceAudioPlayerStatus.AutoPaused;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.PREVIOUS)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Précédente")
      .setDisabled(state.history.length === 0),
    new ButtonBuilder()
      .setCustomId(paused ? BUTTON_IDS.RESUME : BUTTON_IDS.PAUSE)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(paused ? "Reprise" : "Pause")
      .setDisabled(!state.current),
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.REPLAY)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Replay")
      .setDisabled(!state.current),
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.NEXT)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Suivante")
      .setDisabled(state.queue.length === 0)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.CLEAR_QUEUE)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Vider la queue")
      .setDisabled(state.queue.length === 0),
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.STOP)
      .setStyle(ButtonStyle.Danger)
      .setLabel("Déconnecter")
      .setDisabled(!state.current && state.queue.length === 0)
  );

  return [row1, row2];
}

function buildMusicPayload(state, notice) {
  return {
    embeds: [buildMusicEmbed(state, notice)],
    components: buildMusicButtons(state),
  };
}

async function fetchControlMessage(state) {
  if (!state.textChannelId || !state.controlMessageId) {
    return null;
  }

  const channel = await state.client.channels
    .fetch(state.textChannelId)
    .catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }

  const message = await channel.messages
    .fetch(state.controlMessageId)
    .catch(() => null);
  return message || null;
}

async function updateControlMessage(state, notice) {
  const message = await fetchControlMessage(state);
  if (!message) {
    return;
  }

  await message.edit(buildMusicPayload(state, notice)).catch((error) => {
    console.error("[MUSIC] Failed to update control message");
    console.error(error);
  });
}

async function ensureVoiceConnection(state, voiceChannel) {
  const currentConnection = state.connection;
  if (
    currentConnection &&
    state.voiceChannelId === voiceChannel.id &&
    currentConnection.state.status !== VoiceConnectionStatus.Destroyed
  ) {
    return;
  }

  if (currentConnection) {
    currentConnection.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      stopAndCleanup(state);
      await updateControlMessage(state, "Bot déconnecté du vocal.");
    }
  });

  connection.subscribe(state.player);

  state.connection = connection;
  state.voiceChannelId = voiceChannel.id;
}

async function playTrack(state, track, storeCurrentInHistory) {
  cleanupCurrentAudioProcess(state);
  const resource = await buildYtDlpResource(track, state);

  if (storeCurrentInHistory && state.current) {
    state.history.push(state.current);
  }

  state.current = track;
  state.player.play(resource);
  prefetchNextTrack(state);
}

async function playNextTrack(state) {
  if (state.queue.length === 0) {
    return false;
  }

  const nextTrack = state.queue.shift();
  try {
    await playTrack(state, nextTrack, Boolean(state.current));
    return true;
  } catch (error) {
    state.queue.unshift(nextTrack);
    throw error;
  }
}

async function playPreviousTrack(state) {
  if (state.history.length === 0) {
    return false;
  }

  const previousTrack = state.history[state.history.length - 1];
  const currentTrack = state.current || null;

  if (currentTrack) {
    state.queue.unshift(currentTrack);
  }

  try {
    await playTrack(state, previousTrack, false);
    state.history.pop();
    return true;
  } catch (error) {
    if (currentTrack && state.queue[0] === currentTrack) {
      state.queue.shift();
    }
    throw error;
  }
}

async function replayCurrentTrack(state) {
  if (!state.current) {
    return false;
  }

  await playTrack(state, state.current, false);
  return true;
}

function pauseTrack(state) {
  if (!state.current) {
    return false;
  }
  return state.player.pause();
}

function resumeTrack(state) {
  if (!state.current) {
    return false;
  }
  return state.player.unpause();
}

function clearQueue(state) {
  const count = state.queue.length;
  state.queue = [];
  return count;
}

function stopAndCleanup(state) {
  cleanupCurrentAudioProcess(state);
  state.queue = [];
  state.history = [];
  state.current = null;
  state.ignoreNextIdle = true;
  state.player.stop(true);

  if (state.connection) {
    state.connection.destroy();
  }
  state.connection = null;
  state.voiceChannelId = null;
}

async function handleIdleState(state) {
  if (state.ignoreNextIdle) {
    state.ignoreNextIdle = false;
    return;
  }

  if (state.idleGuard) {
    return;
  }
  state.idleGuard = true;

  try {
    if (state.current) {
      state.history.push(state.current);
      state.current = null;
    }

    if (state.queue.length > 0) {
      const hasNext = await playNextTrack(state);
      if (hasNext) {
        await updateControlMessage(state, "Lecture suivante...");
        return;
      }
    }

    await updateControlMessage(state, "Queue terminée.");
  } catch (error) {
    console.error(`[MUSIC] Idle handler failed on guild ${state.guildId}`);
    console.error(error);
  } finally {
    state.idleGuard = false;
  }
}

function looksLikeYouTubeMixOrPlaylist(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("youtube.com")) {
      return false;
    }
    return parsed.searchParams.has("list");
  } catch {
    return false;
  }
}

function createTrackObject({
  title,
  url,
  durationInSec,
  thumbnailUrl,
  source,
  requestedById,
}) {
  return {
    title: title || "Titre inconnu",
    url,
    durationInSec: Number(durationInSec) || 0,
    thumbnailUrl: thumbnailUrl || null,
    source,
    requestedById,
  };
}

function parseYouTubeThumbnail(video) {
  if (Array.isArray(video?.thumbnails) && video.thumbnails.length > 0) {
    return video.thumbnails[video.thumbnails.length - 1].url || null;
  }
  if (video?.thumbnail?.url) {
    return video.thumbnail.url;
  }
  return null;
}

function convertYouTubeVideoToTrack(video, requestedById, sourceLabel) {
  if (!video?.url) {
    return null;
  }

  return createTrackObject({
    title: video.title,
    url: video.url,
    durationInSec: video.durationInSec,
    thumbnailUrl: parseYouTubeThumbnail(video),
    source: sourceLabel,
    requestedById,
  });
}

async function resolveYouTubeTracks(input, requestedById) {
  const isPlaylistLike =
    play.yt_validate(input) === "playlist" || looksLikeYouTubeMixOrPlaylist(input);

  if (isPlaylistLike) {
    try {
      const playlist = await play.playlist_info(input, { incomplete: true });
      const allVideos = await playlist.all_videos();
      const selected = allVideos
        .filter((video) => video?.url && !video?.live)
        .slice(0, MAX_YOUTUBE_PLAYLIST_TRACKS);

      const tracks = selected
        .map((video) => convertYouTubeVideoToTrack(video, requestedById, "youtube"))
        .filter(Boolean);

      if (tracks.length > 0) {
        return {
          tracks,
          notice:
            allVideos.length > MAX_YOUTUBE_PLAYLIST_TRACKS
              ? `Playlist ajoutée (limite ${MAX_YOUTUBE_PLAYLIST_TRACKS} titres).`
              : "Playlist ajoutée.",
        };
      }
    } catch (error) {
      console.warn("[MUSIC] Playlist/mix resolution failed, fallback to single video.");
      console.warn(error?.message || error);
    }
  }

  if (play.yt_validate(input) === "video") {
    const info = await play.video_info(input);
    const track = convertYouTubeVideoToTrack(
      info.video_details,
      requestedById,
      "youtube"
    );
    if (!track) {
      throw new Error("Impossible de lire cette vidéo YouTube.");
    }
    return {
      tracks: [track],
      notice: "Titre YouTube ajouté.",
    };
  }

  const searchResults = await play.search(input, {
    limit: 1,
    source: { youtube: "video" },
  });

  const first = searchResults?.[0];
  if (!first) {
    throw new Error("Aucun résultat YouTube trouvé.");
  }

  const track = convertYouTubeVideoToTrack(first, requestedById, "youtube");
  if (!track) {
    throw new Error("Résultat YouTube invalide.");
  }

  return {
    tracks: [track],
    notice: "Résultat YouTube ajouté.",
  };
}

async function resolveInputToTracks(input, requestedById) {
  const trimmed = normalizeInput(input);
  const validated = await play.validate(trimmed).catch(() => false);

  if (
    validated === "sp_track" ||
    validated === "sp_playlist" ||
    validated === "sp_album"
  ) {
    throw new Error("Les liens Spotify ne sont plus supportés.");
  }

  return resolveYouTubeTracks(trimmed, requestedById);
}

function normalizeInput(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }

  let value = raw;
  let changed = true;
  while (changed && value.length > 1) {
    changed = false;
    const wrappers = [
      ["<", ">"],
      ['"', '"'],
      ["'", "'"],
      ["`", "`"],
    ];
    for (const [start, end] of wrappers) {
      if (value.startsWith(start) && value.endsWith(end) && value.length > 1) {
        value = value.slice(1, -1).trim();
        changed = true;
      }
    }
  }

  return value;
}

function buildSafeMusicErrorMessage(error) {
  const raw = String(error?.message || error || "erreur inconnue");
  const firstLine = raw.split(/\r?\n/)[0].trim() || "erreur inconnue";
  const compact = firstLine.replace(/\s+/g, " ");
  const shortened =
    compact.length > 350 ? `${compact.slice(0, 347)}...` : compact;
  return `Erreur music: ${shortened}`;
}

function hasVoicePermissionsForBot(interaction, voiceChannel) {
  const botMember = interaction.guild?.members?.me;
  if (!botMember) {
    return false;
  }
  const perms = voiceChannel.permissionsFor(botMember);
  return Boolean(
    perms?.has(PermissionFlagsBits.Connect) &&
      perms?.has(PermissionFlagsBits.Speak)
  );
}

function canControlMusic(interaction, state) {
  const member = interaction.member;
  if (!member || !member.voice?.channelId) {
    return "Rejoins un salon vocal pour contrôler la musique.";
  }

  if (state.voiceChannelId && member.voice.channelId !== state.voiceChannelId) {
    return "Tu dois être dans le même salon vocal que le bot.";
  }

  return null;
}

async function replyMusicEphemeral(interaction, content) {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePlayCommand(interaction) {
  const linkInput = interaction.options.getString("lien", false);
  const searchInput = interaction.options.getString("recherche", false);
  const input = normalizeInput(linkInput || searchInput || "");
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  if (!input) {
    await replyMusicEphemeral(
      interaction,
      "Indique un lien ou une recherche. Exemple: /play recherche: damso macarena"
    );
    return;
  }

  if (!voiceChannel) {
    await replyMusicEphemeral(interaction, "Rejoins un salon vocal avant d'utiliser /play.");
    return;
  }

  if (
    voiceChannel.type !== ChannelType.GuildVoice &&
    voiceChannel.type !== ChannelType.GuildStageVoice
  ) {
    await replyMusicEphemeral(interaction, "Salon vocal invalide.");
    return;
  }

  if (!hasVoicePermissionsForBot(interaction, voiceChannel)) {
    await replyMusicEphemeral(
      interaction,
      "Le bot doit avoir Connect + Speak dans ce salon vocal."
    );
    return;
  }

  await interaction.deferReply();

  const state = getGuildMusicState(interaction.client, interaction.guildId);
  const controlError = canControlMusic(interaction, state);
  if (controlError) {
    await interaction.editReply({ content: controlError });
    return;
  }

  try {
    await ensureVoiceConnection(state, voiceChannel);

    const resolved = await resolveInputToTracks(input, member.id);
    state.queue.push(...resolved.tracks);
    prefetchNextTrack(state);

    state.textChannelId = interaction.channelId;

    if (!state.current) {
      await playNextTrack(state);
    }

    const payload = buildMusicPayload(state, resolved.notice);
    const controlMessage = await interaction.editReply(payload);
    state.controlMessageId = controlMessage.id;
    state.textChannelId = controlMessage.channelId;
  } catch (error) {
    await interaction.editReply({
      content:
        error?.message === "Not a YouTube domain"
          ? "Lien invalide. Utilise une URL YouTube complète, par ex : https://www.youtube.com/watch?v=..."
          : buildSafeMusicErrorMessage(error),
    });
  }
}

async function handleMusicButton(interaction) {
  const state = guildMusicStates.get(interaction.guildId);
  if (!state) {
    await replyMusicEphemeral(interaction, "Aucune session musique active.");
    return;
  }

  if (interaction.message.id !== state.controlMessageId) {
    await replyMusicEphemeral(interaction, "Ce panneau de contrôle n'est plus actif.");
    return;
  }

  const controlError = canControlMusic(interaction, state);
  if (controlError) {
    await replyMusicEphemeral(interaction, controlError);
    return;
  }

  await interaction.deferUpdate();

  let notice = null;
  const control = BUTTON_CONTROL_BY_ID.get(interaction.customId);
  if (!control) {
    return;
  }

  try {
    notice = await control.execute({
      state,
      actions: {
        playPreviousTrack,
        pauseTrack,
        resumeTrack,
        replayCurrentTrack,
        playNextTrack,
        clearQueue,
        stopAndCleanup,
      },
    });

    await interaction.message.edit(buildMusicPayload(state, notice));
  } catch (error) {
    console.error("[MUSIC] Button action failed");
    console.error(error);
    await updateControlMessage(state, "Erreur lors du contrôle.");
  }
}

async function registerMusicCommand(client) {
  const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Joue une musique à partir d'un lien ou d'une recherche")
    .addStringOption((option) =>
      option
        .setName("lien")
        .setDescription("Lien YouTube (vidéo, playlist, mix)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("recherche")
        .setDescription("Recherche YouTube (si pas de lien)")
        .setRequired(false)
    );

  await upsertGuildCommand({
    client,
    commandName: COMMAND_NAME,
    commandJson: command.toJSON(),
    logPrefix: "MUSIC",
    missingGuildLog: "DISCORD_GUILD_ID absent, /play non enregistré.",
  });

  await deleteGuildCommand({
    client,
    commandName: LEGACY_COMMAND_NAME,
    logPrefix: "MUSIC",
  });
}

function handleBotVoiceStateUpdate(oldState, newState, client) {
  const botId = client.user?.id;
  if (!botId) {
    return;
  }

  if (oldState.id !== botId) {
    return;
  }

  if (oldState.channelId && !newState.channelId) {
    const state = guildMusicStates.get(oldState.guild.id);
    if (!state) {
      return;
    }
    stopAndCleanup(state);
  }
}

module.exports = {
  name: "feature:music-system",
  async init(client) {
    clearAllMusicCache();
    scheduleCacheCleanup();

    client.once("clientReady", async () => {
      await registerMusicCommand(client);
    });

    client.on("interactionCreate", async (interaction) => {
      if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
        await handlePlayCommand(interaction);
        return;
      }

      if (
        interaction.isButton() &&
        BUTTON_CONTROL_BY_ID.has(interaction.customId)
      ) {
        await handleMusicButton(interaction);
      }
    });

    client.on("voiceStateUpdate", (oldState, newState) => {
      handleBotVoiceStateUpdate(oldState, newState, client);
    });
  },
};
