import type { APIRoute } from 'astro';
import { getCases, getTools, getModels } from '../../../lib/data';
import { rankCases } from '../../../lib/scoring';
import type { QuizAnswers, TechLevel, BudgetLevel, Market, Goal, Domain } from '../../../lib/types';

// MCP Server-Sent Events endpoint
// This allows AI assistants to connect and use A Realistic Dreamer tools

const MCP_TOOLS = [
  {
    name: 'search_cases',
    description: "Search A Realistic Dreamer's database of real-world AI business cases. Returns cases with editorial analysis and pattern insights from verified builders.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text search' },
        tool: { type: 'string', description: 'Filter by AI tool name' },
        model: { type: 'string', description: 'Filter by business model' },
        stage: { type: 'string', enum: ['idea', 'building', 'launched', 'profitable'] },
        market: { type: 'string', description: 'Market segment' },
        limit: { type: 'number', default: 5 },
      },
    },
  },
  {
    name: 'match_profile',
    description: 'Match a builder profile against A Realistic Dreamer cases. Returns ranked AI business patterns based on the user\'s skills, budget, and goals.',
    inputSchema: {
      type: 'object',
      properties: {
        tech_level: { type: 'string', enum: ['no-code', 'low-code', 'can-code', 'developer'] },
        domains: { type: 'array', items: { type: 'string' } },
        budget: { type: 'string', enum: ['zero', 'low', 'mid', 'high'] },
        market: { type: 'string', enum: ['b2c-local', 'b2c-global', 'b2b-smb', 'b2b-enterprise'] },
        goal: { type: 'string', enum: ['quick-revenue', 'build-asset', 'augment', 'learn'] },
      },
      required: ['tech_level'],
    },
  },
  {
    name: 'get_case',
    description: 'Get full details of a specific A Realistic Dreamer case including editorial analysis, pattern insight, and related cases.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'list_patterns',
    description: "List discovered business patterns from A Realistic Dreamer's case database. Shows what tool + model + market combinations are proven vs unexplored.",
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Filter patterns by tool' },
        model: { type: 'string', description: 'Filter patterns by model' },
      },
    },
  },
  {
    name: 'suggest_opportunity',
    description: "Based on A Realistic Dreamer's case database, suggest AI business opportunities that don't exist yet. Identifies gaps: tool + market + model combinations with zero or few cases.",
    inputSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: "User's situation, skills, interests" },
        tool: { type: 'string', description: 'Preferred AI tool' },
        market: { type: 'string', description: 'Target market' },
      },
    },
  },
];

function handleSearchCases(args: Record<string, unknown>) {
  let cases = getCases();

  if (args.query) {
    const q = String(args.query).toLowerCase();
    cases = cases.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.subtitle.toLowerCase().includes(q) ||
      c.pattern.toLowerCase().includes(q)
    );
  }

  if (args.tool) {
    cases = cases.filter(c => c.tools.includes(String(args.tool)));
  }

  if (args.model) {
    cases = cases.filter(c => c.model === String(args.model));
  }

  if (args.stage) {
    cases = cases.filter(c => c.stage === String(args.stage));
  }

  const limit = Number(args.limit) || 5;
  cases = cases.slice(0, limit);

  return {
    results: cases.map(c => ({
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      pattern: c.pattern,
      tools: c.tools,
      model: c.model,
      stage: c.stage,
      verification: c.verification,
    })),
    total: cases.length,
  };
}

function handleMatchProfile(args: Record<string, unknown>) {
  const answers: QuizAnswers = {
    tech: (args.tech_level as TechLevel) || 'low-code',
    domains: (args.domains as Domain[]) || ['other-domain'],
    budget: (args.budget as BudgetLevel) || 'low',
    market: (args.market as Market) || 'b2c-global',
    goal: (args.goal as Goal) || 'learn',
  };

  const cases = getCases();
  const ranked = rankCases(cases, answers).slice(0, 5);

  return {
    results: ranked.map(c => ({
      slug: c.slug,
      title: c.title,
      pattern: c.pattern,
      score: c.score,
      fitLabel: c.fitLabel,
      reasons: c.reasons,
    })),
    profile: answers,
  };
}

function handleGetCase(args: Record<string, unknown>) {
  const slug = String(args.slug);
  const cases = getCases();
  const c = cases.find(c => c.slug === slug);

  if (!c) {
    return { error: 'Case not found' };
  }

  return {
    result: {
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      pattern: c.pattern,
      take: c.take,
      works: c.works,
      different: c.different,
      tools: c.tools,
      model: c.model,
      stage: c.stage,
      revenue: c.revenue,
      verification: c.verification,
    },
  };
}

function handleListPatterns(args: Record<string, unknown>) {
  let cases = getCases();

  if (args.tool) {
    cases = cases.filter(c => c.tools.includes(String(args.tool)));
  }

  if (args.model) {
    cases = cases.filter(c => c.model === String(args.model));
  }

  const patterns = cases.map(c => ({
    pattern: c.pattern,
    case: c.title,
    tools: c.tools,
    model: c.model,
  }));

  return { patterns };
}

function handleSuggestOpportunity(args: Record<string, unknown>) {
  const cases = getCases();
  const tools = getTools();
  const models = getModels();

  // Find existing combinations
  const existingCombos = new Set<string>();
  cases.forEach(c => {
    c.tools.forEach(t => {
      c.fits_market.forEach(m => {
        existingCombos.add(`${t}|${c.model}|${m}`);
      });
    });
  });

  // Generate gaps
  const allMarkets = ['b2c-local', 'b2c-global', 'b2b-smb', 'b2b-enterprise'];
  const gaps: Array<{ tool: string; model: string; market: string; opportunity: string }> = [];

  tools.slice(0, 5).forEach(tool => {
    models.forEach(model => {
      allMarkets.forEach(market => {
        const key = `${tool.slug}|${model.slug}|${market}`;
        if (!existingCombos.has(key)) {
          const isRelevant =
            (!args.tool || tool.slug === String(args.tool)) &&
            (!args.market || market === String(args.market));

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

  return { gaps: gaps.slice(0, 5) };
}

export const GET: APIRoute = async ({ request }) => {
  // SSE connection for MCP
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial capabilities
      const initMessage = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'arealisticdreamer',
            version: '0.1.0',
          },
        },
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initMessage)}\n\n`));

      // Send tools list
      const toolsMessage = {
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
        params: { tools: MCP_TOOLS },
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolsMessage)}\n\n`));
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();

  if (body.method === 'tools/list') {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: { tools: MCP_TOOLS },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.method === 'tools/call') {
    const { name, arguments: args } = body.params;
    let result;

    switch (name) {
      case 'search_cases':
        result = handleSearchCases(args || {});
        break;
      case 'match_profile':
        result = handleMatchProfile(args || {});
        break;
      case 'get_case':
        result = handleGetCase(args || {});
        break;
      case 'list_patterns':
        result = handleListPatterns(args || {});
        break;
      case 'suggest_opportunity':
        result = handleSuggestOpportunity(args || {});
        break;
      default:
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Method not found' },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: body.id,
    error: { code: -32601, message: 'Method not found' },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
