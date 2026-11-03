import { execFileSync } from 'node:child_process';

/** Builds dist/ so the CLI tests can run the compiled entry point on any supported Node. */
export default function setup() {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
}
