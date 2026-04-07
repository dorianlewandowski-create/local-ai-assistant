import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from './logger';

class WebController {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init(): Promise<Page> {
    if (this.page) return this.page;

    logger.system('Launching headless browser...');
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
    return this.page;
  }

  async getPage(): Promise<Page> {
    return this.init();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.system('Browser closed.');
    }
  }

  async takeScreenshot(path: string): Promise<void> {
    const page = await this.getPage();
    await page.screenshot({ path });
  }
}

export const webController = new WebController();
