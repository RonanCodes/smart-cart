// Enforces the emoji + conventional commit format documented in CLAUDE.md:
//   <emoji> <type>(<scope>)?: <subject>
// Emoji must be one of the 10 mapped below and must match its type.

const EMOJI_TYPE_MAP = {
  '✨': 'feat',
  '🐛': 'fix',
  '🧪': 'test',
  '📝': 'docs',
  '🧹': 'chore',
  '♻️': 'refactor',
  '🚀': 'deploy',
  '🔧': 'config',
  '⚡': 'perf',
  '🔒': 'security',
}

const ALLOWED_TYPES = Object.values(EMOJI_TYPE_MAP)
const ALLOWED_EMOJI = Object.keys(EMOJI_TYPE_MAP)

const HEADER_PATTERN = /^(\S+) (\w+)(?:\(([^)]+)\))?: (.+)$/u

export default {
  parserPreset: {
    parserOpts: {
      headerPattern: HEADER_PATTERN,
      headerCorrespondence: ['emoji', 'type', 'scope', 'subject'],
    },
  },
  plugins: [
    {
      rules: {
        'emoji-allowed': ({ emoji }) => {
          if (!emoji) {
            return [
              false,
              `Commit must start with an emoji. Allowed: ${ALLOWED_EMOJI.join(' ')}`,
            ]
          }
          if (!ALLOWED_EMOJI.includes(emoji)) {
            return [
              false,
              `Emoji "${emoji}" not allowed. Use one of: ${ALLOWED_EMOJI.join(' ')}`,
            ]
          }
          return [true]
        },
        'emoji-type-matches': ({ emoji, type }) => {
          if (!emoji || !type) return [true]
          const expected = EMOJI_TYPE_MAP[emoji]
          if (expected && expected !== type) {
            return [
              false,
              `Emoji "${emoji}" must be paired with type "${expected}", got "${type}"`,
            ]
          }
          return [true]
        },
      },
    },
  ],
  rules: {
    'emoji-allowed': [2, 'always'],
    'emoji-type-matches': [2, 'always'],
    'type-enum': [2, 'always', ALLOWED_TYPES],
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
  },
  ignores: [
    (msg) => /^Merge (pull request|branch|remote-tracking branch)/.test(msg),
    (msg) => /^Revert /.test(msg),
    (msg) => /^(fixup|squash)! /.test(msg),
  ],
}
