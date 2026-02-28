import type { APIRoute } from 'astro';
import { getCases } from '../../lib/data';

export const GET: APIRoute = async ({ url }) => {
  const toolFilter = url.searchParams.get('tool');
  const modelFilter = url.searchParams.get('model');

  let cases = await getCases();

  if (toolFilter) {
    cases = cases.filter(c => c.tools.includes(toolFilter));
  }

  if (modelFilter) {
    cases = cases.filter(c => c.model === modelFilter);
  }

  // Extract patterns
  const patterns = cases.map(c => ({
    pattern: c.pattern,
    case: c.title,
    tools: c.tools,
    model: c.model,
    stage: c.stage,
    verification: c.verification,
  }));

  // Aggregate tool usage
  const toolUsage: Record<string, number> = {};
  cases.forEach(c => {
    c.tools.forEach(t => {
      toolUsage[t] = (toolUsage[t] || 0) + 1;
    });
  });

  // Aggregate model usage
  const modelUsage: Record<string, number> = {};
  cases.forEach(c => {
    modelUsage[c.model] = (modelUsage[c.model] || 0) + 1;
  });

  // Find tool + model combinations
  const combinations: Record<string, { count: number; cases: string[] }> = {};
  cases.forEach(c => {
    c.tools.forEach(t => {
      const key = `${t} + ${c.model}`;
      if (!combinations[key]) {
        combinations[key] = { count: 0, cases: [] };
      }
      combinations[key].count++;
      combinations[key].cases.push(c.title);
    });
  });

  return new Response(JSON.stringify({
    patterns,
    toolUsage: Object.entries(toolUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count })),
    modelUsage: Object.entries(modelUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([model, count]) => ({ model, count })),
    combinations: Object.entries(combinations)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([combo, data]) => ({ combo, ...data })),
    source: 'A Realistic Dreamer — arealisticdreamer.com',
    updated: new Date().toISOString().split('T')[0],
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
