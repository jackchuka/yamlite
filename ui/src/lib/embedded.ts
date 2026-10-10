// mounted inside another product: the host shows its own logo, and the files, database and address the UI runs on
// are internal to it, so the UI leaves out yamlite's logo and those local details
let embedded = false;

export function setEmbedded(on: boolean): void {
  embedded = on;
}

export const isEmbedded = (): boolean => embedded;
