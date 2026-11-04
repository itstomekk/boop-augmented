// CPU search uses the same rules and evaluation as local play.
importScripts('logic.js');
self.onmessage = (event) => {
  const { id, state } = event.data;
  try {
    self.postMessage({ id, move: self.BoopLogic.bestMove(state) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
