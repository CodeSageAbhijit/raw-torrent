declare module "bencoding" {
  const bencode: {
    encode: (value: unknown) => Buffer;
    decode: (buffer: Buffer | Uint8Array | ArrayBuffer) => unknown;
  };

  export default bencode;
}
