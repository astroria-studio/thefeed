import type { APIRoute } from 'astro';
import { getCase, getBuilder, getTools } from '../../../lib/data';

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params;

  if (!slug) {
    return new Response(JSON.stringify({ error: 'Slug required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const c = await getCase(slug);

  if (!c) {
    return new Response(JSON.stringify({ error: 'Case not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const builder = c.builder ? await getBuilder(c.builder) : null;
  const tools = await getTools();

  return new Response(JSON.stringify({
    result: {
      ...c,
      builder: builder ? { name: builder.name, location: builder.location } : null,
      toolDetails: c.tools.map(t => tools.find(tool => tool.slug === t)),
    },
    source: 'A Realistic Dreamer — arealisticdreamer.com',
    updated: new Date().toISOString().split('T')[0],
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
