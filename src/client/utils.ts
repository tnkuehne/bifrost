export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function round(value: number): number {
  return Math.round(Number(value) * 10) / 10;
}

export function isAllowedCandidate(candidate: string): boolean {
  return !/\styp\s(relay|srflx)\s/i.test(candidate);
}
