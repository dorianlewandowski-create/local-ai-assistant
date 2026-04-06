import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';

const execAsync = promisify(exec);

// Path to original shell scripts
const TOOLS_DIR = '/Users/dorianlewandowski/local-ai-assistant/ai-tools/llm-functions/tools';

/**
 * Helper to run a shell script from the TOOLS_DIR
 */
async function runShellScript(scriptName: string, args: string[], env: Record<string, string> = {}) {
  const command = `bash ${TOOLS_DIR}/${scriptName} ${args.map(arg => JSON.stringify(arg)).join(' ')}`;
  try {
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, ...env }
    });
    if (stderr && !stdout) {
      return { success: false, error: stderr.trim() };
    }
    return { success: true, result: stdout.trim() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// 1. fetch_url_via_curl
const FetchUrlViaCurlParams = z.object({
  url: z.string().describe('The URL to scrape.'),
});

export const fetchUrlViaCurl: Tool<typeof FetchUrlViaCurlParams> = {
  name: 'fetch_url_via_curl',
  description: 'Extract the content from a given URL.',
  parameters: FetchUrlViaCurlParams,
  execute: async ({ url }) => {
    return runShellScript('fetch_url_via_curl.sh', [`--url=${url}`]);
  },
};
toolRegistry.register(fetchUrlViaCurl);

// 2. fetch_url_via_jina
const FetchUrlViaJinaParams = z.object({
  url: z.string().describe('The URL to scrape.'),
});

export const fetchUrlViaJina: Tool<typeof FetchUrlViaJinaParams> = {
  name: 'fetch_url_via_jina',
  description: 'Extract the content from a given URL via Jina.',
  parameters: FetchUrlViaJinaParams,
  execute: async ({ url }) => {
    try {
      const headers: Record<string, string> = {};
      if (process.env.JINA_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
      }
      const response = await fetch(`https://r.jina.ai/${url}`, { headers });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return { success: true, result: text };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
toolRegistry.register(fetchUrlViaJina);

// 3. fetch_url
const FetchUrlParams = z.object({
  url: z.string().describe('The URL to fetch.'),
});

export const fetchUrl: Tool<typeof FetchUrlParams> = {
  name: 'fetch_url',
  description: 'Fetch and simplify the contents of a URL.',
  parameters: FetchUrlParams,
  execute: async ({ url }) => {
    return runShellScript('fetch_url.sh', [`--url=${url}`]);
  },
};
toolRegistry.register(fetchUrl);

// 4. search_arxiv
const SearchArxivParams = z.object({
  query: z.string().describe('The query to search for.'),
});

export const searchArxiv: Tool<typeof SearchArxivParams> = {
  name: 'search_arxiv',
  description: 'Search arXiv for a query and return the top papers.',
  parameters: SearchArxivParams,
  execute: async ({ query }) => {
    try {
      const maxResults = process.env.ARXIV_MAX_RESULTS || '3';
      const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return { success: true, result: text };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
toolRegistry.register(searchArxiv);

// 5. search_wikipedia
const SearchWikipediaParams = z.object({
  query: z.string().describe('The query to search for.'),
});

export const searchWikipedia: Tool<typeof SearchWikipediaParams> = {
  name: 'search_wikipedia',
  description: 'Search Wikipedia for a query. Uses it to get detailed information about a public figure, interpretation of a complex scientific concept or in-depth connectivity of a significant historical event.',
  parameters: SearchWikipediaParams,
  execute: async ({ query }) => {
    try {
      const baseUrl = 'https://en.wikipedia.org/w/api.php';
      const searchUrl = `${baseUrl}?action=query&list=search&srprop=&srlimit=1&limit=1&srsearch=${encodeURIComponent(query)}&srinfo=suggestion&format=json`;
      const searchResponse = await fetch(searchUrl);
      const searchData: any = await searchResponse.json();
      
      const title = searchData.query?.search?.[0]?.title;
      const pageid = searchData.query?.search?.[0]?.pageid;
      
      if (!title || !pageid) {
        return { success: false, error: `No results for '${query}'` };
      }
      
      const extractUrl = `${baseUrl}?action=query&prop=extracts&explaintext=&titles=${encodeURIComponent(title.replace(/ /g, '_'))}&exintro=&format=json`;
      const extractResponse = await fetch(extractUrl);
      const extractData: any = await extractResponse.json();
      
      const extract = extractData.query?.pages?.[pageid]?.extract;
      return { success: true, result: extract || 'No extract available.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
toolRegistry.register(searchWikipedia);

// 6. search_wolframalpha
const SearchWolframAlphaParams = z.object({
  query: z.string().describe('The query to search for.'),
});

export const searchWolframAlpha: Tool<typeof SearchWolframAlphaParams> = {
  name: 'search_wolframalpha',
  description: 'Get an answer to a question using Wolfram Alpha. Input should the query in English. Use it to answer user questions that require computation, detailed facts, data analysis, or complex queries.',
  parameters: SearchWolframAlphaParams,
  execute: async ({ query }) => {
    try {
      const appId = process.env.WOLFRAM_API_ID;
      if (!appId) {
        return { success: false, error: 'WOLFRAM_API_ID is not set' };
      }
      const url = `https://api.wolframalpha.com/v2/query?appid=${appId}&input=${encodeURIComponent(query)}&output=json&format=plaintext`;
      const response = await fetch(url);
      const data: any = await response.json();
      
      const results = data.queryresult?.pods?.map((pod: any) => ({
        title: pod.title,
        values: pod.subpods?.map((sub: any) => sub.plaintext).filter((v: string) => v !== '')
      })) || [];
      
      return { success: true, result: JSON.stringify(results, null, 2) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
toolRegistry.register(searchWolframAlpha);

// 7. web_search_aichat
const WebSearchAichatParams = z.object({
  query: z.string().describe('The query to search for.'),
});

export const webSearchAichat: Tool<typeof WebSearchAichatParams> = {
  name: 'web_search_aichat',
  description: 'Perform a web search to get up-to-date information or additional context. Use this when you need current information or feel a search could provide a better answer.',
  parameters: WebSearchAichatParams,
  execute: async ({ query }) => {
    const model = process.env.WEB_SEARCH_MODEL;
    if (!model) {
      return { success: false, error: 'WEB_SEARCH_MODEL is not set' };
    }
    const client = model.split(':')[0];
    const env: Record<string, string> = {};
    if (client === 'gemini') {
      env['AICHAT_PATCH_GEMINI_CHAT_COMPLETIONS'] = '{"*":{"body":{"tools":[{"google_search":{}}]}}}';
    } else if (client === 'vertexai') {
      env['AICHAT_PATCH_VERTEXAI_CHAT_COMPLETIONS'] = '{"gemini-1.5-.*":{"body":{"tools":[{"googleSearchRetrieval":{}}]}},"gemini-2.0-.*":{"body":{"tools":[{"google_search":{}}]}}}';
    } else if (client === 'ernie') {
      env['AICHAT_PATCH_ERNIE_CHAT_COMPLETIONS'] = '{"*":{"body":{"web_search":{"enable":true}}}}';
    }
    
    try {
      const { stdout, stderr } = await execAsync(`aichat -m ${JSON.stringify(model)} ${JSON.stringify(query)}`, {
        env: { ...process.env, ...env }
      });
      if (stderr && !stdout) {
        return { success: false, error: stderr.trim() };
      }
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
toolRegistry.register(webSearchAichat);

// 8. web_search_perplexity
const WebSearchPerplexityParams = z.object({
  query: z.string().describe('The query to search for.'),
});

export const webSearchPerplexity: Tool<typeof WebSearchPerplexityParams> = {
  name: 'web_search_perplexity',
  description: 'Perform a web search using Perplexity API to get up-to-date information or additional context. Use this when you need current information or feel a search could provide a better answer.',
  parameters: WebSearchPerplexityParams,
  execute: async ({ query }) => {
    try {
      const apiKey = process.env.PERPLEXITY_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'PERPLEXITY_API_KEY is not set' };
      }
      const model = process.env.PERPLEXITY_WEB_SEARCH_MODEL || 'llama-3.1-sonar-small-128k-online';
      
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: query }]
        })
      });
      
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      return { success: true, result: content || 'No content returned from Perplexity.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
toolRegistry.register(webSearchPerplexity);

// 9. web_search_tavily
const WebSearchTavilyParams = z.object({
  query: z.string().describe('The query to search for.'),
});

export const webSearchTavily: Tool<typeof WebSearchTavilyParams> = {
  name: 'web_search_tavily',
  description: 'Perform a web search using Tavily API to get up-to-date information or additional context. Use this when you need current information or feel a search could provide a better answer.',
  parameters: WebSearchTavilyParams,
  execute: async ({ query }) => {
    try {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'TAVILY_API_KEY is not set' };
      }
      
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          include_answer: true
        })
      });
      
      const data: any = await response.json();
      return { success: true, result: data.answer || 'No answer returned from Tavily.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
toolRegistry.register(webSearchTavily);

// 10. web_search (DuckDuckGo)
const WebSearchParams = z.object({
  query: z.string().describe('The query to search for.'),
  limit: z.number().optional().describe('The maximum number of results to return (default 5).'),
  source_filter: z.string().optional().describe('Filter results by source.'),
});

export const webSearch: Tool<typeof WebSearchParams> = {
  name: 'web_search',
  description: 'Perform a web search using DuckDuckGo to get search results.',
  parameters: WebSearchParams,
  execute: async ({ query, limit = 5, source_filter = '' }) => {
    return runShellScript('web_search.sh', [query, limit.toString(), source_filter]);
  },
};
toolRegistry.register(webSearch);
