// a host whose own policy refuses inline scripts serves a frame on a path of its own; a srcdoc frame would inherit
// the host's policy, so pages are posted to that frame instead (see page-frame.ts)
let url: string | undefined;

export function setPageFrame(next: string | undefined): void {
  url = next;
}

export const pageFrame = (): string | undefined => url;
