/**
 * Minimal local console interface used by the runtime host.
 *
 * The legacy neo-blessed TUI previously implemented a richer console UX, but
 * the runtime only needs this narrow contract.
 */
export interface LocalConsoleRuntime {
  runPrompt(prompt: string): Promise<string | null>
}
