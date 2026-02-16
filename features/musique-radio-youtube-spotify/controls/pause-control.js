module.exports = {
  name: "music-control:pause",
  id: "rmusic_pause",
  async init() {},
  async execute({ state, actions }) {
    const ok = actions.pauseTrack(state);
    return ok ? "Lecture en pause." : "Impossible de mettre en pause.";
  },
};
