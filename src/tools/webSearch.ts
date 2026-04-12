import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import { config } from '@apex/core'
import { fetchJsonWithTimeout, fetchTextWithTimeout, TOOL_HTTP_TIMEOUT_MS } from '../runtime/fetchWithTimeout'

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const toolTimeoutMsg = (label: string) => `${label} timed out after ${TOOL_HTTP_TIMEOUT_MS}ms`

async function fetchUrlText(url: string) {
  try {
    const {
      ok,
      status,
      text: html,
    } = await fetchTextWithTimeout(
      url,
      {
        headers: {
          'User-Agent': 'Apex/1.0.0-rc.1',
        },
      },
      { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('fetch_url') },
    )
    if (!ok) {
      throw new Error(`HTTP error! status: ${status}`)
    }

    return { success: true, result: htmlToText(html) }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// 1. fetch_url_via_curl
const FetchUrlViaCurlParams = z.object({
  url: z.string().describe('The URL to scrape.'),
})

export const fetchUrlViaCurl: Tool<typeof FetchUrlViaCurlParams> = {
  name: 'fetch_url_via_curl',
  description: 'Extract the content from a given URL.',
  parameters: FetchUrlViaCurlParams,
  execute: async ({ url }) => {
    return fetchUrlText(url)
  },
}
toolRegistry.register(fetchUrlViaCurl)

// 2. fetch_url_via_jina
const FetchUrlViaJinaParams = z.object({
  url: z.string().describe('The URL to scrape.'),
})

export const fetchUrlViaJina: Tool<typeof FetchUrlViaJinaParams> = {
  name: 'fetch_url_via_jina',
  description: 'Extract the content from a given URL via Jina.',
  parameters: FetchUrlViaJinaParams,
  execute: async ({ url }) => {
    try {
      const headers: Record<string, string> = {}
      if (config.integrations.jinaApiKey) {
        headers['Authorization'] = `Bearer ${config.integrations.jinaApiKey}`
      }
      const { ok, status, text } = await fetchTextWithTimeout(
        `https://r.jina.ai/${url}`,
        { headers },
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('fetch_url_via_jina') },
      )
      if (!ok) {
        throw new Error(`HTTP error! status: ${status}`)
      }
      return { success: true, result: text }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}
toolRegistry.register(fetchUrlViaJina)

// 3. fetch_url
const FetchUrlParams = z.object({
  url: z.string().describe('The URL to fetch.'),
})

export const fetchUrl: Tool<typeof FetchUrlParams> = {
  name: 'fetch_url',
  description: 'Fetch and simplify the contents of a URL.',
  parameters: FetchUrlParams,
  execute: async ({ url }) => {
    return fetchUrlText(url)
  },
}
toolRegistry.register(fetchUrl)

// 4. search_arxiv
const SearchArxivParams = z.object({
  query: z.string().describe('The query to search for.'),
})

export const searchArxiv: Tool<typeof SearchArxivParams> = {
  name: 'search_arxiv',
  description: 'Search arXiv for a query and return the top papers.',
  parameters: SearchArxivParams,
  execute: async ({ query }) => {
    try {
      const maxResults = config.integrations.arxivMaxResults
      const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`
      const { ok, status, text } = await fetchTextWithTimeout(
        url,
        {},
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('search_arxiv') },
      )
      if (!ok) {
        throw new Error(`HTTP error! status: ${status}`)
      }
      return { success: true, result: text }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}
toolRegistry.register(searchArxiv)

// 5. search_wikipedia
const SearchWikipediaParams = z.object({
  query: z.string().describe('The query to search for.'),
})

export const searchWikipedia: Tool<typeof SearchWikipediaParams> = {
  name: 'search_wikipedia',
  description:
    'Search Wikipedia for a query. Uses it to get detailed information about a public figure, interpretation of a complex scientific concept or in-depth connectivity of a significant historical event.',
  parameters: SearchWikipediaParams,
  execute: async ({ query }) => {
    try {
      const baseUrl = 'https://en.wikipedia.org/w/api.php'
      const searchUrl = `${baseUrl}?action=query&list=search&srprop=&srlimit=1&limit=1&srsearch=${encodeURIComponent(query)}&srinfo=suggestion&format=json`
      const searchData: any = await fetchJsonWithTimeout(
        searchUrl,
        {},
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('search_wikipedia(search)') },
      )

      const title = searchData.query?.search?.[0]?.title
      const pageid = searchData.query?.search?.[0]?.pageid

      if (!title || !pageid) {
        return { success: false, error: `No results for '${query}'` }
      }

      const extractUrl = `${baseUrl}?action=query&prop=extracts&explaintext=&titles=${encodeURIComponent(title.replace(/ /g, '_'))}&exintro=&format=json`
      const extractData: any = await fetchJsonWithTimeout(
        extractUrl,
        {},
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('search_wikipedia(extract)') },
      )

      const extract = extractData.query?.pages?.[pageid]?.extract
      return { success: true, result: extract || 'No extract available.' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}
toolRegistry.register(searchWikipedia)

// 6. search_wolframalpha
const SearchWolframAlphaParams = z.object({
  query: z.string().describe('The query to search for.'),
})

export const searchWolframAlpha: Tool<typeof SearchWolframAlphaParams> = {
  name: 'search_wolframalpha',
  description:
    'Get an answer to a question using Wolfram Alpha. Input should the query in English. Use it to answer user questions that require computation, detailed facts, data analysis, or complex queries.',
  parameters: SearchWolframAlphaParams,
  execute: async ({ query }) => {
    try {
      const appId = config.integrations.wolframAppId
      if (!appId) {
        return { success: false, error: 'WOLFRAM_API_ID is not set' }
      }
      const url = `https://api.wolframalpha.com/v2/query?appid=${appId}&input=${encodeURIComponent(query)}&output=json&format=plaintext`
      const data: any = await fetchJsonWithTimeout(
        url,
        {},
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('search_wolframalpha') },
      )

      const results =
        data.queryresult?.pods?.map((pod: any) => ({
          title: pod.title,
          values: pod.subpods?.map((sub: any) => sub.plaintext).filter((v: string) => v !== ''),
        })) || []

      return { success: true, result: JSON.stringify(results, null, 2) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}
toolRegistry.register(searchWolframAlpha)

// 7. web_search_aichat
const WebSearchAichatParams = z.object({
  query: z.string().describe('The query to search for.'),
})

export const webSearchAichat: Tool<typeof WebSearchAichatParams> = {
  name: 'web_search_aichat',
  description:
    'Perform a web search to get up-to-date information or additional context. Use this when you need current information or feel a search could provide a better answer.',
  parameters: WebSearchAichatParams,
  execute: async ({ query }) => {
    void query
    return {
      success: false,
      error:
        'web_search_aichat is disabled in self-contained Apex. Use web_search, web_search_perplexity, or web_search_tavily instead.',
    }
  },
}

// 8. web_search_perplexity
const WebSearchPerplexityParams = z.object({
  query: z.string().describe('The query to search for.'),
})

export const webSearchPerplexity: Tool<typeof WebSearchPerplexityParams> = {
  name: 'web_search_perplexity',
  description:
    'Perform a web search using Perplexity API to get up-to-date information or additional context. Use this when you need current information or feel a search could provide a better answer.',
  parameters: WebSearchPerplexityParams,
  execute: async ({ query }) => {
    try {
      const apiKey = config.integrations.perplexityApiKey
      if (!apiKey) {
        return { success: false, error: 'PERPLEXITY_API_KEY is not set' }
      }
      const model = config.models.webSearch

      const data: any = await fetchJsonWithTimeout(
        'https://api.perplexity.ai/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: query }],
          }),
        },
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('web_search_perplexity') },
      )
      const content = data.choices?.[0]?.message?.content
      return { success: true, result: content || 'No content returned from Perplexity.' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}
toolRegistry.register(webSearchPerplexity)

// 9. web_search_tavily
const WebSearchTavilyParams = z.object({
  query: z.string().describe('The query to search for.'),
})

export const webSearchTavily: Tool<typeof WebSearchTavilyParams> = {
  name: 'web_search_tavily',
  description:
    'Perform a web search using Tavily API to get up-to-date information or additional context. Use this when you need current information or feel a search could provide a better answer.',
  parameters: WebSearchTavilyParams,
  execute: async ({ query }) => {
    try {
      const apiKey = config.integrations.tavilyApiKey
      if (!apiKey) {
        return { success: false, error: 'TAVILY_API_KEY is not set' }
      }

      const data: any = await fetchJsonWithTimeout(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            include_answer: true,
          }),
        },
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('web_search_tavily') },
      )
      return { success: true, result: data.answer || 'No answer returned from Tavily.' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}
toolRegistry.register(webSearchTavily)

// 10. web_search (DuckDuckGo)
const WebSearchParams = z.object({
  query: z.string().describe('The query to search for.'),
  limit: z.number().optional().describe('The maximum number of results to return (default 5).'),
  source_filter: z.string().optional().describe('Filter results by source.'),
})

export const webSearch: Tool<typeof WebSearchParams> = {
  name: 'web_search',
  description: 'Perform a web search using DuckDuckGo to get search results.',
  parameters: WebSearchParams,
  execute: async ({ query, limit = 5, source_filter = '' }) => {
    try {
      const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const {
        ok,
        status,
        text: html,
      } = await fetchTextWithTimeout(
        searchUrl,
        {
          headers: {
            'User-Agent': 'Apex/1.0.0-rc.1',
          },
        },
        { timeoutMs: TOOL_HTTP_TIMEOUT_MS, timeoutMessage: toolTimeoutMsg('web_search') },
      )
      if (!ok) {
        throw new Error(`HTTP error! status: ${status}`)
      }
      const matches = Array.from(
        html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g),
      )
        .slice(0, limit)
        .map((match, index) => {
          const title = htmlToText(match[2])
          const url = match[1]
          return `${index + 1}. ${title} - ${url}`
        })
        .filter((entry) => !source_filter || entry.toLowerCase().includes(source_filter.toLowerCase()))

      return {
        success: true,
        result: matches.length > 0 ? matches.join('\n') : `No results found for "${query}".`,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}
toolRegistry.register(webSearch)
