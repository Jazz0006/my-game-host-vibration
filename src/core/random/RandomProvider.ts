export interface RandomProvider {
  randomInt(maxExclusive: number): number;
  randomId(): string;
}
