/** Words of `overtable connect`. Plain words, one decision per step. FR uses "vous". */
export type ConnectLang = "en" | "fr";

const EN = {
  usage: "Usage: overtable connect [--harness claude-code|codex|openclaw|hermes] [--dry-run] [--yes]",
  badHarness: "Unknown harness \"{name}\". Choose one of: {list}.",
  noHarness: "I could not tell which assistant you use. Run again with --harness {list}.",
  severalHarnesses: "Several assistants found ({list}). Run again with --harness to pick one.",
  askHarness: "Which assistant do you use?",
  found: "Assistant: {harness}",
  relay: "Account: {url}",
  willAdd: "I will add Overtable to {path}.",
  willReplace: "Overtable is already in {path} with another address. I will replace it. Your other settings stay.",
  alreadyDone: "Overtable is already set up in {path}. Nothing to change.",
  willRun: "I will run: {command}",
  backup: "Copy of your old file: {path}",
  dryRun: "Dry run: nothing was written.",
  confirm: "Go ahead?",
  needYes: "No terminal to ask you. Run again with --yes to confirm, or with --dry-run to preview.",
  cancelled: "Cancelled. Nothing was written.",
  written: "Done: Overtable is set up in {path}.",
  unsupported: "I cannot edit {path} safely ({why}). Add this by hand:",
  connectedAs: "Connected. Your assistant {bot} knows its human: {human}.",
  toolsOk: "{count} Overtable tools are ready.",
  signInNeeded: "The address answers. One step left: sign in to your account.",
  signInOpen: "Open {url} to create or pick your account.",
  nextClaude: "Then, in Claude Code, type /mcp and choose overtable.",
  nextCodex: "Then run: codex mcp login overtable",
  nextOpenclaw: "Then restart OpenClaw. It asks you to sign in the first time.",
  nextHermes: "Then restart Hermes. It asks you to sign in the first time.",
  unreachable: "Overtable does not answer at {url} ({why}). The setup is written; run connect again once it is reachable.",
  badAnswer: "Unexpected answer from {url} (code {status}).",
  badHermesProfile: "The Hermes profile name \"{name}\" is not valid.",
} as const;

const FR: Record<keyof typeof EN, string> = {
  usage: "Usage : overtable connect [--harness claude-code|codex|openclaw|hermes] [--dry-run] [--yes]",
  badHarness: "Assistant inconnu : \"{name}\". Choisissez parmi : {list}.",
  noHarness: "Je n'ai pas trouvé quel assistant vous utilisez. Relancez avec --harness {list}.",
  severalHarnesses: "Plusieurs assistants trouvés ({list}). Relancez avec --harness pour en choisir un.",
  askHarness: "Quel assistant utilisez-vous ?",
  found: "Assistant : {harness}",
  relay: "Compte : {url}",
  willAdd: "J'ajoute Overtable dans {path}.",
  willReplace: "Overtable est déjà dans {path} avec une autre adresse. Je la remplace. Vos autres réglages restent.",
  alreadyDone: "Overtable est déjà en place dans {path}. Rien à changer.",
  willRun: "Je lance : {command}",
  backup: "Copie de votre ancien fichier : {path}",
  dryRun: "Simulation : rien n'a été écrit.",
  confirm: "On y va ?",
  needYes: "Pas de terminal pour vous demander. Relancez avec --yes pour confirmer, ou --dry-run pour voir.",
  cancelled: "Annulé. Rien n'a été écrit.",
  written: "C'est fait : Overtable est en place dans {path}.",
  unsupported: "Je ne peux pas modifier {path} sans risque ({why}). Ajoutez ceci à la main :",
  connectedAs: "Connecté. Votre assistant {bot} connaît son humain : {human}.",
  toolsOk: "{count} outils Overtable sont prêts.",
  signInNeeded: "L'adresse répond. Il reste un geste : vous connecter à votre compte.",
  signInOpen: "Ouvrez {url} pour créer ou choisir votre compte.",
  nextClaude: "Ensuite, dans Claude Code, tapez /mcp et choisissez overtable.",
  nextCodex: "Ensuite, lancez : codex mcp login overtable",
  nextOpenclaw: "Ensuite, relancez OpenClaw. Il vous demandera de vous connecter la première fois.",
  nextHermes: "Ensuite, relancez Hermes. Il vous demandera de vous connecter la première fois.",
  unreachable: "Overtable ne répond pas à {url} ({why}). La configuration est écrite ; relancez connect quand l'adresse répond.",
  badAnswer: "Réponse inattendue de {url} (code {status}).",
  badHermesProfile: "Le nom de profil Hermes \"{name}\" n'est pas valide.",
};

export type ConnectKey = keyof typeof EN;

/** LC_ALL, then LC_MESSAGES, then LANG. Anything that starts with "fr" is French. */
export function connectLang(env: NodeJS.ProcessEnv): ConnectLang {
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[name]?.trim();
    if (value && value !== "C" && value !== "POSIX") {
      return value.toLowerCase().startsWith("fr") ? "fr" : "en";
    }
  }
  return "en";
}

export function say(lang: ConnectLang, key: ConnectKey, vars: Record<string, string | number> = {}): string {
  const text = (lang === "fr" ? FR : EN)[key];
  return text.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? ""));
}
