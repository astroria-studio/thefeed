import type { APIRoute } from 'astro';
import { getCases, getTools, getModels } from '../../lib/data';

export const GET: APIRoute = async ({ url }) => {
  const context = url.searchParams.get('context');
  const preferredTool = url.searchParams.get('tool');
  const targetMarket = url.searchParams.get('market');

  const cases = await getCases();
  const tools = await getTools();
  const models = await getModels();

  // Find existing combinations
  const existingCombos = new Set<string>();
  cases.forEach(c => {
    c.tools.forEach(t => {
      c.fits_market.forEach(m => {
        existingCombos.add(`${t}|${c.model}|${m}`);
      });
    });
  });

  // Generate potential opportunities (gaps)
  const allMarkets = ['b2c-local', 'b2c-global', 'b2b-smb', 'b2b-enterprise'];
  const gaps: Array<{
    tool: string;
    model: string;
    market: string;
    opportunity: string;
  }> = [];

  tools.forEach(tool => {
    models.forEach(model => {
      allMarkets.forEach(market => {
        const key = `${tool.slug}|${model.slug}|${market}`;
        if (!existingCombos.has(key)) {
          // Check if this combination makes sense
          const isRelevant =
            (!preferredTool || tool.slug === preferredTool) &&
            (!targetMarket || market === targetMarket);

          if (isRelevant) {
            gaps.push({
              tool: tool.title,
              model: model.title,
              market,
              opportunity: `No verified cases of ${tool.title} + ${model.title} for ${market} market`,
            });
          }
        }
      });
    });
  });

  // Limit and sort gaps
  const limitedGaps = gaps.slice(0, 10);

  // Generate insights based on context
  let insights: string[] = [];
  if (context) {
    const contextLower = context.toLowerCase();

    if (contextLower.includes('vietnam') || contextLower.includes('local')) {
      insights.push('Vietnamese market has significant gaps in vertical SaaS applications');
      insights.push('Voice AI for local businesses is barely explored');
    }

    if (contextLower.includes('no-code') || contextLower.includes('non-technical')) {
      insights.push('AI template businesses require no code and have proven revenue');
      insights.push('Agency model augmented with AI is the fastest path to revenue');
    }

    if (contextLower.includes('developer') || contextLower.includes('code')) {
      insights.push('Vibe-coded SaaS products are out-competing funded startups');
      insights.push('Document processing AI is boring but highly profitable');
    }
  }

  return new Response(JSON.stringify({
    gaps: limitedGaps,
    insights,
    methodology: 'Identifies tool + model + market combinations with zero or few verified cases in A Realistic Dreamer database',
    source: 'A Realistic Dreamer — arealisticdreamer.com',
    updated: new Date().toISOString().split('T')[0],
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const { context, tool, market } = body;

  // Reuse GET logic
  const url = new URL('http://localhost/api/opportunity');
  if (context) url.searchParams.set('context', context);
  if (tool) url.searchParams.set('tool', tool);
  if (market) url.searchParams.set('market', market);

  return GET({ url } as any);
};
