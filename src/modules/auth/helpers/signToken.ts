import { JwtPayload } from '../../../common/types/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';

const signTokens = async (
  payload: JwtPayload,
  jwtService: JwtService,
  configService: ConfigService,
) => {
  const accessToken = await jwtService.signAsync(payload, {
    secret: configService.get<string>('jwt.accessSecret'),
    expiresIn: configService.get<string>('jwt.accessExpiresIn') as StringValue,
  });

  const refreshExpiresIn = (configService.get<string>('jwt.refreshExpiresIn') ??
    '7d') as StringValue;
  const refreshToken = await jwtService.signAsync(payload, {
    secret: configService.get<string>('jwt.refreshSecret'),
    expiresIn: refreshExpiresIn,
  });

  return { accessToken, refreshToken, refreshExpiresIn };
};

export default signTokens;
