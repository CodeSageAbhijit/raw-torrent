import * as bencode from "bencode";

export const decodeBencodedTrackerResponse = async (response: Response) => {
  const bytes = Buffer.from(await response.arrayBuffer());
  return bencode.decode(bytes) as Record<string, unknown>;
};
