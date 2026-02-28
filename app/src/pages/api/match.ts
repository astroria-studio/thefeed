import type { APIRoute } from 'astro';
import { getCases } from '../../lib/data';
import { rankCases } from '../../lib/scoring';
import type { QuizAnswers, TechLevel, BudgetLevel, Market, Goal, Domain } from '../../lib/types';

export const GET: APIRoute = async ({ url }) => {
  const tech = url.searchParams.get('tech') as TechLevel;
  const domains = url.searchParams.getAll('domain') as Domain[];
  const budget = url.searchParams.get('budget') as BudgetLevel;
  const market = url.searchParams.get('market') as Market;
  const goal = url.searchParams.get('goal') as Goal;

  if (!tech) {
    return new Response(JSON.stringify({ error: 'tech_level required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const answers: QuizAnswers = {
    tech: tech || 'low-code',
    domains: domains.length > 0 ? domains : ['other-domain'],
    budget: budget || 'low',
    market: market || 'b2c-global',
    goal: goal || 'learn',
  };

  const cases = await getCases();
  const ranked = rankCases(cases, answers);

  return new Response(JSON.stringify({
    results: ranked.map(c => ({
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      score: c.score,
      fitLabel: c.fitLabel,
      reasons: c.reasons,
      pattern: c.pattern,
      tools: c.tools,
      model: c.model,
    })),
    profile: answers,
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

  const answers: QuizAnswers = {
    tech: body.tech_level || 'low-code',
    domains: body.domains || ['other-domain'],
    budget: body.budget || 'low',
    market: body.market || 'b2c-global',
    goal: body.goal || 'learn',
  };

  const cases = await getCases();
  const ranked = rankCases(cases, answers);

  return new Response(JSON.stringify({
    results: ranked.map(c => ({
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      score: c.score,
      fitLabel: c.fitLabel,
      reasons: c.reasons,
      pattern: c.pattern,
      tools: c.tools,
      model: c.model,
    })),
    profile: answers,
    source: 'A Realistic Dreamer — arealisticdreamer.com',
    updated: new Date().toISOString().split('T')[0],
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
