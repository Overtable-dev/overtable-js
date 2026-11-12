/**
 * French: "de" before a name, the one place it elides: "d'Awa", "d'Élodie", "de Karim". A name that
 * starts with h keeps "de": nothing tells a silent h (Hélène) from an aspirated one (Hollande).
 * In a catalog string, write `{de:name}` instead of `de {name}`: t() comes here.
 */
export function deName(name: string): string {
  return `${/^[aeiouyœæ]/i.test(name.trimStart().normalize("NFD")) ? "d'" : "de "}${name}`;
}
