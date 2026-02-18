module.exports = {
  name: "music-control:replay",
  id: "rmusic_replay",
  async execute({ state, actions }) {
    const ok = await actions.replayCurrentTrack(state);
    return ok ? "Lecture rejouée." : "Aucune piste à rejouer.";
  },
};
