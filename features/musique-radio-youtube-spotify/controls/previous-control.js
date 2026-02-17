module.exports = {
  name: "music-control:previous",
  id: "rmusic_previous",
  async init() {},
  async execute({ state, actions }) {
    const ok = await actions.playPreviousTrack(state);
    return ok ? "Piste précédente." : "Historique vide.";
  },
};
