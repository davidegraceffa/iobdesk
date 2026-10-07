import { describe, expect, it } from 'vitest';
import { canonicalTech, extractTechStack, findTechInText, flattenTechStack, groupTech } from './index';

describe('dizionario tecnologie', () => {
  it('normalizza gli alias sul nome canonico', () => {
    expect(canonicalTech('node')?.name).toBe('Node.js');
    expect(canonicalTech('nodejs')?.name).toBe('Node.js');
    expect(canonicalTech('Node.JS')?.name).toBe('Node.js');
    expect(canonicalTech('postgres')?.name).toBe('PostgreSQL');
    expect(canonicalTech('k8s')?.name).toBe('Kubernetes');
    expect(canonicalTech('golang')?.name).toBe('Go');
    expect(canonicalTech('qualcosa di ignoto')).toBeUndefined();
  });

  it('raggruppa per categoria', () => {
    const stack = extractTechStack({
      title: 'Senior Full-Stack Engineer (TypeScript, React, Node.js)',
      tags: ['postgres', 'aws', 'docker'],
      description:
        'You will build APIs with NestJS and GraphQL, write tests with Jest and Playwright, and ship a React Native app. CI/CD on GitHub Actions.',
    });
    expect(stack.frontend).toEqual(['React']);
    expect(stack.backend).toEqual(expect.arrayContaining(['Node.js', 'NestJS']));
    expect(stack.languages).toEqual(['TypeScript']);
    expect(stack.database).toEqual(['PostgreSQL']);
    expect(stack.cloudDevops).toEqual(expect.arrayContaining(['AWS', 'Docker', 'CI/CD', 'GitHub Actions']));
    expect(stack.testing).toEqual(expect.arrayContaining(['Jest', 'Playwright']));
    expect(stack.mobile).toEqual(['React Native']);
    expect(stack.other).toEqual(['GraphQL']);
  });

  it('match su parole intere, senza falsi positivi', () => {
    expect(findTechInText('We love JavaScript')).toEqual(['JavaScript']); // non "Java"
    expect(findTechInText('Experience with Java and Kotlin')).toEqual(expect.arrayContaining(['Java', 'Kotlin']));
    expect(findTechInText('Experience with Java and Kotlin')).not.toContain('JavaScript');
    expect(findTechInText('React Native developer')).toEqual(['React Native']); // non "React"
    expect(findTechInText('You will react quickly to incidents')).toEqual([]);
    expect(findTechInText('Able to express ideas clearly and rest when needed')).toEqual([]);
    expect(findTechInText('each node in the graph')).toEqual([]);
    expect(findTechInText('a swift response, covered in rust')).toEqual([]);
    expect(findTechInText('C++ and C# services')).toEqual(expect.arrayContaining(['C++', 'C#']));
  });

  it('"Go" solo in contesti tecnici o come Golang', () => {
    expect(findTechInText('Ready to go the extra mile? Go for it!')).not.toContain('Go');
    expect(findTechInText('We go to market fast')).not.toContain('Go');
    expect(findTechInText('Backend written in Go, Python and Rust')).toContain('Go');
    expect(findTechInText('Senior Go Engineer')).toContain('Go');
    expect(findTechInText('Experience with Golang')).toContain('Go');
    expect(extractTechStack({ tags: ['golang'] }).languages).toEqual(['Go']);
  });

  it('i tag della fonte valgono anche per nomi ambigui', () => {
    expect(extractTechStack({ tags: ['react', 'node', 'go', 'rust', 'nest'] })).toMatchObject({
      frontend: ['React'],
      backend: ['Node.js', 'NestJS'],
      languages: ['Go', 'Rust'],
    });
  });

  it('groupTech scarta i nomi sconosciuti (es. risposta LLM)', () => {
    const stack = groupTech(['typescript', 'Kubernetes', 'InventedFramework']);
    expect(flattenTechStack(stack)).toEqual(['TypeScript', 'Kubernetes']);
  });
});
