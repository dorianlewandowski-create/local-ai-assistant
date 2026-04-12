import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import { webController } from '../utils/webController'
import path from 'path'
import fs from 'fs/promises'

const WebBrowseParams = z.object({
  url: z.string().url().describe('The URL to navigate to.'),
})

export const webBrowse: Tool<typeof WebBrowseParams> = {
  name: 'web_browse',
  description:
    'Navigate to a URL and capture a screenshot/content summary. Use this for deep web interaction.',
  parameters: WebBrowseParams,
  execute: async ({ url }) => {
    try {
      const screenshotPath = path.join(process.cwd(), 'data', 'web_snapshot.png')
      const { title } = await webController.run(async (page) => {
        await page.goto(url, { waitUntil: 'networkidle2' })
        const title = await page.title()
        await page.screenshot({ path: screenshotPath })
        return { title }
      })

      return {
        success: true,
        result: `Navigated to ${url}. Page title: "${title}". Snapshot captured for vision analysis.`,
        metadata: { title, url, screenshotPath },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const WebClickParams = z.object({
  selector: z.string().describe('CSS selector of the element to click.'),
})

export const webClick: Tool<typeof WebClickParams> = {
  name: 'web_click',
  description: 'Click an element on the current web page using a CSS selector.',
  parameters: WebClickParams,
  execute: async ({ selector }) => {
    try {
      await webController.run(async (page) => {
        await page.click(selector)
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {})
      })
      return { success: true, result: `Clicked element: ${selector}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const WebTypeParams = z.object({
  selector: z.string().describe('CSS selector of the input field.'),
  text: z.string().describe('Text to type into the field.'),
})

export const webType: Tool<typeof WebTypeParams> = {
  name: 'web_type',
  description: 'Type text into a web input field.',
  parameters: WebTypeParams,
  execute: async ({ selector, text }) => {
    try {
      await webController.run(async (page) => {
        await page.type(selector, text, { delay: 50 })
      })
      return { success: true, result: `Typed text into ${selector}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const WebExtractParams = z.object({
  query: z.string().describe('Description of the data to extract from the page.'),
})

export const webExtract: Tool<typeof WebExtractParams> = {
  name: 'web_extract',
  description: 'Extract visible text or specific data from the current web page.',
  parameters: WebExtractParams,
  execute: async ({ query }) => {
    try {
      const content = await webController.run(async (page) => {
        return page.evaluate(() => document.body.innerText)
      })
      return {
        success: true,
        result: content.slice(0, 5000), // Cap for context efficiency
        metadata: { query, totalLength: content.length },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

toolRegistry.register(webBrowse)
toolRegistry.register(webClick)
toolRegistry.register(webType)
toolRegistry.register(webExtract)
