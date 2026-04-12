export function attachProcessLifecycle(shutdown: () => Promise<void>) {
  const onExit = () => {
    void shutdown()
  }

  process.on('SIGINT', onExit)
  process.on('SIGTERM', onExit)

  return {
    detach() {
      process.off('SIGINT', onExit)
      process.off('SIGTERM', onExit)
    },
  }
}
