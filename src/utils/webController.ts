import type { Browser, LaunchOptions, Page } from 'puppeteer'
import { logger } from './logger'

type PuppeteerRoot = { launch: (options?: LaunchOptions) => Promise<Browser> }

async function loadPuppeteer(): Promise<PuppeteerRoot> {
  try {
    const mod = await import('puppeteer')
    const root = (mod as { default?: PuppeteerRoot }).default ?? (mod as unknown as PuppeteerRoot)
    return root
  } catch {
    throw new Error(
      '[Apex] Optional dependency `puppeteer` is required for web automation (e.g. deep web tools). Install: pnpm add puppeteer',
    )
  }
}

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

export interface WebControllerOptions {
  /**
   * Automatically close the browser after being idle for this long.
   * Keeps background CPU/memory footprint low for daemon mode.
   *
   * @defaultValue 120_000 (2 minutes)
   */
  idleCloseMs?: number
}

class WebController {
  private browser: Browser | null = null
  private page: Page | null = null
  private readonly initMutex = new AsyncMutex()
  private readonly useMutex = new AsyncMutex()
  private idleTimer: NodeJS.Timeout | null = null
  private readonly idleCloseMs: number

  constructor(options: WebControllerOptions = {}) {
    this.idleCloseMs = Math.max(1, options.idleCloseMs ?? 120_000)
  }

  private bumpIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }
    this.idleTimer = setTimeout(() => {
      void this.close().catch(() => undefined)
    }, this.idleCloseMs)
  }

  private async initLocked(): Promise<Page> {
    if (this.page) {
      this.bumpIdleTimer()
      return this.page
    }

    logger.system('Launching headless browser...')
    const puppeteer = await loadPuppeteer()
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    this.page = await this.browser.newPage()
    await this.page.setViewport({ width: 1280, height: 800 })
    this.bumpIdleTimer()
    return this.page
  }

  /**
   * Ensure a browser + a single page exist, and return the page.
   *
   * Prefer `run(...)` to avoid concurrent access to the same page.
   */
  async init(): Promise<Page> {
    return this.initMutex.runExclusive(() => this.initLocked())
  }

  /**
   * Return the shared Puppeteer page.
   *
   * Prefer {@link run} for safe, serialized access.
   */
  async getPage(): Promise<Page> {
    return this.init()
  }

  /**
   * Run a unit of work against the shared Puppeteer page with backpressure.
   *
   * This prevents concurrent callers from interleaving navigation/click/type on the same page.
   * It also keeps the process "green" by auto-closing the browser after idle.
   */
  async run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return this.useMutex.runExclusive(async () => {
      const page = await this.init()
      try {
        const result = await fn(page)
        this.bumpIdleTimer()
        return result
      } catch (error) {
        // If the page/browser crashed, reset and let callers retry cleanly.
        const message = error instanceof Error ? error.message : String(error)
        if (/Target closed|Session closed|Browser has disconnected|Protocol error/i.test(message)) {
          await this.close().catch(() => undefined)
        }
        throw error
      }
    })
  }

  /**
   * Close the browser (if running) and release resources immediately.
   */
  async close(): Promise<void> {
    if (this.browser) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer)
        this.idleTimer = null
      }
      await this.browser.close()
      this.browser = null
      this.page = null
      logger.system('Browser closed.')
    }
  }

  /**
   * Take a screenshot of the current page.
   *
   * Uses {@link run} to avoid concurrent operations on the shared page.
   */
  async takeScreenshot(path: string): Promise<void> {
    await this.run(async (page) => {
      await page.screenshot({ path })
    })
  }
}

export const webController = new WebController()
