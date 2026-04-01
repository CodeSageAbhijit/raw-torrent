import TorrentSessionView from "./torrent-session-view";

export default async function TorrentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <TorrentSessionView sessionId={id} />;
}
