import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import hashToken from './hashToken';
import { parseExpiresToDate } from './parseExpires';

export async function saveRefreshToken(
  prisma: PrismaService,
  configService: ConfigService,
  userId: number,
  refreshToken: string,
  userAgent?: string,
  ipAddress?: string,
): Promise<void> {
  const refreshExpiresIn =
    configService.get<string>('jwt.refreshExpiresIn') ?? '7d';
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: parseExpiresToDate(refreshExpiresIn),
      userAgent,
      ipAddress,
    },
  });
}
