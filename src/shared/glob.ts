/**
 * A small, gitignore-flavoured glob matcher for repository paths.
 *
 * Rules (documented in the options page too):
 * - A pattern matches anywhere in the path unless it starts with "/", which anchors it to the repo root.
 * - A pattern ending in "/" is a directory: it matches everything inside a directory with that name.
 * - A pattern without a trailing "/" also matches a directory of that name (like .gitignore).
 * - `*` matches within one path segment, `**` across segments, `?` one character,
 *   `{a,b}` either alternative, `[0-9]` a character class.
 * - Matching is case-sensitive, so `*Test.java` does not match `Latest.java`.
 * - Blank lines and lines starting with "#" are ignored.
 */

export type PathMatcher = (path: string) => boolean;

const REGEX_SPECIAL = /[.+^$()|\\]/;

function globBodyToRegex(glob: string): string {
  let out = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` -> zero or more directories; a bare `**` -> anything.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let cls = glob.slice(i + 1, close).replace(/\\/g, '\\\\');
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        out += `[${cls}]`;
        i = close;
      }
    } else if (ch === '{') {
      braceDepth++;
      out += '(?:';
    } else if (ch === '}' && braceDepth > 0) {
      braceDepth--;
      out += ')';
    } else if (ch === ',' && braceDepth > 0) {
      out += '|';
    } else if (REGEX_SPECIAL.test(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  // Unbalanced "{" -> treat the rest literally by closing groups (keeps the regex valid).
  out += ')'.repeat(braceDepth);
  return out;
}

/** Returns null for blank lines and comments. */
export function compileGlob(raw: string): PathMatcher | null {
  let pattern = raw.trim();
  if (!pattern || pattern.startsWith('#')) return null;

  const anchored = pattern.startsWith('/');
  if (anchored) pattern = pattern.slice(1);
  const isDir = pattern.endsWith('/');
  if (isDir) pattern = pattern.replace(/\/+$/, '');
  if (!pattern) return null;

  const prefix = anchored ? '^' : '(?:^|/)';
  const suffix = isDir ? '/' : '(?:$|/)';
  let regex: RegExp;
  try {
    regex = new RegExp(prefix + globBodyToRegex(pattern) + suffix);
  } catch {
    return null;
  }
  return (path) => regex.test(path);
}

/** Compiles many patterns into one matcher. Invalid/blank ones are skipped. */
export function compileGlobs(patterns: readonly string[]): PathMatcher {
  const matchers = patterns.map(compileGlob).filter((m): m is PathMatcher => m !== null);
  if (matchers.length === 0) return () => false;
  return (path) => matchers.some((m) => m(path));
}
