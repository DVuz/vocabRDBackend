import { UnauthorizedException } from '@nestjs/common';
import { OAuth2Client, LoginTicket } from 'google-auth-library';

export async function exchangeGoogleCode(
  client: OAuth2Client,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<string> {
  let idToken: string | null | undefined;
  try {
    const res = await client.getToken({
      code,
      redirect_uri: redirectUri,
      codeVerifier,
    });
    idToken = res.tokens.id_token;
  } catch (err: any) {
    const googleError = err?.response?.data?.error;
    const googleErrorDescription = err?.response?.data?.error_description;

    const message =
      (googleError && googleErrorDescription
        ? `${googleError}: ${googleErrorDescription}`
        : undefined) ??
      googleErrorDescription ??
      googleError ??
      err?.message ??
      'Failed to exchange Google code';

    throw new UnauthorizedException(message);
  }

  if (!idToken) throw new UnauthorizedException('Google id_token missing');
  return idToken;
}

export async function verifyGoogleIdToken(
  client: OAuth2Client,
  idToken: string,
  clientId: string,
): Promise<LoginTicket> {
  try {
    return await client.verifyIdToken({ idToken, audience: clientId });
  } catch (err: any) {
    throw new UnauthorizedException(
      err?.message ?? 'Failed to verify Google token',
    );
  }
}
