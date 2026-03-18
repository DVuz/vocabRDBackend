import { UserWordStatus } from '@prisma/client';

export function nextInterval(
  currentInterval: number,
  easeFactor: number,
  streak: number,
): number {
  if (streak <= 0) {
    return 1;
  }
  if (streak === 1) {
    return 1;
  }
  if (streak === 2) {
    return 6;
  }

  return Math.max(1, Math.round(currentInterval * easeFactor));
}

export function updatedEase(ease: number, correct: boolean): number {
  const quality = correct ? 5 : 0;
  const next =
    ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);

  return Math.max(1.3, Math.min(2.5, Math.round(next * 100) / 100));
}

export function nextStatus(
  current: UserWordStatus,
  streak: number,
  correct: boolean,
): UserWordStatus {
  if (!correct) {
    return UserWordStatus.forgotten;
  }

  switch (current) {
    case UserWordStatus.new:
    case UserWordStatus.forgotten:
      return UserWordStatus.learning;
    case UserWordStatus.learning:
      return streak >= 5 ? UserWordStatus.familiar : UserWordStatus.learning;
    case UserWordStatus.familiar:
      return streak >= 10 ? UserWordStatus.mastered : UserWordStatus.familiar;
    case UserWordStatus.mastered:
    default:
      return UserWordStatus.mastered;
  }
}
