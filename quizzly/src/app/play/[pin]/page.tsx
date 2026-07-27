import { notFound } from "next/navigation";

import { PlayClient } from "@/components/play/PlayClient";

export const metadata = {
  title: "Join game",
  // A live game page has nothing worth indexing and shouldn't be discoverable.
  robots: { index: false, follow: false },
};

/**
 * The player entry point.
 *
 * Renders no game data server-side at all — everything arrives over the socket
 * once the player has joined. That keeps correct answers out of the initial
 * HTML payload as a matter of architecture rather than discipline.
 */
export default async function PlayPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;

  // Fail fast on an obviously malformed PIN rather than opening a socket for it.
  if (!/^\d{6}$/.test(pin)) notFound();

  return <PlayClient pin={pin} />;
}
