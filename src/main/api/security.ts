import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function generateApiKey(): string {
  return randomBytes(32).toString('base64url');
}

export function fingerprintApiKey(apiKey: string): string {
  if (!apiKey) {
    return 'api_empty';
  }

  const fingerprint = createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
  return `api_${fingerprint}`;
}

export function parseBearerToken(authorizationHeader: string | string[] | undefined | null): string | null {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length);
  if (!token || token.trim() !== token || /\s/.test(token)) {
    return null;
  }

  return token;
}

export function isAuthorizedBearer(
  authorizationHeader: string | string[] | null | undefined,
  configuredApiKey: string,
): boolean {
  const token = parseBearerToken(authorizationHeader);

  if (!token || !configuredApiKey) {
    return false;
  }

  const tokenBuffer = Buffer.from(token);
  const configuredBuffer = Buffer.from(configuredApiKey);

  return tokenBuffer.length === configuredBuffer.length
    && timingSafeEqual(tokenBuffer, configuredBuffer);
}

export function normalizeRemoteAddress(remoteAddress: string | undefined | null): string {
  const address = remoteAddress?.trim() ?? '';
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

export function isAllowedApiSourceIp(remoteAddress: string | undefined | null): boolean {
  const address = normalizeRemoteAddress(remoteAddress);

  if (address === '127.0.0.1' || address === '::1') {
    return true;
  }

  const octets = parseIpv4(address);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return first === 10
    || (first === 192 && second === 168)
    || (first === 172 && second >= 16 && second <= 31)
    || first === 127;
}

function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }

    return Number(part);
  });

  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}
