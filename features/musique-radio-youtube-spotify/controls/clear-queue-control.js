module.exports = {
  name: "music-control:clear-queue",
  id: "rmusic_clear_queue",
  async execute({ state, actions }) {
    const removed = actions.clearQueue(state);
    return `Queue vidée (${removed} titre(s) supprimé(s)).`;
  },
};
