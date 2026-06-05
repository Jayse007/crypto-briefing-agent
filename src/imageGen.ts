import axios from 'axios';

const ACEDATA_KEY = process.env.ACEDATA_API_KEY!;

const ACEDATA_IMAGE_URL = 'https://api.acedata.cloud/v1/images/generations';

export interface GeneratedImage {
  url: string;       // URL of the generated image
  prompt: string;    // what was requested
  success: boolean;
}

/**
 * Generates a visual briefing card via AceData's image generation API.
 * This is AceData Service #3 (image generation).
 * 
 * We pass a descriptive prompt and get back an image URL.
 * The URL is stored on-chain as part of our briefing record.
 */
export async function generateBriefingCard(
  headline: string,
  sentiment: 'bullish' | 'bearish' | 'neutral'
): Promise<GeneratedImage> {
  console.log('[ImageGen] Generating briefing card via AceData...');

  const sentimentColor = {
    bullish: 'vibrant green and gold',
    bearish: 'deep red and dark blue',
    neutral: 'calm blue and silver',
  }[sentiment];

  // A good image prompt is specific and descriptive
  const prompt = `A sleek, professional cryptocurrency dashboard card for a Solana blockchain 
daily briefing. Dark background with ${sentimentColor} accent colors. 
Futuristic HUD style with the Solana logo (teal/purple gradient). 
Data visualization elements: charts, network nodes. 
Clean typography space for headline: "${headline.slice(0, 50)}". 
High quality, digital art style, 16:9 aspect ratio.`;

  try {
    const response = await axios.post(
      ACEDATA_IMAGE_URL,
      {
        prompt: prompt,
        n: 1,
        size: '1024x1024',   // or '1024x1024' — check what AceData supports
        quality: 'low',
        model: 'gpt-image-2',
        style: 'natural'  // or flux, or whatever AceData exposes
      },
      {
        headers: {
          'Authorization': ACEDATA_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 240000,  // image gen can take up to 4 minutes
      }
    );

    const imageUrl = response.data?.data?.[0]?.url || '';
    
    if (!imageUrl) {
      throw new Error('No image URL in response');
    }

    console.log('[ImageGen] Image generated successfully');
    return { url: imageUrl, prompt, success: true };

  } catch (error: any) {
    console.error('[ImageGen] Error:', error.response?.data || error.message);
    return {
      url: 'https://placeholder.acedata.cloud/briefing-card.png',
      prompt,
      success: false,
    };
  }
}