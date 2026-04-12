import { TerminalRenderer } from '../dist/ui/terminalRenderer.js'

// Minimal fake readline interface for TerminalRenderer.
const rl = {
  setPrompt() {},
  prompt() {},
}

const renderer = new TerminalRenderer(rl, () => '[apex] ❯ ')

// Exercise state machine + buffering semantics:
// - Enter Thinking, buffer 2 background logs
// - Enter OverlayMenu, buffer 1 background log
// - Return IdleTyping => flush should happen
renderer.setState('Thinking')
renderer.logBackground('system', '[Status] Provider: Gemini | Model: ✨ AUTO (Smart routing)')
renderer.logBackground('warn', '[Apex] Warning: simulated background warning while thinking')
renderer.setState('OverlayMenu')
renderer.logBackground('info', '[Menu] simulated background info while overlay active')
renderer.setState('IdleTyping')

// Then simulate printing a foreground answer (should not buffer).
renderer.setState('Printing')
renderer.printForeground('Hello from renderer harness.')
renderer.setState('IdleTyping')

