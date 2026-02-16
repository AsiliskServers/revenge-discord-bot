module.exports = {
  name: "music-control:resume",
  id: "rmusic_resume",
  async init() {},
  async execute({ state, actions }) {
    const ok = actions.resumeTrack(state);
    return ok ? "Lecture reprise." : "Impossible de reprendre.";
  },
};
