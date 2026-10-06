import { registerAs } from '@nestjs/config';

export default registerAs('google', () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
  driveServiceAccountEmail: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,
  driveServiceAccountPrivateKey:
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY,
}));
