import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from '../../common/types/jwt-payload.interface';
import hashToken from './helpers/hashToken';
import signTokens from './helpers/signToken';
import { saveRefreshToken } from './helpers/saveRefreshToken';
import { exchangeGoogleCode, verifyGoogleIdToken } from './helpers/googleAuth';

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('google.clientId'),
      this.configService.get<string>('google.clientSecret'),
    );
  }

  async register(dto: RegisterDto, userAgent?: string, ipAddress?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name ?? null,
        passwordHash,
        provider: 'local',
      },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role ?? 'user',
    };
    const { accessToken, refreshToken } = await signTokens(
      payload,
      this.jwtService,
      this.configService,
    );
    await saveRefreshToken(
      this.prisma,
      this.configService,
      user.id,
      refreshToken,
      userAgent,
      ipAddress,
    );

    return {
      message: 'Register success',
      data: { user, accessToken, refreshToken },
    };
  }

  async login(dto: LoginDto, userAgent?: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.passwordHash)
      throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role ?? 'user',
    };
    const { accessToken, refreshToken } = await signTokens(
      payload,
      this.jwtService,
      this.configService,
    );
    await saveRefreshToken(
      this.prisma,
      this.configService,
      user.id,
      refreshToken,
      userAgent,
      ipAddress,
    );

    return {
      message: 'Login success',
      data: { user, accessToken, refreshToken },
    };
  }

  async loginWithGoogle(
    dto: GoogleAuthDto,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const clientId = this.configService.get<string>('google.clientId');
    const clientSecret = this.configService.get<string>('google.clientSecret');
    if (!clientId || !clientSecret)
      throw new BadRequestException('Google config missing');

    const idToken = await exchangeGoogleCode(
      this.googleClient,
      dto.code,
      dto.redirect_uri,
      dto.codeVerifier,
    );
    const ticket = await verifyGoogleIdToken(
      this.googleClient,
      idToken,
      clientId,
    );
    const googlePayload = ticket.getPayload();
    if (!googlePayload?.email || !googlePayload.email_verified)
      throw new UnauthorizedException('Google email not verified');

    const existingUser = await this.prisma.user.findFirst({
      where: { email: googlePayload.email },
      orderBy: { id: 'asc' },
    });

    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name: googlePayload.name ?? undefined,
            image: googlePayload.picture ?? undefined,
            provider: 'google',
          },
        })
      : await this.prisma.user.create({
          data: {
            email: googlePayload.email,
            name: googlePayload.name ?? null,
            image: googlePayload.picture ?? null,
            provider: 'google',
          },
        });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role ?? 'user',
    };
    const { accessToken, refreshToken } = await signTokens(
      payload,
      this.jwtService,
      this.configService,
    );
    await saveRefreshToken(
      this.prisma,
      this.configService,
      user.id,
      refreshToken,
      userAgent,
      ipAddress,
    );

    return {
      message: 'Google login success',
      data: { user, accessToken, refreshToken },
    };
  }

  async refresh(
    oldRefreshToken: string,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
    if (!refreshSecret)
      throw new UnauthorizedException('Refresh secret missing');

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(oldRefreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = hashToken(oldRefreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!stored)
      throw new UnauthorizedException('Refresh token revoked or expired');

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const newPayload: JwtPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    const { accessToken, refreshToken } = await signTokens(
      newPayload,
      this.jwtService,
      this.configService,
    );
    await saveRefreshToken(
      this.prisma,
      this.configService,
      payload.sub,
      refreshToken,
      userAgent,
      ipAddress,
    );

    return { message: 'Refresh success', data: { accessToken, refreshToken } };
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logout success', data: null };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        provider: true,
        status: true,
      },
    });
    return { message: 'Profile fetched', data: user };
  }
}
