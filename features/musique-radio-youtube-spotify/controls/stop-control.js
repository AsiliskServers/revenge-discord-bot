module.exports = {
  name: "music-control:stop",
  id: "rmusic_stop",
  async init() {},
  async execute({ state, actions }) {
    actions.stopAndCleanup(state);
    return "Bot déconnecté et queue supprimée.";
  },
};
