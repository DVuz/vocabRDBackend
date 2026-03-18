import { UserWordStatus } from '@prisma/client';

type PriorityCandidate = {
  status: UserWordStatus | null;
  nextReviewAt: Date | null;
  addedAt: Date | null;
};

function getPriority(status: UserWordStatus | null): number {
  const safeStatus = status ?? UserWordStatus.new;

  switch (safeStatus) {
    case UserWordStatus.forgotten:
      return 0;
    case UserWordStatus.learning:
      return 1;
    case UserWordStatus.familiar:
      return 2;
    case UserWordStatus.mastered:
      return 3;
    case UserWordStatus.new:
    default:
      return 4;
  }
}

export function sortByReviewPriority<T extends PriorityCandidate>(items: T[]): T[] {
  return [...items].sort((first, second) => {
    const firstPriority = getPriority(first.status);
    const secondPriority = getPriority(second.status);

    if (firstPriority !== secondPriority) {
      return firstPriority - secondPriority;
    }

    const firstTime = first.nextReviewAt?.getTime() ?? first.addedAt?.getTime() ?? 0;
    const secondTime =
      second.nextReviewAt?.getTime() ?? second.addedAt?.getTime() ?? 0;

    return firstTime - secondTime;
  });
}
