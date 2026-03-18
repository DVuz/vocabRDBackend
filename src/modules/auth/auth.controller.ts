import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_TOKEN_COOKIE = 'refreshToken';
const COOKIE_MAX_AGE = process.env.COOKIE_MAX_AGE
  ? parseInt(process.env.COOKIE_MAX_AGE)
  : 7 * 24 * 60 * 60 * 1000; // default 7 days

function setRefreshCookie(res: any, token: string) {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
  });
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Đăng ký tài khoản' })
  @ApiResponse({ status: 201, description: 'Đăng ký thành công' })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Headers('user-agent') userAgent: string,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.authService.register(dto, userAgent, ip);
    setRefreshCookie(res, result.data.refreshToken);
    const { refreshToken: _, ...dataWithoutToken } = result.data;
    return { ...result, data: dataWithoutToken };
  }

  @ApiOperation({ summary: 'Đăng nhập email/password' })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công' })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent: string,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.authService.login(dto, userAgent, ip);
    setRefreshCookie(res, result.data.refreshToken);
    const { refreshToken: _, ...dataWithoutToken } = result.data;
    return { ...result, data: dataWithoutToken };
  }

  @ApiOperation({ summary: 'Đăng nhập bằng Google OAuth' })
  @ApiResponse({ status: 200, description: 'Đăng nhập Google thành công' })
  @Post('google')
  async loginGoogle(
    @Body() dto: GoogleAuthDto,
    @Headers('user-agent') userAgent: string,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: any,
  ) {
    console.log('Fe called this api');
    const result = await this.authService.loginWithGoogle(dto, userAgent, ip);
    setRefreshCookie(res, result.data.refreshToken);
    const { refreshToken: _, ...dataWithoutToken } = result.data;
    return { ...result, data: dataWithoutToken };
  }

  @ApiOperation({ summary: 'Làm mới access token (dùng refreshToken cookie)' })
  @ApiResponse({ status: 200, description: 'Refresh thành công' })
  @Post('refresh')
  async refresh(
    @Req() req: any,
    @Headers('user-agent') userAgent: string,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException('No refresh token');
    const result = await this.authService.refresh(token, userAgent, ip);
    setRefreshCookie(res, result.data.refreshToken);
    const { refreshToken: _, ...dataWithoutToken } = result.data;
    return { ...result, data: dataWithoutToken };
  }

  @ApiOperation({ summary: 'Đăng xuất, xóa refreshToken cookie' })
  @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (token) await this.authService.logout(token);
    res.clearCookie(REFRESH_TOKEN_COOKIE);
    return { message: 'Logout success', data: null };
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy thông tin user đang đăng nhập' })
  @ApiResponse({ status: 200, description: 'Thành công' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.authService.me(req.user.userId);
  }
}
