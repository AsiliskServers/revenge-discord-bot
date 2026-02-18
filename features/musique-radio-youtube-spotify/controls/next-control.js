module.exports = {
  name: "music-control:next",
  id: "rmusic_next",
  async execute({ state, actions }) {
    const ok = await actions.playNextTrack(state);
    return ok ? "Piste suivante." : "Queue vide.";
  },
};
