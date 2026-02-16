module.exports = {
  name: "music-control:clear-queue",
  id: "rmusic_clear_queue",
  async init() {},
  async execute({ state, actions }) {
    const removed = actions.clearQueue(state);
    return `Queue videe (${removed} titre(s) supprimes).`;
  },
};
