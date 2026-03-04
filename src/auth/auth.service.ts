import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma.service';

const googleClient = new OAuth2Client();

export interface GoogleUser {
  email: string;
  name: string;
  image: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Frontend dùng implicit flow → gửi lên Google access_token
   * Backend dùng access_token để lấy thông tin user từ Google UserInfo API
   */
  async googleLoginWithAccessToken(accessToken: string) {
    // Lấy thông tin user từ Google UserInfo endpoint
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new UnauthorizedException('Google access token không hợp lệ');
    }

    const info = (await res.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };

    const { email, name, picture } = info;

    if (!email) {
      throw new UnauthorizedException('Không lấy được email từ Google');
    }

    // Tìm user theo email, nếu chưa có thì tạo mới với provider = google
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          name: name ?? null,
          image: picture ?? null,
          provider: 'google',
        },
      });
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      token_type: 'Bearer',
      user,
    };
  }
}
