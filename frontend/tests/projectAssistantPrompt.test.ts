import { describe, expect, it } from 'vitest';
import { PROJECT_SCOPED_TEXT_SYSTEM_PROMPT } from '../services/geminiService';

describe('PROJECT_SCOPED_TEXT_SYSTEM_PROMPT', () => {
  it('keeps the shared text assistant scoped to project work', () => {
    expect(PROJECT_SCOPED_TEXT_SYSTEM_PROMPT).toContain('project-scoped creative writing assistant');
    expect(PROJECT_SCOPED_TEXT_SYSTEM_PROMPT).toContain('current project, script, scene');
    expect(PROJECT_SCOPED_TEXT_SYSTEM_PROMPT).toContain('redirect the user back to project-related work');
  });
});
