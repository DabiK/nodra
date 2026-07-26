const escape = String.fromCharCode(27);

export const stripAnsi = (value: string): string => value
  .split(escape)
  .map((part, index) => index === 0 ? part : part.replace(/^\[[0-9;]*m/, ""))
  .join("");
