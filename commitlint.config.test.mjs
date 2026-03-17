import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import lint from '@commitlint/lint';
import load from '@commitlint/load';

const config = await load({ extends: ['@commitlint/config-conventional'] });
const { rules, parserPreset } = config;
const opts = parserPreset ? { parserOpts: parserPreset.parserOpts } : {};

async function lintMessage(message) {
  return lint(message, rules, opts);
}

describe('commitlint config', () => {
  describe('valid messages', () => {
    const validMessages = [
      'feat: add new feature',
      'fix: resolve crash on startup',
      'docs: update README',
      'style: format code',
      'refactor: extract helper function',
      'test: add unit tests',
      'chore: update dependencies',
      'feat(ui): add dark mode toggle',
      'fix(simulator): correct pathfinding edge case',
      'feat!: breaking change to API',
      'feat(adapter)!: remove deprecated endpoint',
    ];

    for (const msg of validMessages) {
      it(`should accept: "${msg}"`, async () => {
        const result = await lintMessage(msg);
        assert.equal(result.valid, true, `Expected valid but got errors: ${result.errors.map((e) => e.message).join(', ')}`);
      });
    }
  });

  describe('invalid messages', () => {
    const invalidMessages = [
      { msg: 'bad commit message', reason: 'missing type and colon' },
      { msg: 'FEAT: uppercase type', reason: 'type must be lowercase' },
      { msg: 'feat:missing space after colon', reason: 'missing space after colon' },
      { msg: 'foo: unknown type', reason: 'invalid type' },
      { msg: ': missing type', reason: 'empty type' },
    ];

    for (const { msg, reason } of invalidMessages) {
      it(`should reject (${reason}): "${msg}"`, async () => {
        const result = await lintMessage(msg);
        assert.equal(result.valid, false, `Expected invalid but message was accepted`);
        assert.ok(result.errors.length > 0, 'Expected at least one error');
      });
    }
  });
});
