// Names, symbols and descriptions containing any of these are refused at prepare.
// Matching is case-insensitive on whole words after stripping punctuation, plus
// a substring check for the `contains` list. Edit freely; see docs/LAUNCH.md.
export const BANNED_WORDS: string[] = [
  // impersonation of the platform and big projects
  "official", "airdrop", "giveaway", "claim", "verify", "verified", "support", "admin",
  "pumpfun", "solana foundation", "phantom", "binance", "coinbase",
  // hate speech and slurs (abbreviated list; extend for your audience)
  "nazi", "hitler", "kkk",
  // illegal content
  "cp", "csam", "childporn",
];

// Matched anywhere, even inside other words.
export const BANNED_SUBSTRINGS: string[] = ["childporn", "csam", "seedphrase", "privatekey"];
