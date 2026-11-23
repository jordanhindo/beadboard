/**
 * The project BeadBoard shows when a request does not name one.
 *
 * `beadboard start` runs the Next.js server inside the BeadBoard install
 * directory, so the server working directory is not the user's project.
 * The launcher passes the directory it was run from in BB_PROJECT_ROOT.
 * Without it (for example plain `npm run dev`), the working directory is used.
 */
export function getCurrentProjectRoot(): string {
  const fromEnv = process.env.BB_PROJECT_ROOT?.trim();
  return fromEnv || process.cwd();
}
