import axios from 'axios';
import 'dotenv/config';

const ACEDATA_KEY = process.env.ACEDATA_API_KEY!;

// AceData chat completion endpoint — check your dashboard
// Common: https://api.acedata.cloud/chat/completions
//         https://api.acedata.cloud/openai/chat/completions
const ACEDATA_CHAT_URL = 'https://api.acedata.cloud/v1/chat/completions';

export interface BriefSummary {
  headline: string;      // one-line title
  summary: string;       // 3-sentence summary
  topStories: string[];  // bullet points
  sentiment: 'bullish' | 'bearish' | 'neutral';
  timestamp: string;
}

/**
 * Sends raw news data to AceData's LLM API and gets back a structured brief.
 * This is AceData Service #2 (LLM/chat completion).
 * 
 * The "system prompt" tells the LLM what role to play.
 * The "user message" is the raw data we want it to process.
 */
export async function generateBriefSummary(rawNews: string): Promise<BriefSummary> {
  console.log('[Summarizer] Generating brief via AceData LLM...');

  const systemPrompt = `You are a concise crypto analyst specialising in the Solana ecosystem.
Your job is to read raw news snippets and produce a clean, structured daily briefing.
Always respond with valid JSON only. No markdown, no explanation, just the JSON object.`;

  const userMessage = `Here is today's raw Solana news data. Summarise it into a structured briefing.

RAW DATA:
${rawNews}

Respond with this exact JSON structure:
{
  "headline": "one compelling headline for today's Solana ecosystem (max 80 chars)",
  "summary": "2-3 sentence summary of the most important developments",
  "topStories": ["story 1 in one sentence", "story 2 in one sentence", "story 3 in one sentence"],
  "sentiment": "bullish or bearish or neutral"
}`;

  try {
    const response = await axios.post(
      ACEDATA_CHAT_URL,
      {
        model: 'gpt-4o-mini', // or whatever model AceData exposes, check their docs
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,  // lower = more consistent output
        max_tokens: 400,
      },
      {
        headers: {
          'Authorization': ACEDATA_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    // Extract the LLM's response text
    const content = response.data?.choices?.[0]?.message?.content || '';
    
    // Parse the JSON the LLM returned
    // Sometimes LLMs add ```json ... ``` wrappers — strip them
    const cleaned = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    const brief: BriefSummary = {
      headline: parsed.headline || 'Solana Ecosystem Daily Brief',
      summary: parsed.summary || 'No summary generated.',
      topStories: Array.isArray(parsed.topStories) ? parsed.topStories : [],
      sentiment: parsed.sentiment || 'neutral',
      timestamp: new Date().toISOString(),
    };

    console.log('[Summarizer] Brief generated:', brief.headline);
    return brief;

  } catch (error: any) {
    console.error('[Summarizer] Error:', error.response?.data || error.message);
    // Return a fallback so the agent doesn't crash
    return {
      headline: 'Solana Daily Brief',
      summary: 'Could not generate summary this cycle.',
      topStories: [],
      sentiment: 'neutral',
      timestamp: new Date().toISOString(),
    };
  }
}