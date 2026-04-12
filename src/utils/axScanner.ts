import { execFile } from 'child_process'
import { promisify } from 'util'
import { recordEnergyImpact } from './energyImpact'

const execFileAsync = promisify(execFile)

const ACCESSIBILITY_PERMISSION_HINT =
  'Accessibility permissions may be missing. Please grant Accessibility access to Apex in System Settings > Privacy & Security > Accessibility and restart the daemon.'

class AsyncMutex {
  private last: Promise<void> = Promise.resolve()

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.last
    let release!: () => void
    this.last = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

export interface AxFrame {
  x: number
  y: number
  w: number
  h: number
}

export interface AxUiNode {
  /**
   * Simplified element type (e.g. "button", "textField", "window", "group").
   */
  type: string
  /**
   * Best-effort human label (from name/description/value).
   */
  label?: string
  /**
   * Raw Accessibility role/subrole (e.g. "AXButton").
   */
  role?: string
  subrole?: string
  /**
   * Screen-space frame, when available.
   */
  frame?: AxFrame
  /**
   * Child nodes in the accessibility hierarchy.
   */
  children?: AxUiNode[]
}

export interface AxUiTreeResult {
  /**
   * Name of the frontmost application as reported by System Events.
   */
  appName: string
  /**
   * Unix epoch milliseconds when the snapshot was taken.
   */
  capturedAtMs: number
  /**
   * Root of the scanned UI tree.
   */
  root: AxUiNode
  /**
   * Limits used for this scan (helpful for debugging/truncation).
   */
  limits: {
    maxDepth: number
    maxNodes: number
  }
}

export interface AxScanOptions {
  /**
   * Maximum depth to traverse. Lower values reduce CPU overhead.
   *
   * @defaultValue 10
   */
  maxDepth?: number
  /**
   * Maximum number of nodes to emit across the whole tree.
   *
   * @defaultValue 1200
   */
  maxNodes?: number
  /**
   * Minimum time between scans. If hit, returns the most recent cached tree.
   * Set to 0 to disable caching/rate limiting.
   *
   * @defaultValue 500
   */
  minIntervalMs?: number
  /**
   * Optional AbortSignal to cancel the `osascript` process.
   */
  signal?: AbortSignal
}

const scanMutex = new AsyncMutex()
let lastResult: AxUiTreeResult | null = null
let lastTreeState: AxUiTreeResult | null = null

export class AxScanError extends Error {
  readonly systemHint?: string

  constructor(message: string, options: { systemHint?: string } = {}) {
    super(message)
    this.name = 'AxScanError'
    this.systemHint = options.systemHint
  }
}

function looksLikeNotAuthorized(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('not authorized') ||
    normalized.includes('not permitted') ||
    normalized.includes('operation not permitted') ||
    normalized.includes('accessibility') ||
    normalized.includes('system events got an error') ||
    normalized.includes('not allowed to send apple events') ||
    normalized.includes('automation')
  )
}

function isEffectivelyEmptyTree(tree: AxUiTreeResult): boolean {
  const children = tree.root?.children ?? []
  return tree.appName !== 'Unknown' && Array.isArray(children) && children.length === 0
}

type FrameLike = AxFrame & { x: number; y: number; w: number; h: number }

function isFrame(value: unknown): value is FrameLike {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.x === 'number' &&
    typeof record.y === 'number' &&
    typeof record.w === 'number' &&
    typeof record.h === 'number'
  )
}

function nodeKey(node: AxUiNode): string {
  // Best-effort stable key across scans (JXA has no persistent ids).
  const role = node.role ?? ''
  const subrole = node.subrole ?? ''
  const type = node.type ?? ''
  const label = (node.label ?? '').trim().toLowerCase()
  return `${type}|${role}|${subrole}|${label}`
}

function flattenFramedNodes(root: AxUiNode): Array<{ key: string; node: AxUiNode; frame: AxFrame }> {
  const out: Array<{ key: string; node: AxUiNode; frame: AxFrame }> = []
  const stack: AxUiNode[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const children = Array.isArray(current.children) ? current.children : []
    for (let i = 0; i < children.length; i++) {
      stack.push(children[i])
    }
    if (isFrame(current.frame)) {
      out.push({ key: nodeKey(current), node: current, frame: current.frame })
    }
  }
  return out
}

function frameMoved(a: AxFrame, b: AxFrame): boolean {
  return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h
}

function buildDeltaTree(
  appName: string,
  baselineCapturedAtMs: number,
  changedNodes: AxUiNode[],
  limits: AxUiTreeResult['limits'],
): AxUiTreeResult & { delta: any } {
  return {
    appName,
    capturedAtMs: Date.now(),
    root: {
      type: 'delta',
      label: `Delta since ${new Date(baselineCapturedAtMs).toISOString()}`,
      role: 'AXDelta',
      children: changedNodes,
    },
    limits,
    delta: {
      mode: 'delta',
      baselineCapturedAtMs,
      changedCount: changedNodes.length,
    },
  } as any
}

function maybeApplyDelta(next: AxUiTreeResult): AxUiTreeResult {
  if (!lastTreeState || lastTreeState.appName !== next.appName) {
    lastTreeState = next
    return next
  }

  const before = flattenFramedNodes(lastTreeState.root)
  const after = flattenFramedNodes(next.root)
  if (after.length === 0) {
    lastTreeState = next
    return next
  }

  const beforeByKey = new Map<string, AxFrame>()
  for (const item of before) {
    // keep the last occurrence for "z-order-ish" stability
    beforeByKey.set(item.key, item.frame)
  }

  let comparable = 0
  let moved = 0
  const changed: AxUiNode[] = []
  for (const item of after) {
    const previous = beforeByKey.get(item.key)
    if (previous) {
      comparable += 1
      if (frameMoved(previous, item.frame)) {
        moved += 1
        changed.push(item.node)
      }
    } else {
      // New node (consider changed)
      comparable += 1
      moved += 1
      changed.push(item.node)
    }
  }

  const movedRatio = comparable > 0 ? moved / comparable : 1
  // If only <= 5% moved, emit delta-only.
  if (movedRatio <= 0.05 && changed.length > 0) {
    const fullBytes = Buffer.byteLength(JSON.stringify(next), 'utf8')
    const deltaTree = buildDeltaTree(next.appName, lastTreeState.capturedAtMs, changed, next.limits)
    const deltaBytes = Buffer.byteLength(JSON.stringify(deltaTree), 'utf8')
    const saved = Math.max(0, fullBytes - deltaBytes)
    recordEnergyImpact('bytes_saved_by_delta', saved)

    // Advance baseline so repeated deltas remain meaningful.
    lastTreeState = next
    return deltaTree
  }

  lastTreeState = next
  return next
}

function buildJxaScript(maxDepth: number, maxNodes: number): string {
  // JXA script: query frontmost process and traverse UI elements with hard limits.
  // Output: JSON string to stdout.
  return `
ObjC.import('stdlib');

function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

function normalizeRole(role) {
  if (!role) return '';
  return String(role);
}

function simplifyType(role) {
  var r = normalizeRole(role);
  if (!r) return 'unknown';
  if (r.indexOf('AX') === 0) r = r.slice(2);
  r = r.replace(/\\s+/g, '');
  r = r.charAt(0).toLowerCase() + r.slice(1);
  // common normalizations
  if (r === 'textField' || r === 'textArea') return 'textField';
  if (r === 'staticText') return 'text';
  if (r === 'popUpButton') return 'menu';
  return r;
}

function bestLabel(el) {
  var name = safe(function() { return el.name(); }, '');
  var desc = safe(function() { return el.description(); }, '');
  var val = safe(function() { return el.value(); }, '');
  var parts = [name, desc, val].map(function(x){ return (x === null || x === undefined) ? '' : String(x).trim(); }).filter(function(x){ return x.length > 0; });
  if (parts.length === 0) return '';
  // prefer shorter, more "name-like" strings
  parts.sort(function(a,b){ return a.length - b.length; });
  return parts[0].slice(0, 200);
}

function frameFor(el) {
  var pos = safe(function() { return el.position(); }, null);
  var size = safe(function() { return el.size(); }, null);
  if (!pos || !size) return null;
  return { x: Number(pos[0]) || 0, y: Number(pos[1]) || 0, w: Number(size[0]) || 0, h: Number(size[1]) || 0 };
}

function childrenFor(el) {
  // Some elements expose UI elements via uiElements(); others via entireContents().
  var kids = safe(function() { return el.uiElements(); }, null);
  if (kids && kids.length !== undefined) return kids;
  kids = safe(function() { return el.entireContents(); }, null);
  if (kids && kids.length !== undefined) return kids;
  return [];
}

var maxDepth = ${Math.max(1, maxDepth)};
var maxNodes = ${Math.max(1, maxNodes)};
var emitted = 0;

var se = Application('System Events');
var procs = se.processes.whose({ frontmost: true });
if (!procs || procs.length === 0) {
  var empty = { appName: 'Unknown', capturedAtMs: Date.now(), root: { type: 'application', label: 'Unknown', children: [] }, limits: { maxDepth: maxDepth, maxNodes: maxNodes } };
  console.log(JSON.stringify(empty));
  $.exit(0);
}

var proc = procs[0];
var appName = safe(function() { return proc.name(); }, 'Unknown');

// Root: application -> windows
var rootEl = { type: 'application', label: String(appName), role: 'AXApplication', children: [] };

var stack = [];
function pushChildren(parentObj, elements, depth) {
  if (!elements) return;
  for (var i = 0; i < elements.length; i++) {
    stack.push({ el: elements[i], parent: parentObj, depth: depth });
  }
}

var windows = safe(function() { return proc.windows(); }, []);
pushChildren(rootEl, windows, 1);

while (stack.length > 0 && emitted < maxNodes) {
  var item = stack.pop();
  var el = item.el;
  var depth = item.depth;
  if (depth > maxDepth) continue;

  var role = safe(function() { return el.role(); }, '');
  var subrole = safe(function() { return el.subrole(); }, '');
  var label = bestLabel(el);
  var frame = frameFor(el);

  var node = { type: simplifyType(role), role: role, subrole: subrole };
  if (label) node.label = label;
  if (frame) node.frame = frame;
  node.children = [];

  if (!item.parent.children) item.parent.children = [];
  item.parent.children.push(node);
  emitted++;

  // Traverse
  var kids = childrenFor(el);
  if (kids && kids.length && depth < maxDepth && emitted < maxNodes) {
    pushChildren(node, kids, depth + 1);
  }
}

var result = {
  appName: String(appName),
  capturedAtMs: Date.now(),
  root: rootEl,
  limits: { maxDepth: maxDepth, maxNodes: maxNodes }
};
console.log(JSON.stringify(result));
  `.trim()
}

/**
 * Scan the Accessibility (AX) tree of the frontmost application via JXA (`osascript -l JavaScript`).
 *
 * This avoids screenshots and typically has a much lower energy footprint than vision models.
 *
 * Requires macOS Accessibility permission for the running process (Terminal/LaunchAgent `node`).
 *
 * @returns A simplified JSON-friendly tree of UI elements.
 */
export async function scanFrontmostUiTree(options: AxScanOptions = {}): Promise<AxUiTreeResult> {
  const maxDepth = Math.max(1, options.maxDepth ?? 10)
  const maxNodes = Math.max(1, options.maxNodes ?? 1200)
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 500)

  return scanMutex.runExclusive(async () => {
    const now = Date.now()
    if (minIntervalMs > 0 && lastResult && now - lastResult.capturedAtMs < minIntervalMs) {
      return lastResult
    }

    const script = buildJxaScript(maxDepth, maxNodes)
    let stdout: string | Buffer = ''
    try {
      ;({ stdout } = (await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], {
        windowsHide: true,
        signal: options.signal as any,
        maxBuffer: 8 * 1024 * 1024,
      })) as unknown as { stdout: string | Buffer })
    } catch (error: any) {
      const stderr =
        typeof error?.stderr === 'string' || Buffer.isBuffer(error?.stderr) ? String(error.stderr) : ''
      const message = [error?.message, stderr].filter(Boolean).join('\n')
      if (looksLikeNotAuthorized(message)) {
        throw new AxScanError(`AX scan failed: ${message}`.trim(), {
          systemHint: ACCESSIBILITY_PERMISSION_HINT,
        })
      }
      throw new AxScanError(`AX scan failed: ${message || 'Unknown error'}`.trim())
    }

    const parsed = JSON.parse(String(stdout).trim()) as AxUiTreeResult
    if (isEffectivelyEmptyTree(parsed)) {
      throw new AxScanError('AX scan returned an empty UI tree for the frontmost application.', {
        systemHint: ACCESSIBILITY_PERMISSION_HINT,
      })
    }

    recordEnergyImpact('ax_ui_tree')
    const maybeDelta = maybeApplyDelta(parsed)
    lastResult = maybeDelta
    return maybeDelta
  })
}
