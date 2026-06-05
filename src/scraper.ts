/**
 * scraper.ts
 *
 * Fetches live Solana ecosystem news via AceData's Google SERP API.
 * This is AceData Service #1 of the three required for Track B qualification.
 *
 * ─── Confirmed API spec (from platform.acedata.cloud/documents/serp-google-integration) ──
 *
 *   Method:   POST
 *   Endpoint: https://api.acedata.cloud/serp/google
 *   Headers:
 *     accept:        application/json
 *     authorization: Bearer <token>
 *     content-type:  application/json
 *
 *   Request body (JSON):
 *     query    {string}  required  Search keyword
 *     type     {string}  optional  "search" | "images" | "news" | "maps" | "places" | "videos"
 *                                  Default: "search"
 *     country  {string}  optional  Country code e.g. "us" (default: "us")
 *     language {string}  optional  Language code e.g. "en" (default: "en")
 *     range    {string}  optional  "qdr:h" | "qdr:d" | "qdr:w" | "qdr:m" | unlimited (default)
 *     number   {number}  optional  Results per page. Default 10. >10 costs double credits.
 *     page     {number}  optional  Page number. Default 1.
 *
 *   Response shape — type:"news":
 *     { news: [{ title, link, snippet, date, source, image_url, position }] }
 *
 *   Response shape — type:"search" (default):
 *     { organic: [{ title, link, snippet, date?, position }], knowledge_graph?, ... }
 *
 * ─── Why type:"news" ─────────────────────────────────────────────────────────
 *
 *   news results include `source` (e.g. "Reuters") and `date` (e.g. "2 hours ago"),
 *   giving the LLM richer context for judging recency and credibility.
 *   We stay at number:10 (≤10 costs 1 credit; >10 costs 2 credits per the docs).
 */

import axios from 'axios';

// ─── env ─────────────────────────────────────────────────────────────────────

const ACEDATA_KEY   = process.env.ACEDATA_API_KEY!; // "Bearer platform-v1-xxxx"
const SERP_ENDPOINT = 'https://api.acedata.cloud/serp/google';

// ─── page rotation ────────────────────────────────────────────────────────────

/**
 * Returns a page number that rotates across runs without any persistent state.
 *
 * Problem: GitHub Actions spawns a fresh container per run, so an in-memory
 * or file-based counter resets to 1 every time — always returning the same
 * top-10 articles.
 *
 * Solution: Derive the page from the current UTC hour. The agent runs hourly,
 * so the hour already increments by 1 between runs. We map it onto a window
 * of MAX_PAGE pages using modulo, then add 1 (pages are 1-indexed).
 *
 *   Hour 0  → page 1   (results  1–10)
 *   Hour 1  → page 2   (results 11–20)
 *   Hour 2  → page 3   (results 21–30)
 *   Hour 3  → page 4   (results 31–40)
 *   Hour 4  → page 5   (results 41–50)
 *   Hour 5  → page 1   (cycle repeats)
 *   ...
 *
 * Why MAX_PAGE = 5?
 *   With range:"qdr:d" (past 24 hours) there are rarely more than 40–50
 *   relevant Solana news articles in a day. Beyond page 5 results thin out
 *   sharply and quality degrades. Staying within 5 pages also ensures we
 *   see fresh content on every run without hitting empty pages.
 *
 * This is stateless and deterministic — no file, no API call, no GitHub
 * secret needed to track which page was last fetched.
 */
const MAX_PAGE = 5;

function getCurrentPage(): number {
  const utcHour = new Date().getUTCHours(); // 0–23
  return (utcHour % MAX_PAGE) + 1;          // 1–5
}

// ─── query config ─────────────────────────────────────────────────────────────

/**
 * Builds the two parallel query bodies for this run, with the current page
 * injected so each hourly run fetches a different slice of results.
 *
 * type:"news" + range:"qdr:d" = past-24h news only (fresh every cycle).
 * number:10 = stays within the 1-credit tier (>10 costs double per the docs).
 *
 * Both queries use the SAME page number so the two result sets are
 * complementary slices of the same 24h window rather than overlapping.
 */
function buildQueries(): SerpRequestBody[] {
  const page = getCurrentPage();
  console.log(`[Scraper] Page rotation: UTC hour ${new Date().getUTCHours()} → page ${page}`);

  return [
    {
      query:    'Solana blockchain news',
      type:     'news',
      country:  'us',
      language: 'en',
      range:    'qdr:d',
      number:   10,
      page,
    },
    {
      query:    'Solana DeFi protocol update',
      type:     'news',
      country:  'us',
      language: 'en',
      range:    'qdr:d',
      number:   10,
      page,
    },
  ];
}

// ─── types ────────────────────────────────────────────────────────────────────

interface SerpRequestBody {
  query:     string;
  type?:     'search' | 'images' | 'news' | 'maps' | 'places' | 'videos';
  country?:  string;
  language?: string;
  range?:    'qdr:h' | 'qdr:d' | 'qdr:w' | 'qdr:m';
  number?:   number;
  page?:     number;
}

interface NewsItem {
  title:      string;
  link:       string;
  snippet:    string;
  date?:      string;   // e.g. "2 hours ago"
  source?:    string;   // e.g. "Reuters"
  image_url?: string;
  position:   number;
}

interface OrganicItem {
  title:    string;
  link:     string;
  snippet:  string;
  date?:    string;
  position: number;
}

interface SerpResponse {
  news?:    NewsItem[];
  organic?: OrganicItem[];
}

/**
 * Normalised result shape used by the rest of the pipeline.
 * Exported so index.ts and test-scraper.ts can reference the type.
 */
export interface SearchResult {
  title:   string;
  snippet: string;
  url:     string;
  source?: string;  // news source name — only from type:"news" responses
  date?:   string;  // relative date string — only from type:"news" responses
}

// ─── main export ─────────────────────────────────────────────────────────────

/**
 * Fetches the latest Solana ecosystem news via AceData's Google SERP API.
 *
 * Runs both queries in parallel. One failing query does not abort the run —
 * Promise.allSettled collects whichever queries succeed.
 * Deduplicates by URL, caps at 12 results, and returns.
 */
export async function fetchSolanaNews(): Promise<SearchResult[]> {
  console.log('[Scraper] Fetching Solana news via AceData SERP API...');

  const queries = buildQueries();
  console.log(queries);
  const settled = await Promise.allSettled(
    queries.map((body) => fetchQuery(body))
  );

  const allItems: SearchResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      allItems.push(...outcome.value);
    } else {
      // Unwrap axios errors fully — axios wraps the real error in
      // error.response.data and error.message, both of which are lost
      // if we only print outcome.reason?.message (it may be undefined).
      const err = outcome.reason;
      if (err?.response) {
        // Server replied with a non-2xx status
        console.error(
          `[Scraper] Query failed — HTTP ${err.response.status}:`,
          JSON.stringify(err.response.data)
        );
      } else if (err?.request) {
        // Request was made but no response received (timeout, DNS, etc.)
        console.error('[Scraper] Query failed — no response received:', err.message);
      } else {
        // Something else went wrong before the request fired
        console.error('[Scraper] Query failed — setup error:', err?.message ?? err);
      }
    }
  }

  // Deduplicate by URL — parallel queries often return overlapping articles
  const seen   = new Set<string>();
  const unique = allItems.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  // Cap at 12 — plenty of material for the LLM without burning extra credits
  const results = unique.slice(0, 12);
  console.log(
    `[Scraper] Got ${results.length} unique results from ${queries.length} queries (page ${getCurrentPage()})`
  );
  return results;
}

/**
 * Fires one POST request to the SERP API and normalises the response.
 *
 * Uses raw axios (not the AceDataCloud SDK client) because:
 *   - The SERP API authenticates via the Authorization header, not x402.
 *   - x402 only fires when the server returns 402; SERP uses credit-based
 *     billing deducted from the account balance, so 402 is never returned.
 *   - The payment.ts onPaymentSettled callback records x402 tx hashes from
 *     the other two services (LLM + image), which do use x402.
 */
async function fetchQuery(body: SerpRequestBody): Promise<SearchResult[]> {
  console.log(`[Scraper] Sending query: "${body.query}" (page ${body.page})`);
  const response = await axios.post(
    SERP_ENDPOINT,
    body,
    {
      headers: {
        'accept':        'application/json',
        'authorization': ACEDATA_KEY,
        'content-type':  'application/json',
      },
      timeout: 60_000,
      // Without validateStatus, axios swallows the response body on non-2xx,
      // making the error message empty. This ensures err.response.data is
      // always populated so the catch block can print the real API error.
      validateStatus: (status) => status >= 200 && status < 300,
    }
  );

  console.log(`[Scraper] HTTP ${response.status} for query: "${body.query}" (page ${body.page})`);
  const data = response.data;

  // type:"news"   → data.news[]
  // type:"search" → data.organic[]
  // Fall back to empty array if neither field is present
  const items: Array<NewsItem | OrganicItem> = data.news ?? data.organic ?? [];

  if (items.length === 0) {
    console.warn(`[Scraper] Zero results for query: "${body.query}"`);
    return [];
  }

  return items.map((item): SearchResult => ({
    title:   item.title   ?? '',
    snippet: item.snippet ?? '',
    url:     item.link    ?? '',
    // `source` and `date` are only present on NewsItem, not OrganicItem
    source:  'source' in item ? (item as NewsItem).source : undefined,
    date:    'date'   in item ? item.date   : undefined,
  }));
}

// ─── formatting helper ────────────────────────────────────────────────────────

/**
 * Converts SearchResult[] into a numbered plain-text block for the LLM prompt.
 *
 * Includes [Source • date] metadata when available so the LLM can judge
 * recency and credibility of each article.
 *
 * Format:
 *   1. Article Title [Reuters • 2 hours ago]
 *      Snippet text here...
 *
 *   2. Next Article [Bloomberg • 5 hours ago]
 *      ...
 *
 * Signature is unchanged — summarizer.ts and index.ts call this identically.
 */
export function formatResultsForLLM(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No recent Solana news available.';
  }

  return results
    .map((r, i) => {
      const meta   = [r.source, r.date].filter(Boolean).join(' • ');
      const header = meta ? `${r.title} [${meta}]` : r.title;
      return `${i + 1}. ${header}\n   ${r.snippet}`;
    })
    .join('\n\n');
}