/**
 * Ambient typings for optional `puppeteer` (not a default dependency; see `build.mjs` externals).
 * Lets `tsc` succeed without installing the package; runtime loads via dynamic `import()` in `webController`.
 */
declare module 'puppeteer' {
  export interface LaunchOptions {
    headless?: boolean | 'shell' | 'new'
    args?: string[]
  }

  export interface Viewport {
    width: number
    height: number
  }

  export interface Page {
    goto(url: string, options?: { waitUntil?: string } & Record<string, unknown>): Promise<unknown>
    title(): Promise<string>
    screenshot(options: { path: string }): Promise<Buffer | string | void>
    click(selector: string, options?: Record<string, unknown>): Promise<void>
    waitForNetworkIdle(options?: { timeout?: number }): Promise<void>
    type(selector: string, text: string, options?: { delay?: number }): Promise<void>
    evaluate<TReturn>(pageFunction: () => TReturn | Promise<TReturn>): Promise<TReturn>
    setViewport(viewport: Viewport): Promise<void>
  }

  export interface Browser {
    newPage(): Promise<Page>
    close(): Promise<void>
  }

  interface PuppeteerRoot {
    launch(options?: LaunchOptions): Promise<Browser>
  }

  const puppeteer: PuppeteerRoot
  export default puppeteer
}
