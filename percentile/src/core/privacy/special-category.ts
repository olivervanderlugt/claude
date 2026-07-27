/**
 * Special-category detection at ingest (GDPR Art 9).
 *
 * docs/04-data-governance.md originally excluded special-category data from the co-op
 * *by policy*. Legal review says that is not enough, and the reasoning is worth stating
 * because it drives the whole design of this file:
 *
 *   CJEU C-184/20 (OT, Grand Chamber, Aug 2022) holds that Art 9 attaches to data
 *   "liable indirectly to reveal" a protected characteristic — derivable by an
 *   "intellectual operation involving comparison or deduction". The trigger is objective.
 *   An event named `hiv_refill_tapped` engages Art 9 *on receipt*. A contract with the
 *   developer changes their obligations; it does not change what the string in our
 *   database is liable to reveal.
 *
 *   CJEU C-446/21 (Schrems v Meta, Oct 2024) holds that data minimisation precludes
 *   aggregating externally-sourced data "without ... distinction as to type of data".
 *   A policy prohibition performs no runtime distinction by type. That is precisely its
 *   defect: it is a promise about inputs, not a control over them.
 *
 * So detection has to run before persistence, exactly like PII redaction. Two levels:
 *
 *   EVENT level    — an individual event whose name/path reveals a protected characteristic
 *   WORKSPACE level— an app whose *identity* is revealing. Schrems treated data generated
 *                    by visiting sites targeted at homosexual users as engaging Art 9 on
 *                    mere page load. For such an app, being a user at all is the
 *                    disclosure, so no event from it may ever enter the co-op — scrubbing
 *                    individual event names would not help.
 *
 * Detection is deliberately over-inclusive. A false positive costs one cohort observation;
 * a false negative puts Art 9 data into a dataset we sell. Those are not symmetric.
 *
 * NOTE: this is a signal, not an oracle. It cannot catch a developer who names their
 * events `evt_001`. It is one layer of a defence that also includes the co-op addendum,
 * the vertical declaration, and manual review before a workspace is enrolled.
 */

import type { ConsentPurpose } from '../types.ts';

/** Art 9(1) categories, plus the children's-data flag which is regulated separately. */
export type SensitiveCategory =
  | 'health'
  | 'sex_life_or_orientation'
  | 'religion'
  | 'political_opinion'
  | 'trade_union'
  | 'racial_or_ethnic_origin'
  | 'biometric_or_genetic'
  | 'criminal_offence'
  | 'childrens_data';

interface CategorySignal {
  category: SensitiveCategory;
  /** Matched against event names, URL paths, and property keys. */
  pattern: RegExp;
}

/**
 * Build a token matcher with *identifier-aware* boundaries.
 *
 * `\b` is wrong here and the mistake is easy to make: `_` is a word character in JS
 * regex, so `/\bhiv\b/` does NOT match `hiv_refill_tapped`. Since analytics event names
 * are almost universally snake_case or kebab-case, `\b` would have let nearly every real
 * violation through while still passing a naive test that used a bare word.
 *
 * The lookarounds below treat only letters and digits as "inside a word", so `_`, `-`,
 * `/`, `.` and whitespace all act as separators — while `racetrack` still does not trip
 * the `race` rule, which is the false positive that matters.
 */
function tokens(category: SensitiveCategory, alternation: string): CategorySignal {
  return {
    category,
    pattern: new RegExp(`(?<![a-z0-9])(?:${alternation})(?![a-z0-9])`, 'i'),
  };
}

/**
 * Ordering is irrelevant — every pattern is evaluated and all matches are returned, so a
 * string can carry more than one category.
 *
 * Note what is deliberately absent: bare `health`. `health_check` is a near-universal
 * ops event, and flagging it would train developers to disable screening entirely. The
 * health rule instead matches specific conditions and the compound forms
 * (`mental_health`, `health_record`) that actually indicate Art 9 data.
 */
const SIGNALS: CategorySignal[] = [
  tokens(
    'health',
    'hiv|aids|cancer|oncolog[a-z]*|diabet[a-z]*|depress(ion|ive)|anxiety|adhd|autis[a-z]*|bipolar|schizo[a-z]*|psychiatr[a-z]*|therap(y|ist|ies)|counsel[l]?ing|prescription|refill|dosage|symptom[s]?|diagnos[a-z]*|medical|clinic(al)?|patient|treatment|medication|pharmac[a-z]*|fertility|pregnan(t|cy)|menstrua[a-z]*|abortion|contracept[a-z]*|disab(led|ility)|addiction|rehab|relapse|overdose|vaccin[a-z]*|immuni[sz][a-z]*|mental[_-]?health|health[_-]?(data|record|records|condition|status|history|tracking|tracker|log|profile)',
  ),
  tokens(
    'sex_life_or_orientation',
    'gay|lesbian|bisexual|transgender|nonbinary|lgbt|lgbtq|lgbtq\\+|queer|grindr|sexual[_-]?orientation|coming[_-]?out|hookup|sexual[_-]?(health|activity|partner)|escort|porn[a-z]*|nsfw|dating[_-]?preference',
  ),
  tokens(
    'religion',
    'religio[a-z]*|muslim|islam(ic)?|christian|catholic|protestant|jewish|jud(aism|aic)|hindu|buddhis[tm]|sikh|atheis[tm]|prayer|quran|koran|bible|torah|mosque|church|synagogue|halal|kosher|ramadan|shabbat|baptism|confession',
  ),
  tokens(
    'political_opinion',
    'political[_-]?(party|affiliation|view|opinion)|vote[dr]?|voting|ballot|election|democrat|republican|labour[_-]?party|conservative[_-]?party|socialis[tm]|communis[tm]|fascis[tm]|activis[tm]|protest|petition|campaign[_-]?donat[a-z]*',
  ),
  tokens(
    'trade_union',
    'trade[_-]?union|labor[_-]?union|labour[_-]?union|unioni[sz]ed?|collective[_-]?bargaining|strike[_-]?action|shop[_-]?steward',
  ),
  tokens(
    'racial_or_ethnic_origin',
    'rac(e|ial)|ethnic[a-z]*|nationality|immigrat[a-z]*|migrant|refugee|asylum|indigenous|caste|skin[_-]?tone|latin[ox]|hispanic',
  ),
  tokens(
    'biometric_or_genetic',
    'fingerprint|faceprint|facial[_-]?(recognition|template)|iris[_-]?scan|retina|voiceprint|dna|genom[a-z]*|genetic|biometric|23andme|ancestry[_-]?test',
  ),
  tokens(
    'criminal_offence',
    'criminal[_-]?(record|history|conviction)|conviction|arrest(ed)?|probation|parole|felony|misdemeano(u)?r|incarcerat[a-z]*|prison',
  ),
  tokens(
    'childrens_data',
    'kid|kids|child|children|toddler|preschool|kindergarten|teen|teenager|under[_-]?1[38]|parental[_-]?(consent|control)|guardian[_-]?consent|school[_-]?grade|classroom',
  ),
];

export interface ScreenResult {
  /** True when nothing matched. */
  clean: boolean;
  categories: SensitiveCategory[];
  /** Which inputs tripped which rule. Surfaced to the developer so they can rename. */
  matches: Array<{ field: string; category: SensitiveCategory; value: string }>;
}

/**
 * Screen the identifying surface of an event: its name, any path-like properties, and
 * property keys. Property *values* are screened too, but only strings — a numeric value
 * carries no category signal on its own.
 */
export function screenEvent(input: {
  name: string;
  properties?: Record<string, unknown>;
}): ScreenResult {
  const matches: ScreenResult['matches'] = [];

  const consider = (field: string, value: string): void => {
    for (const { category, pattern } of SIGNALS) {
      // Patterns are non-global, so lastIndex cannot leak between calls.
      if (pattern.test(value)) matches.push({ field, category, value });
    }
  };

  consider('name', input.name);

  for (const [key, raw] of Object.entries(input.properties ?? {})) {
    consider(`properties.${key}`, key);
    if (typeof raw === 'string') consider(`properties.${key}`, raw);
  }

  const categories = [...new Set(matches.map((m) => m.category))];
  return { clean: matches.length === 0, categories, matches };
}

/**
 * Screen a workspace's own identity — app name, description, declared vertical, host.
 *
 * This is the Schrems limb. If the app is *itself* revealing, no amount of event-level
 * scrubbing helps, because membership is the disclosure. Such workspaces are barred from
 * the co-op entirely rather than filtered event by event.
 */
export function screenWorkspace(input: {
  appName?: string;
  description?: string;
  vertical?: string;
  hostname?: string;
}): ScreenResult {
  const matches: ScreenResult['matches'] = [];

  for (const [field, value] of Object.entries(input)) {
    if (typeof value !== 'string' || !value) continue;
    for (const { category, pattern } of SIGNALS) {
      if (pattern.test(value)) matches.push({ field, category, value });
    }
  }

  const categories = [...new Set(matches.map((m) => m.category))];
  return { clean: matches.length === 0, categories, matches };
}

/**
 * Restrict purposes in light of a screening result.
 *
 * Fail-closed: anything flagged keeps first-party analytics only. The developer still
 * sees their own numbers — they have their own lawful basis for that and it is their
 * data — but the event can never reach a cross-workspace aggregate or a licensed dataset.
 *
 * Children's data is treated the same way here, but note it is a *different* legal
 * problem: under COPPA the disclosure of a child's data to third parties needs separate
 * verifiable parental consent (16 CFR 312.5(a)(2)), which we are in no position to
 * obtain. Excluding it from the co-op is the only defensible posture.
 */
export function restrictPurposes(
  permitted: readonly ConsentPurpose[],
  screen: ScreenResult,
): ConsentPurpose[] {
  if (screen.clean) return [...permitted];
  return permitted.filter((p) => p === 'product_analytics');
}

/** Human-readable explanation for the developer-facing warning. */
export function explainScreen(screen: ScreenResult): string | null {
  if (screen.clean) return null;
  const list = screen.categories.join(', ');
  return (
    `This event looks like it may reveal special-category data (${list}). ` +
    'It still counts toward your own analytics, but it is excluded from benchmarks and ' +
    'from any licensed dataset. Rename the event if this is a false positive.'
  );
}
