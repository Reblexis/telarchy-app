/**
 * A rejected promise nobody awaited is logged, never allowed to end the
 * process (docs/infra/deploy.md, "And it shares the database's connection
 * budget"). Node's default for an unhandled rejection is to exit, and an exit
 * drops every request the instance holds; the 2026-09-13 outage was five of
 * them in six minutes.
 */
import { EventEmitter } from 'node:events';
import { installProcessGuards } from '../lib/process-guards';

describe('A REJECTED PROMISE NOBODY AWAITED IS LOGGED, NEVER ALLOWED TO END THE PROCESS', () => {
  let logged: unknown[][];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    logged = [];
    spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  });

  afterEach(() => spy.mockRestore());

  test('installing listens for unhandled rejections, which is what stops Node from exiting on one', () => {
    const target = new EventEmitter();
    installProcessGuards(target);
    expect(target.listenerCount('unhandledRejection')).toBe(1);
  });

  test('an unhandled rejection is logged with its error', () => {
    const target = new EventEmitter();
    installProcessGuards(target);
    const err = new Error('timeout exceeded when trying to connect');
    target.emit('unhandledRejection', err, Promise.resolve());
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(err);
    expect(String(logged[0][0])).toContain('unhandled rejection');
  });

  test('a rejection that is not an Error is still logged', () => {
    const target = new EventEmitter();
    installProcessGuards(target);
    target.emit('unhandledRejection', 'plain string', Promise.resolve());
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('plain string');
  });

  test('installing twice does not log each rejection twice', () => {
    const target = new EventEmitter();
    installProcessGuards(target);
    installProcessGuards(target);
    expect(target.listenerCount('unhandledRejection')).toBe(1);
    target.emit('unhandledRejection', new Error('x'), Promise.resolve());
    expect(logged).toHaveLength(1);
  });

  test('an uncaught synchronous exception is left alone: that one still ends the process', () => {
    const target = new EventEmitter();
    installProcessGuards(target);
    expect(target.listenerCount('uncaughtException')).toBe(0);
  });

  test('the server installs the guards at boot', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const server = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
    expect(server).toMatch(/installProcessGuards\(\)/);
  });
});
