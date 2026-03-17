/**
 * Single Responsibility: thuần túy là thuật toán SM-2, không phụ thuộc DB/framework
 * Dễ unit test độc lập
 */
export class Sm2Algorithm {
  static nextInterval(currentInterval: number, easeFactor: number, streak: number): number {
    if (streak <= 0) return 1;
    if (streak === 1) return 1;
    if (streak === 2) return 6;
    return Math.round(currentInterval * Number(easeFactor));
  }

  static updatedEase(ease: number, correct: boolean): number {
    const q = correct ? 5 : 0;
    const newEase = ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
    return Math.max(1.3, Math.min(2.5, Math.round(newEase * 100) / 100));
  }

  static nextStatus(current: string, streak: number, correct: boolean): string {
    if (!correct) return 'forgotten';
    switch (current) {
      case 'new':       return 'learning';
      case 'forgotten': return 'learning';
      case 'learning':  return streak >= 5  ? 'familiar' : 'learning';
      case 'familiar':  return streak >= 10 ? 'mastered' : 'familiar';
      default:          return current;
    }
  }
}
