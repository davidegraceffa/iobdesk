import type { CoverLetterDraft, CvStructure, JobAnalysis, TechStack } from '@jobagg/shared';

const LANGUAGE_NAMES: Record<string, string> = {
  it: 'Italian',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  pt: 'Portuguese',
  nl: 'Dutch',
};

const MAX_JOB_CHARS = 9000;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text;
}

export interface CvPromptJob {
  title: string;
  company: string;
  descriptionText: string;
  seniority: string;
  techStack: TechStack;
}

export function buildAnalysisPrompt(job: CvPromptJob): { system: string; user: string } {
  return {
    system: [
      'You analyse a job posting to prepare a tailored CV.',
      'Respond ONLY with a JSON object of this shape:',
      '{"requiredRequirements": string[], "preferredRequirements": string[], "atsKeywords": string[], "seniority": string}',
      '- requiredRequirements: must-have requirements, each a short phrase taken from the posting.',
      '- preferredRequirements: nice-to-have requirements.',
      '- atsKeywords: the exact keywords an applicant tracking system would look for (technologies, methods, role terms).',
      'Use only what is written in the posting. Do not add requirements that are not there.',
    ].join('\n'),
    user: `Job title: ${job.title}\nCompany: ${job.company}\n\n${clip(job.descriptionText, MAX_JOB_CHARS)}`,
  };
}

export interface CvEditsPromptInput {
  language: string;
  job: CvPromptJob;
  analysis: JobAnalysis;
  structure: CvStructure;
  extraSkills: string[];
  userInstructions?: string;
  /** presente nei tentativi successivi: il risultato precedente superava le pagine del CV base */
  shortenBecause?: { pages: number; maxPages: number };
}

export function buildCvEditsPrompt(input: CvEditsPromptInput): { system: string; user: string } {
  const language = LANGUAGE_NAMES[input.language] ?? input.language;
  const system = [
    'You tailor an existing CV to a specific job posting by proposing edits to its paragraphs.',
    'The CV keeps its exact visual style: you only change paragraph text, reorder, remove or clone existing paragraphs.',
    '',
    'Respond ONLY with a JSON object of this TypeScript type:',
    '{',
    '  "edits": Array<',
    '    | { "op": "replace", "paragraphId": string, "newText": string, "sourceParagraphIds": string[], "extraSkills"?: string[], "reason": string }',
    '    | { "op": "reorder", "sectionId": string, "paragraphIds": string[], "reason": string }',
    '    | { "op": "remove", "paragraphId": string, "reason": string }',
    '    | { "op": "insert_after", "afterParagraphId": string, "cloneStyleFrom": string, "newText": string, "sourceParagraphIds": string[], "extraSkills"?: string[], "reason": string }',
    '  >,',
    '  "gaps": Array<{ "requirement": string, "importance": "required" | "preferred", "suggestion": string }>,',
    '  "matchSummary": { "covered": string[], "partiallyCovered": string[], "missing": string[] }',
    '}',
    '',
    'NON-NEGOTIABLE RULES',
    '1. No invention. You may rephrase, reorder, emphasise, shorten and select content that already exists in the CV or in the',
    "   candidate's additional skills list. Never add technologies, roles, companies, dates, degrees, certifications or numbers",
    '   that are not there. Every "replace" and "insert_after" must cite where each fact comes from: "sourceParagraphIds"',
    '   (ids of CV paragraphs) and/or "extraSkills" (entries copied verbatim from the additional skills list).',
    '   Edits without a valid source, or mentioning anything absent from the CV, are discarded automatically.',
    '2. Only paragraphs with "mutable": true can be replaced, removed, reordered or used as "cloneStyleFrom".',
    '   Name, contacts, dates, company names, job titles and education are immutable.',
    '3. Same length. The result must not be longer than the original CV: when you replace a paragraph keep about the same',
    '   number of characters; if you insert a paragraph, remove or shorten another one.',
    `4. Language. Write every "newText" in ${language}, the language of this CV, even if the posting is in another language.`,
    "   Map the posting's requirements onto what the candidate actually did; do not translate the posting literally.",
    '   "reason", "gaps" and "matchSummary" must be written in Italian.',
    '5. "reorder" lists paragraphs of ONE section in the new order; they must be adjacent items of the same list.',
    '6. Requirements the CV does not cover go in "gaps" as suggestions for the candidate (for example: "Se hai esperienza',
    '   con Kubernetes, aggiungila alle competenze aggiuntive nel Profilo"). Never insert them in the CV.',
    '',
    'TYPICAL EDITS',
    '- Rewrite the summary/profile for this role.',
    '- Reorder and filter the skills section by relevance, keeping the existing grouping.',
    "- Reorder and rephrase experience bullets to highlight what the posting asks for, using the posting's own keywords",
    '  only when they describe something the candidate really did.',
    'Propose only edits that improve the match. If a paragraph is already good, leave it alone.',
  ].join('\n');

  // la parte iniziale con nome e contatti non serve al modello e non viene inviata
  const sections = input.structure.sections
    .filter((section) => section.type !== 'personal')
    .map((section) => ({
      id: section.id,
      type: section.type,
      title: section.title,
      paragraphs: section.paragraphIds
        .map((id) => input.structure.paragraphs.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ id: p.id, text: p.text, bullet: p.isBullet, mutable: p.mutable && p.editable })),
    }));

  const payload = {
    cvLanguage: input.language,
    job: {
      title: input.job.title,
      company: input.job.company,
      seniority: input.job.seniority,
      techStack: input.job.techStack,
      requiredRequirements: input.analysis.requiredRequirements,
      preferredRequirements: input.analysis.preferredRequirements,
      atsKeywords: input.analysis.atsKeywords,
      description: clip(input.job.descriptionText, MAX_JOB_CHARS),
    },
    cv: { sections },
    additionalSkills: input.extraSkills,
    candidateInstructions: input.userInstructions?.trim() || null,
  };

  const shorten = input.shortenBecause
    ? `\n\nIMPORTANT: your previous proposal produced a ${input.shortenBecause.pages}-page PDF, but the original CV has ${input.shortenBecause.maxPages} page(s). Propose a more concise version: shorter replacements, no insertions, remove the least relevant bullets.`
    : '';
  return { system, user: `${JSON.stringify(payload, null, 1)}${shorten}` };
}

/** Riepilogo leggibile di ciò che viene inviato all'LLM, mostrato all'utente prima di generare. */
export function describePayload(hasExtraSkills: boolean, hasInstructions: boolean): string[] {
  return [
    'Titolo, azienda e descrizione dell’annuncio',
    'Il testo del tuo CV base nella lingua scelta: sommario, competenze, esperienze, formazione (la parte iniziale con nome e contatti non viene inviata)',
    ...(hasExtraSkills ? ['Le competenze ed esperienze aggiuntive indicate nel Profilo'] : []),
    ...(hasInstructions ? ['Le tue istruzioni aggiuntive'] : []),
  ];
}

export interface CoverLetterPromptInput {
  language: string;
  job: CvPromptJob;
  structure: CvStructure;
  extraSkills: string[];
  userInstructions?: string;
  /** presente nel secondo tentativo: tecnologie citate nella prima proposta ma assenti dal CV */
  inventedTechnologies?: string[];
}

export function buildCoverLetterPrompt(input: CoverLetterPromptInput): { system: string; user: string } {
  const language = LANGUAGE_NAMES[input.language] ?? input.language;
  const system = [
    'You write a cover letter for a specific job posting on behalf of a candidate, using only the facts in their CV.',
    '',
    'Respond ONLY with a JSON object of this TypeScript type:',
    '{ "subject": string, "greeting": string, "paragraphs": string[], "closing": string }',
    '- subject: the subject line of the letter, naming the role (for example "Application for Senior Backend Engineer").',
    '- greeting: the salutation, addressed to the hiring team of the company (no invented person names).',
    '- paragraphs: 3 or 4 paragraphs of plain text, 220 to 320 words in total.',
    '- closing: only the closing formula (for example "Kind regards,"). Do NOT add the candidate name or contact details:',
    '  the signature is added automatically.',
    '',
    'NON-NEGOTIABLE RULES',
    '1. No invention. Every statement about the candidate must come from the CV or from the additional skills list.',
    '   Never attribute to the candidate technologies, roles, companies, years of experience, degrees, certifications,',
    '   numbers or results that are not there. If the posting asks for something the candidate does not have, do not',
    '   mention it at all: no apologies, no promises to learn it, no claims of familiarity.',
    '2. Specific, not generic. Open with the role and the company, then connect two or three requirements of the posting',
    '   to concrete experiences from the CV (what was done, where, with which technologies). State why this role and this',
    '   company, using only what the posting says about them. Do not repeat the CV as a list.',
    '3. Tone: professional, direct, first person, no clichés ("I am writing to express my interest", "team player",',
    '   "passionate"), no flattery, no exclamation marks, no placeholders in square brackets.',
    `4. Language. Write the whole letter in ${language}, even if the CV or the posting are in another language, following`,
    '   the conventions of business letters in that language.',
    '5. Plain text only: no markdown, no bullet lists, no headings.',
  ].join('\n');

  // come per il CV: la parte iniziale con nome e contatti non viene inviata
  const sections = input.structure.sections
    .filter((section) => section.type !== 'personal')
    .map((section) => ({
      type: section.type,
      title: section.title,
      paragraphs: section.paragraphIds
        .map((id) => input.structure.paragraphs.find((p) => p.id === id)?.text.trim())
        .filter((text): text is string => !!text),
    }));

  const payload = {
    letterLanguage: input.language,
    job: {
      title: input.job.title,
      company: input.job.company,
      seniority: input.job.seniority,
      techStack: input.job.techStack,
      description: clip(input.job.descriptionText, MAX_JOB_CHARS),
    },
    cv: { sections },
    additionalSkills: input.extraSkills,
    candidateInstructions: input.userInstructions?.trim() || null,
  };

  const retry = input.inventedTechnologies?.length
    ? `\n\nIMPORTANT: your previous letter mentioned technologies that are not in the CV nor in the additional skills: ${input.inventedTechnologies.join(', ')}. Write the letter again without mentioning them.`
    : '';
  return { system, user: `${JSON.stringify(payload, null, 1)}${retry}` };
}

/** Testo modificabile della lettera: saluto, paragrafi, chiusura e firma, separati da righe vuote. */
export function composeLetterBody(draft: CoverLetterDraft, candidateName: string): string {
  const closing = [draft.closing.trim(), candidateName.trim()].filter(Boolean).join('\n');
  return [draft.greeting.trim(), ...draft.paragraphs.map((p) => p.trim()), closing].filter(Boolean).join('\n\n');
}

/** Riepilogo leggibile di ciò che viene inviato all'LLM per scrivere la lettera. */
export function describeLetterPayload(hasExtraSkills: boolean): string[] {
  return [
    'Titolo, azienda e descrizione dell’annuncio',
    'Il testo del tuo CV base: sommario, competenze, esperienze, formazione (la parte iniziale con nome e contatti non viene inviata: intestazione e firma vengono aggiunte in locale)',
    ...(hasExtraSkills ? ['Le competenze ed esperienze aggiuntive indicate nel Profilo'] : []),
    'Le tue istruzioni aggiuntive, se le scrivi',
  ];
}

export interface CvEmailPromptInput {
  language: string;
  job: CvPromptJob;
  structure: CvStructure;
  extraSkills: string[];
  userInstructions?: string;
  /** presente nel secondo tentativo: tecnologie citate nella prima proposta ma assenti dal CV */
  inventedTechnologies?: string[];
}

/** Email breve con cui inviare il CV in allegato: non una lettera di candidatura. */
export function buildCvEmailPrompt(input: CvEmailPromptInput): { system: string; user: string } {
  const language = LANGUAGE_NAMES[input.language] ?? input.language;
  const system = [
    'You write the short email a candidate sends to apply for a job, with the CV attached. It is the text of the email itself, not a cover letter.',
    '',
    'Respond ONLY with a JSON object of this TypeScript type:',
    '{ "subject": string, "greeting": string, "paragraphs": string[], "closing": string }',
    '- subject: the email subject, naming the role (for example "Application for Senior Backend Engineer").',
    '- greeting: the salutation, addressed to the hiring team of the company (no invented person names).',
    '- paragraphs: 2 or 3 short paragraphs, 70 to 120 words in total: which role the candidate is applying for; one or',
    '  two concrete reasons, taken from the CV, why the profile fits what the posting asks; that the CV is attached and',
    '  the candidate is available for a call.',
    '- closing: only the closing formula (for example "Kind regards,"). Do NOT add the candidate name or contact details:',
    '  the signature is added automatically.',
    '',
    'RULES',
    '1. No invention. Every statement about the candidate must come from the CV or from the additional skills list:',
    '   no technologies, roles, companies, years of experience or results that are not there. Do not mention',
    '   requirements of the posting that the candidate does not cover.',
    '2. Brief and direct, first person, professional but natural: no clichés, no flattery, no exclamation marks, no',
    '   placeholders in square brackets. Do not summarise the whole CV: it is attached.',
    `3. Write the whole email in ${language}, following the conventions of business emails in that language.`,
    '4. Plain text only: no markdown, no bullet lists.',
  ].join('\n');

  // come per il CV: la parte iniziale con nome e contatti non viene inviata
  const sections = input.structure.sections
    .filter((section) => section.type !== 'personal')
    .map((section) => ({
      type: section.type,
      title: section.title,
      paragraphs: section.paragraphIds
        .map((id) => input.structure.paragraphs.find((p) => p.id === id)?.text.trim())
        .filter((text): text is string => !!text),
    }));
  const payload = {
    emailLanguage: input.language,
    job: {
      title: input.job.title,
      company: input.job.company,
      techStack: input.job.techStack,
      description: clip(input.job.descriptionText, MAX_JOB_CHARS),
    },
    cv: { sections },
    additionalSkills: input.extraSkills,
    candidateInstructions: input.userInstructions?.trim() || null,
  };
  const retry = input.inventedTechnologies?.length
    ? `\n\nIMPORTANT: your previous email mentioned technologies that are not in the CV nor in the additional skills: ${input.inventedTechnologies.join(', ')}. Write the email again without mentioning them.`
    : '';
  return { system, user: `${JSON.stringify(payload, null, 1)}${retry}` };
}

export interface CvReviewPromptInput {
  language: string;
  structure: CvStructure;
  target: { title: string; summary: string; keywords: string[] };
  extraSkills: string[];
  /** tecnologie molto richieste negli annunci compatibili e assenti dal CV */
  market: Array<{ name: string; jobs: number }>;
  /** requisiti che i CV su misura non hanno potuto coprire */
  gaps: Array<{ requirement: string; count: number }>;
  /** titoli di proposte già fatte o scartate dall'utente: non vanno ripetute */
  alreadyHandled: string[];
}

/** Revisione periodica del CV base: cosa è migliorabile, con proposte concrete. */
export function buildCvReviewPrompt(input: CvReviewPromptInput): { system: string; user: string } {
  const language = LANGUAGE_NAMES[input.language] ?? input.language;
  const system = [
    'You are an experienced recruiter and CV reviewer. You review the base CV of a candidate against the kind of roles they are looking for and propose concrete improvements.',
    '',
    'Respond ONLY with a JSON object of this TypeScript type:',
    '{ "summary": string, "suggestions": Array<{ "kind": "rewrite" | "add" | "remove" | "structure", "title": string, "reason": string, "priority": "high" | "medium" | "low", "edit"?: Edit }> }',
    'type Edit =',
    '  | { "op": "replace", "paragraphId": string, "newText": string, "sourceParagraphIds": string[], "extraSkills"?: string[] }',
    '  | { "op": "remove", "paragraphId": string }',
    '  | { "op": "reorder", "sectionId": string, "paragraphIds": string[] }',
    '  | { "op": "insert_after", "afterParagraphId": string, "cloneStyleFrom": string, "newText": string, "sourceParagraphIds": string[], "extraSkills"?: string[] }',
    '- summary: two or three sentences in Italian on how the CV works today for the target roles and what matters most to fix.',
    '- suggestions: at most 10, the most useful first. "title" and "reason" in Italian; "title" is a short imperative phrase, "reason" explains the benefit in one or two sentences.',
    '- "edit" is the exact change to the document that implements the suggestion: the application applies it automatically and produces a new version of the CV. Give an "edit" whenever the suggestion can be carried out with the facts already available; ONE edit per suggestion.',
    '  * "rewrite" (edit "replace"): a paragraph that would read better rephrased (vague wording, responsibilities instead of results, buried key point, too long).',
    `    "newText" is the full new text of that paragraph in ${language}, about the same length. "sourceParagraphIds" lists the paragraphs the facts come from (at least the paragraph itself).`,
    '  * "remove" (edit "remove"): a paragraph that weakens the CV for the target roles (outdated, irrelevant, redundant).',
    '  * "structure" (edit "reorder"): a better order for adjacent items of ONE section (for example the most relevant bullets or skills first): "paragraphIds" lists them in the new order. Structural advice that cannot be expressed as a reorder (length, consistency, section order) has no "edit".',
    `  * "add" with edit "insert_after": a new paragraph in ${language} built ONLY from the additional skills list (cite the entries verbatim in "extraSkills") and/or from other CV paragraphs ("sourceParagraphIds"); "cloneStyleFrom" is an existing paragraph of the same kind whose formatting the new one copies. Use it to bring into the CV the additional skills that the target roles ask for.`,
    '  * "add" WITHOUT edit: something worth adding only IF it is true for the candidate and that is neither in the CV nor in the additional skills (a skill the target roles ask for, a missing result or metric). Phrase "title" as a question or condition (for example "Se hai esperienza con Kubernetes, aggiungila").',
    '',
    'RULES',
    '1. No invention. An edit may only rephrase, reorder, select or remove what is in the CV, or use entries of the additional skills list: never technologies, roles, companies, dates, numbers or results that are not there. Edits that mention anything absent from their sources are discarded automatically. If a number would make a bullet stronger but is missing, ask for it with an "add" suggestion without edit.',
    '2. Only paragraphs with "mutable": true can be replaced, removed, reordered or used as "cloneStyleFrom". Name, contacts, dates, company names, job titles and education are immutable.',
    '3. Do not make the CV longer: when you insert a paragraph, prefer suggestions that also shorten or remove something else. Two suggestions must not edit the same paragraph.',
    '4. Be specific to this CV and to the target roles: no generic advice that would apply to any CV. If the CV is already good on a point, do not comment on it.',
    '5. Use the market data: technologies often requested in matching postings and requirements that tailored CVs could not cover are the best candidates for "add" suggestions: with an edit if the candidate already declared them in the additional skills, as a question otherwise.',
    '6. Do not repeat suggestions the candidate has already handled (listed in "alreadyHandled").',
  ].join('\n');

  const sections = input.structure.sections
    .filter((section) => section.type !== 'personal')
    .map((section) => ({
      type: section.type,
      id: section.id,
      title: section.title,
      paragraphs: section.paragraphIds
        .map((id) => input.structure.paragraphs.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ id: p.id, text: p.text, bullet: p.isBullet, mutable: p.mutable && p.editable })),
    }));
  const payload = {
    cvLanguage: input.language,
    target: input.target,
    cv: { sections },
    additionalSkills: input.extraSkills,
    market: {
      technologiesOftenRequestedAndMissing: input.market,
      requirementsNotCoveredByTailoredCvs: input.gaps,
    },
    alreadyHandled: input.alreadyHandled,
  };
  return { system, user: JSON.stringify(payload, null, 1) };
}

/** Fatti sul documento ricavati in locale: l'LLM non vede il file, solo il testo. */
export interface CvAtsFacts {
  fileFormat: 'docx';
  pages: number;
  words: number;
  sectionsRecognised: string[];
  standardSectionsMissing: string[];
  paragraphs: number;
  paragraphsInTextBoxes: number;
  paragraphsWithImagesOrObjects: number;
  paragraphsWithLinksOrFields: number;
  bullets: number;
  emailFound: boolean;
  phoneFound: boolean;
}

export function atsFacts(structure: CvStructure, pages: number): CvAtsFacts {
  const body = structure.paragraphs.filter((p) => !p.isHeading);
  const types = [...new Set(structure.sections.map((s) => s.type))];
  const personal = structure.sections.find((s) => s.type === 'personal');
  const personalText = (personal?.paragraphIds ?? [])
    .map((id) => structure.paragraphs.find((p) => p.id === id)?.text ?? '')
    .join('\n');
  const reason = (re: RegExp) => structure.paragraphs.filter((p) => re.test(p.notEditableReason ?? '')).length;
  return {
    fileFormat: 'docx',
    pages,
    words: body.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0),
    sectionsRecognised: types.filter((t) => t !== 'personal'),
    standardSectionsMissing: (['summary', 'skills', 'experience', 'education'] as const).filter(
      (t) => !types.includes(t),
    ),
    paragraphs: structure.paragraphs.length,
    paragraphsInTextBoxes: structure.paragraphs.filter((p) => p.inTextBox).length,
    paragraphsWithImagesOrObjects: reason(/immagine|oggetto|casella/i),
    paragraphsWithLinksOrFields: reason(/link|campo/i),
    bullets: structure.paragraphs.filter((p) => p.isBullet).length,
    emailFound: /\S+@\S+\.\S+/.test(personalText),
    phoneFound: /\+?\d[\d\s()./-]{7,}/.test(personalText),
  };
}

export interface CvAtsPromptInput {
  language: string;
  structure: CvStructure;
  facts: CvAtsFacts;
  target: { title: string; summary: string; keywords: string[] };
  /** tecnologie molto richieste negli annunci compatibili e assenti dal CV */
  market: Array<{ name: string; jobs: number }>;
}

/** Valutazione di come un ATS leggerebbe e classificherebbe il CV per i ruoli cercati. */
export function buildCvAtsPrompt(input: CvAtsPromptInput): { system: string; user: string } {
  const system = [
    'You are an expert in applicant tracking systems (Workday, Greenhouse, Lever, Taleo, iCIMS, SmartRecruiters). You assess how well an ATS would parse a CV and how it would rank it for the roles the candidate targets.',
    '',
    'Respond ONLY with a JSON object of this TypeScript type:',
    '{ "score": number, "summary": string, "categories": Array<{ "name": string, "score": number, "comment": string }>, "issues": Array<{ "severity": "high" | "medium" | "low", "title": string, "fix": string }>, "keywordsPresent": string[], "keywordsMissing": string[] }',
    '- All texts in Italian. Scores are integers from 0 to 100.',
    '- categories: exactly these five, in this order: "Leggibilità per il parser" (layout and file facts), "Struttura e sezioni" (standard headings, order, dates and job titles easy to extract), "Parole chiave" (coverage of the keywords of the target roles, exact terms and common variants), "Contenuto delle esperienze" (clear titles, companies, dates, results an ATS and a recruiter can match), "Lunghezza e formato" (pages, density, bullets). "comment": one or two sentences.',
    '- score: overall ATS compatibility, a weighted judgement of the five categories with keywords and parser readability counting most. Be honest: do not inflate.',
    '- issues: the concrete problems, most severe first, at most 8. "fix": what to change, specifically. Do not list things that are already fine.',
    '- keywordsPresent / keywordsMissing: keywords of the target roles (from the target and from the technologies often requested in matching postings) that the CV does or does not contain, as an ATS would match them. A keyword counts as missing only if it is really absent from the text.',
    '',
    'RULES',
    '1. You only see the text of the CV, not the file. For everything about layout rely ONLY on "documentFacts" (computed from the DOCX): text boxes and images are what parsers handle worst; a DOCX file is well supported. Do not invent layout problems that the facts do not show (you cannot know about fonts, colours, columns or tables).',
    '2. The initial part with name and contacts is not shown to you for privacy: "emailFound" and "phoneFound" tell you whether they are there. Do not report them as missing if they are found.',
    '3. Judge against the target roles given, not in the abstract.',
  ].join('\n');
  const sections = input.structure.sections
    .filter((section) => section.type !== 'personal')
    .map((section) => ({
      type: section.type,
      title: section.title,
      paragraphs: section.paragraphIds
        .map((id) => input.structure.paragraphs.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ text: p.text, bullet: p.isBullet, inTextBox: !!p.inTextBox })),
    }));
  const payload = {
    cvLanguage: input.language,
    target: input.target,
    technologiesOftenRequestedAndMissing: input.market,
    documentFacts: input.facts,
    cv: { sections },
  };
  return { system, user: JSON.stringify(payload, null, 1) };
}
