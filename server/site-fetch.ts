import { Readable } from 'node:stream';
import { requestPublic } from './media';
import { allowedSiteMetadata, SITE_METADATA_HEADERS } from './site-source';

export async function fetchSiteMetadata(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = SITE_METADATA_HEADERS,
): Promise<Response> {
  if (!allowedSiteMetadata(url)) throw new Error('原站解析地址不在适配范围内');
  const response = await requestPublic(url, headers, 0, {
    signal,
    allowedPorts: ['443', '8585'],
    maxRedirects: 0,
  });
  return new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
    status: response.statusCode,
  });
}
