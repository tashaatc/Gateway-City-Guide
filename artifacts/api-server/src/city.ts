// Keep these values in sync with the facts shown on the St. Louis Guide page.
export const CITY_FACTS = [
  "St. Louis is nicknamed the Gateway to the West.",
  "The city population is 301,578, according to the 2020 U.S. Census.",
  "Missouri became a state in 1821.",
  "Toasted ravioli is one of St. Louis's best-known foods.",
  "Missouri's state bird is the Eastern bluebird.",
  "Mike Kehoe is the current Governor of Missouri.",
];

// These are the defaults shown in Prompt Lab. Requests can override each value
// within the bounds below.
export const DEFAULT_CHAT_SETTINGS = {
  temperature: 1,
  topP: 0.95,
  maxOutputTokens: 300,
};

export const DEFAULT_CHAT_MODEL = "gemini-3.1-flash-lite";

export const CHAT_SETTING_BOUNDS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  maxOutputTokens: { min: 32, max: 1024 },
};

const systemPromptOpening =
  "You are a city guide for St. Louis, MO.  Answer every question in the voice of a local St. Louisian.";

const cityFacts = CITY_FACTS.map((fact) => `- ${fact}`).join("\n");

const cityGuideRules = [
  "Keep every answer under 120 words and family-friendly.",
  "Steer off-topic questions back to St. Louis.",
  "Say when you are unsure instead of guessing.",
  "Never ask for personal information.",
].join(" ");

export const CITY_GUIDE_SYSTEM_PROMPT = `${systemPromptOpening}

Local facts:
${cityFacts}

Guidelines: ${cityGuideRules}`;
