module.exports = {
  name: "music-control:replay",
  id: "rmusic_replay",
  async init() {},
  async execute({ state, actions }) {
    const ok = await actions.replayCurrentTrack(state);
    return ok ? "Lecture rejouee." : "Aucune piste a rejouer.";
  },
};
