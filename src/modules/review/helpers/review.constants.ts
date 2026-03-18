import { UserWordStatus } from '@prisma/client';

export const REVIEW_ALLOWED_STATUSES: UserWordStatus[] = [
  UserWordStatus.new,
  UserWordStatus.learning,
  UserWordStatus.familiar,
  UserWordStatus.mastered,
  UserWordStatus.forgotten,
];

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_DAILY = 20;
