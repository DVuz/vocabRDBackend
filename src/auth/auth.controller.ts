import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

class GoogleLoginDto {
  credential: string; // Google access_token từ implicit flow
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/google
   * Body: { credential: "<google_access_token>" }
   * Frontend dùng @react-oauth/google implicit flow gửi access_token lên đây
   */
  @Post('google')
  googleLogin(@Body() body: GoogleLoginDto) {
    return this.authService.googleLoginWithAccessToken(body.credential);
  }
}
