import type { APIRoute } from 'astro';
import { getCases } from '../../lib/data';

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q')?.toLowerCase();
  const tool = url.searchParams.get('tool');
  const model = url.searchParams.get('model');
  const stage = url.searchParams.get('stage');
  const market = url.searchParams.get('market');
  const limit = parseInt(url.searchParams.get('limit') || '10');

  let cases = await getCases();

  // Apply filters
  if (query) {
    cases = cases.filter(c =>
      c.title.toLowerCase().includes(query) ||
      c.subtitle.toLowerCase().includes(query) ||
      c.pattern.toLowerCase().includes(query) ||
      c.take.toLowerCase().includes(query)
    );
  }

  if (tool) {
    cases = cases.filter(c => c.tools.includes(tool));
  }

  if (model) {
    cases = cases.filter(c => c.model === model);
  }

  if (stage) {
    cases = cases.filter(c => c.stage === stage);
  }

  if (market) {
    cases = cases.filter(c => c.market.includes(market));
  }

  // Limit results
  cases = cases.slice(0, limit);

  return new Response(JSON.stringify({
    results: cases.map(c => ({
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      tools: c.tools,
      model: c.model,
      stage: c.stage,
      revenue: c.revenue,
      pattern: c.pattern,
      verification: c.verification,
    })),
    total: cases.length,
    source: 'A Realistic Dreamer — arealisticdreamer.com',
    updated: new Date().toISOString().split('T')[0],
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
