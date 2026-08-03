// Phase 8 listener placeholder.
//
// Listener support is intentionally separated from scheduler execution. The database schema now
// supports FILE_DROP, DB_POLL, and WEBHOOK listener definitions, but runtime listener execution
// should be implemented after scheduler execution is proven stable.

function startListenerPoller() {
  console.log('[SkyCommand Worker] Listener poller is not enabled in Phase 8.2.');

  return {
    stop() {},
  };
}

module.exports = {
  startListenerPoller,
};
