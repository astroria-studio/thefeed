import type { Case, QuizAnswers, ScoredCase, TechLevel, BudgetLevel } from './types';

const TECH_ORDER: TechLevel[] = ['no-code', 'low-code', 'can-code', 'developer'];
const BUDGET_ORDER: BudgetLevel[] = ['zero', 'low', 'mid', 'high'];

function techIndex(level: TechLevel): number {
  return TECH_ORDER.indexOf(level);
}

function budgetIndex(level: BudgetLevel): number {
  return BUDGET_ORDER.indexOf(level);
}

export function scoreCase(c: Case, answers: QuizAnswers): ScoredCase {
  let score = 0;
  const reasons: string[] = [];

  // Tech match (25 points max)
  const userTech = techIndex(answers.tech);
  const needsTech = techIndex(c.needs_tech);
  if (userTech >= needsTech) {
    score += 25;
  } else if (userTech === needsTech - 1) {
    score += 10;
    reasons.push('Stretch: may need to level up technically');
  } else {
    reasons.push('Technical gap');
  }

  // Domain match (30 points max)
  const domainOverlap = answers.domains.filter(d => c.fits_domain.includes(d));
  if (domainOverlap.length > 0) {
    score += 30;
    reasons.push('Domain match');
  } else if (c.fits_domain.includes('other-domain')) {
    score += 15;
  }

  // Budget match (15 points max)
  const userBudget = budgetIndex(answers.budget);
  const needsBudget = budgetIndex(c.budget_min);
  if (userBudget >= needsBudget) {
    score += 15;
  } else {
    score += 5;
    reasons.push('May need higher budget');
  }

  // Market match (15 points max)
  if (c.fits_market.includes(answers.market)) {
    score += 15;
    reasons.push('Market fit');
  } else {
    score += 5;
  }

  // Goal match (15 points max)
  if (c.fits_goal.includes(answers.goal)) {
    score += 15;
    reasons.push('Aligns with your goal');
  } else {
    score += 5;
  }

  const fitLabel = score >= 75 ? 'strong' : score >= 50 ? 'possible' : 'stretch';

  return { ...c, score, reasons, fitLabel };
}

export function rankCases(cases: Case[], answers: QuizAnswers): ScoredCase[] {
  return cases
    .map(c => scoreCase(c, answers))
    .sort((a, b) => b.score - a.score);
}
