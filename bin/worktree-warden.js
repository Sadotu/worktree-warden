#!/usr/bin/env node
// bin/worktree-warden.js
import { main } from '../src/cli.js';

const exitCode = main(process.argv.slice(2));
if (typeof exitCode === 'number') {
  process.exitCode = exitCode;
}
