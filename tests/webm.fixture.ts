export function element(id: string, bytes: number[] | Uint8Array) {
  const size =
    bytes.length < 127 ? [128 | bytes.length] : [64 | (bytes.length >> 8), bytes.length & 255];
  return Buffer.concat([Buffer.from(id, 'hex'), Buffer.from(size), Buffer.from(bytes)]);
}
export const init = Buffer.concat([
  Buffer.from('1a45dfa38018538067ff', 'hex'),
  element('1654ae6b', element('ae', Buffer.concat([element('d7', [1]), element('83', [1])]))),
]);
export const cluster = (value = 0, key = true) =>
  element(
    '1f43b675',
    Buffer.concat([
      element('e7', [value]),
      element('a3', [129, 0, 0, key ? 128 : 0, 0x1f, 0x43, 0xb6, 0x75, value]),
    ]),
  );
