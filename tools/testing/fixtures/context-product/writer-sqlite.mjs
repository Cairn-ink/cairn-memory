// This module is reachable only through the opt-in writer child loader.
import sqlite from 'node:sqlite';
import { observedDatabase } from './writer-journal.mjs';
const journal=globalThis[Symbol.for('product-measure-writer-observer')];
if(!journal)throw Error('observer_not_installed');
export const DatabaseSync=observedDatabase(sqlite.DatabaseSync,journal);
export const { StatementSync, constants, backup }=sqlite;
export default { ...sqlite, DatabaseSync };
