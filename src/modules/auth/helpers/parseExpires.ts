export function parseExpiresToDate(expiresIn: string): Date {
  const now = Date.now();
  if (expiresIn.endsWith('d'))
    return new Date(now + Number(expiresIn.slice(0, -1)) * 86400000);
  if (expiresIn.endsWith('h'))
    return new Date(now + Number(expiresIn.slice(0, -1)) * 3600000);
  if (expiresIn.endsWith('m'))
    return new Date(now + Number(expiresIn.slice(0, -1)) * 60000);
  if (expiresIn.endsWith('s'))
    return new Date(now + Number(expiresIn.slice(0, -1)) * 1000);
  return new Date(now + 7 * 86400000);
}
