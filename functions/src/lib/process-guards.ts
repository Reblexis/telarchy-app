/**
 * A rejected promise nobody awaited is logged, never allowed to end the
 * process (docs/infra/deploy.md, "And it shares the database's connection
 * budget").
 *
 * Node's default for an unhandled rejection is to exit, and an exit drops
 * every request the instance holds and pushes its traffic onto the other
 * instances. Listening for the event is what turns that default off. An
 * uncaught synchronous exception is left alone: that one still ends the
 * process, because nothing says the state it leaves behind is sound.
 */
import type { EventEmitter } from 'node:events';

const installed = new WeakSet<EventEmitter>();

export function installProcessGuards(target: EventEmitter = process): void {
  if (installed.has(target)) return;
  installed.add(target);
  target.on('unhandledRejection', (reason: unknown) => {
    console.error('[process] unhandled rejection, kept serving:', reason);
  });
}
