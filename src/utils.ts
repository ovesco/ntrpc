export function getDurableName(subject: string) {
  return `c-${subject
    .replace(/\./g, "-")
    .replace(">", "all")
    .replace("*", "wc")}`;
}
